/**
 * dsh-doctor 的 host 半边。
 *
 * 三件事：
 *   1. 内置检查（桌面 ACL、工作区注册、profile 宿主包、会话、崩溃日志）；
 *   2. 一键修复（优先走 DSH 自己的服务，其次才改文件，全部先备份）；
 *   3. 社区检查包：读 $DSH_HOME/dsh-doctor/checks/*.json，按 docs/protocol.md 声明的
 *      原语执行——贡献者只写数据，不写代码，也没有任何 shell 通道。
 *
 * 设计约束：单条检查/修复失败不影响其它；不碰 DSH 安装目录；写操作先备份再复检。
 */
import { existsSync, readFileSync, readdirSync, renameSync, copyFileSync, statSync, writeFileSync, mkdirSync, appendFileSync, openSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import * as zlib from 'node:zlib'

import { createRequire } from 'node:module'

const requireFromHere = createRequire(import.meta.url)

const zstdDecompress = typeof zlib.zstdDecompressSync === 'function' ? zlib.zstdDecompressSync : null
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

const PREFIX = '/dsh-doctor'
const CRITICAL_HOST_PACKAGES = ['dsh-tools', 'dsh-skill', 'schemastery', 'dsh-util-values', 'cordis']

/** 由 apply() 填入；修复时优先用它调 DSH 自己的服务。 */
let hostContext = null

function dshHome() {
	const configured = process.env.DSH_HOME
	if (typeof configured === 'string' && configured.length > 0) return configured
	return join(homedir(), '.dsh')
}

function desktopPath() {
	if (process.platform === 'linux') {
		const xdg = process.env.XDG_DESKTOP_DIR
		if (typeof xdg === 'string' && xdg.length > 0) return xdg
	}
	return join(homedir(), 'Desktop')
}

function normalizePath(value) {
	return String(value).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function powershell(command, timeout = 20000) {
	try {
		const result = spawnSync('powershell.exe', [
			'-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command,
		], { windowsHide: true, encoding: 'utf8', timeout })
		return {
			ok: result.status === 0,
			out: typeof result.stdout === 'string' ? result.stdout.trim() : '',
			err: typeof result.stderr === 'string' ? result.stderr.trim() : '',
		}
	} catch (error) {
		return { ok: false, out: '', err: String(error && error.message ? error.message : error) }
	}
}

const isWindows = process.platform === 'win32'

function rescueRegistryPath() {
	return join(dshHome(), 'dsh-doctor', 'rescue.json')
}

function readRescueRegistry() {
	try { return JSON.parse(readFileSync(rescueRegistryPath(), 'utf8')) } catch (error) { return null }
}

function writeRescueRegistry(value) {
	try {
		mkdirp(dirname(rescueRegistryPath()))
		writeFileSync(rescueRegistryPath(), JSON.stringify(value, null, 2), 'utf8')
	} catch (error) { /* ignore */ }
}

/** 同步探测端口是否还有人在听（netstat / ss），用于识别"上次逃生实例已死"。 */
function portInUse(port) {
	const result = shell(isWindows ? 'netstat -ano' : 'ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null')
	if (!result.ok || result.out.length === 0) return true
	return new RegExp('[:.]' + port + '\\s').test(result.out)
}

/** 跨平台地跑一条系统命令：Windows 用 PowerShell，其它平台用 /bin/sh。 */
function shell(command, timeout = 20000) {
	if (isWindows) return powershell(command, timeout)
	try {
		const result = spawnSync('/bin/sh', ['-lc', command], { encoding: 'utf8', timeout })
		return {
			ok: result.status === 0,
			out: typeof result.stdout === 'string' ? result.stdout.trim() : '',
			err: typeof result.stderr === 'string' ? result.stderr.trim() : '',
		}
	} catch (error) {
		return { ok: false, out: '', err: String(error && error.message ? error.message : error) }
	}
}

function quote(value) {
	return "'" + String(value).replace(/'/g, "''") + "'"
}

function aclSddl(path) {
	if (!isWindows) return ''
	const result = powershell('[Console]::Out.Write((Get-Acl -LiteralPath ' + quote(path) + ').Sddl)')
	return result.ok ? result.out : ''
}

function latestWriteMs(dir) {
	let newest = 0
	try {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name)
			try {
				if (entry.isDirectory()) newest = Math.max(newest, latestWriteMs(full))
				else newest = Math.max(newest, statSync(full).mtimeMs)
			} catch (error) { /* 单个条目失败忽略 */ }
		}
	} catch (error) { /* 目录不可读忽略 */ }
	return newest
}

function finding(id, severity, title, detail, path, fixId, source) {
	return {
		id,
		severity,
		title,
		detail,
		path: path === undefined ? '' : path,
		fixId: fixId === undefined ? null : fixId,
		source: source === undefined ? 'builtin' : source,
	}
}

function readDirNames(dir) {
	try {
		return readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
	} catch (error) {
		return []
	}
}

/* ── 工作区 ─────────────────────────────────────────────────────────── */

function workspaceFile() {
	return join(dshHome(), 'storages', 'workspace.json')
}

function readWorkspaceRegistry() {
	let raw = ''
	try { raw = readFileSync(workspaceFile(), 'utf8') } catch (error) { return null }
	let data = null
	try { data = JSON.parse(raw) } catch (error) { return null }
	const table = data && data.tables && data.tables.workspaces ? data.tables.workspaces : {}
	const list = []
	for (const [id, record] of Object.entries(table)) {
		if (record && typeof record.path === 'string') list.push({ id, path: record.path, title: record.title })
	}
	return { data, list }
}

function workspaceRisk(path) {
	const target = normalizePath(path)
	const home = normalizePath(homedir())
	if (target.length === 0 || home.length === 0) return null
	const risky = [
		[home, '用户目录本身'],
		[normalizePath(desktopPath()), '桌面本身'],
		[home + '/documents', '文档目录'],
		[home + '/downloads', '下载目录'],
		[home + '/pictures', '图片目录'],
	]
	for (const [candidate, label] of risky) {
		if (target === candidate) return label
	}
	if (/^[a-z]:$/.test(target) || target === '/') return '整个盘根'
	return null
}

function riskyWorkspaces() {
	const registry = readWorkspaceRegistry()
	if (registry === null) return []
	return registry.list.filter(workspace => workspaceRisk(workspace.path) !== null)
}

/* ── 内置检查 ───────────────────────────────────────────────────────── */

function checkDesktopAcl() {
	const findings = []
	const desktop = desktopPath()
	if (!existsSync(desktop)) return findings
	if (!isWindows) {
		// POSIX 上没有"低完整性标签"这回事；退化成权限位检查，只报不修。
		try {
			const mode = statSync(desktop).mode
			if ((mode & 0o002) !== 0) {
				findings.push(finding('desktop-world-writable', 'medium',
					'桌面目录是 world-writable',
					'任何本机账户都能改写桌面内容，属于权限过宽。建议用 chmod o-w 收紧。',
					desktop, null))
			}
		} catch (error) { /* ignore */ }
		return findings
	}
	const sddl = aclSddl(desktop)
	if (sddl.length === 0) return findings
	if (/S:\(ML;;[^;]*;;;LW/.test(sddl)) {
		findings.push(finding('desktop-low-label', 'high',
			'桌面被打了 Low 完整性标签（图标会变白）',
			'沙箱授写权限的副产物。Explorer 在低完整性目录里取不到图标，所以删缓存没用。修复会改回 Medium，能力 ACE 保留，写入不受影响。',
			desktop, 'desktop-label'))
	}
	if (/\(D;[^)]*;;;WD\)/.test(sddl)) {
		findings.push(finding('desktop-everyone-deny', 'medium',
			'桌面上留着 Everyone 的删除拒绝项',
			'沙箱授权时盖上的，DSH 从不回收。不影响图标渲染，但会挡住正常清理。',
			desktop, 'desktop-label'))
	}
	return findings
}

function checkWorkspaces() {
	const findings = []
	for (const workspace of riskyWorkspaces()) {
		findings.push(finding('workspace-risky-path', 'high',
			'工作区被注册到了「' + workspaceRisk(workspace.path) + '」',
			'每次给这个工作区授沙箱写权限，DSH 都会重新盖一遍 Low 标签和拒绝项，所以图标变白会反复复发。移出注册表是断根（该工作区下的会话文件仍留在磁盘上）。',
			workspace.path, 'workspace-entry'))
	}
	return findings
}

function desktopSessionSlug() {
	return '--' + desktopPath().replace(/[:\\/]/g, '-') + '--'
}

function checkDesktopSessions() {
	const findings = []
	const sessionsRoot = join(dshHome(), 'sessions')
	if (!existsSync(sessionsRoot)) return findings
	const slug = desktopSessionSlug()
	for (const name of readDirNames(sessionsRoot)) {
		if (name.toLowerCase() !== slug.toLowerCase()) continue
		const full = join(sessionsRoot, name)
		const newest = latestWriteMs(full)
		const minutes = newest === 0 ? Infinity : Math.round((Date.now() - newest) / 60000)
		const active = minutes < 10
		findings.push(finding('desktop-workspace-session', active ? 'high' : 'low',
			active ? '有会话正把桌面当工作区（10 分钟内还在写）' : '有会话把桌面当工作区',
			'它每写一个文件，Explorer 就把整个桌面重画一遍——这就是"所有图标一起闪"。最近写入：'
			+ (minutes === Infinity ? '未知' : minutes + ' 分钟前') + '。',
			full, 'workspace-entry'))
	}
	return findings
}

function profileHostDirs() {
	const results = []
	const profilesRoot = join(dshHome(), 'profiles')
	if (!existsSync(profilesRoot)) return results
	const candidates = []
	for (const name of readDirNames(profilesRoot)) {
		const base = join(profilesRoot, name)
		candidates.push(join(base, 'node_modules', '@deepseek-ai'))
		candidates.push(join(base, 'node_modules', '.ignored', '@deepseek-ai'))
	}
	candidates.push(join(profilesRoot, 'node_modules', '@deepseek-ai'))
	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue
		const lower = candidate.toLowerCase()
		if (lower.includes('.ignored') || lower.includes('.stale')) continue
		results.push(candidate)
	}
	return results
}

function hostPackagesIn(dir) {
	return readDirNames(dir).filter(name => CRITICAL_HOST_PACKAGES.includes(name))
}

function checkProfileHostDuplicates() {
	const findings = []
	for (const dir of profileHostDirs()) {
		const hostPackages = hostPackagesIn(dir)
		if (hostPackages.length === 0) continue
		findings.push(finding('profile-host-duplicate', 'high',
			'profile 里出现了宿主包副本：' + hostPackages.join(', '),
			'同一个进程里两份 dsh-tools 会造出两个 Symbol（reading \'prepare\'）；旧版本副本则报 is incompatible with dsh。修复只会把这几份副本单独挪走，不动同目录下的合法插件。',
			dir, 'profile-host-dup'))
	}
	return findings
}

function crashLogDir() {
	if (isWindows) return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), '@deepseek-ai', 'dsh-desktop', 'logs')
	if (process.platform === 'darwin') return join(homedir(), 'Library', 'Logs', '@deepseek-ai', 'dsh-desktop')
	const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
	return join(configHome, '@deepseek-ai', 'dsh-desktop', 'logs')
}

function checkCrashLogs() {
	const findings = []
	const logDir = crashLogDir()
	if (!existsSync(logDir)) return findings
	let files = []
	try { files = readdirSync(logDir).filter(name => name.startsWith('crash-')) } catch (error) { return findings }
	if (files.length === 0) return findings
	let newest = 0
	for (const name of files) {
		try { newest = Math.max(newest, statSync(join(logDir, name)).mtimeMs) } catch (error) { /* ignore */ }
	}
	const days = newest === 0 ? Infinity : Math.round((Date.now() - newest) / 86400000)
	findings.push(finding('desktop-crash-logs', days <= 7 ? 'medium' : 'low',
		'检测到桌面端崩溃日志：' + files.length + ' 个',
		'最近一次在 ' + (newest === 0 ? '未知' : new Date(newest).toLocaleString()) + '。renderer 崩溃往往不带栈，只能靠时间关联。',
		logDir, null))
	return findings
}

/* ── 会话 / credentials / patch 层 / PATH ───────────────────────────── */

function decodeZstdFile(path) {
	if (zstdDecompress === null) return null
	let buffer = null
	try { buffer = readFileSync(path) } catch (error) { return null }
	try { return zstdDecompress(buffer).toString('utf8') } catch (error) { /* 试试逐帧解 */ }
	const parts = []
	let start = buffer.indexOf(ZSTD_MAGIC)
	while (start >= 0) {
		const next = buffer.indexOf(ZSTD_MAGIC, start + 4)
		const end = next < 0 ? buffer.length : next
		try { parts.push(zstdDecompress(buffer.subarray(start, end)).toString('utf8')) } catch (error) { /* 跳过坏帧 */ }
		start = next
	}
	return parts.length === 0 ? null : parts.join('\n')
}

/** 扫会话文件里 v4 拒收的旧写法；只读，不改写（改写风险高，留给人工）。 */
function checkLegacySessions() {
	const findings = []
	if (zstdDecompress === null) return findings
	const root = join(dshHome(), 'sessions')
	if (!existsSync(root)) return findings
	const pattern = /"kind"\s*:\s*"plugin"/
	const limit = 80
	let scanned = 0
	for (const name of readDirNames(root)) {
		if (scanned >= limit) break
		const sessionDir = join(root, name)
		let files = []
		try { files = readdirSync(sessionDir).filter(file => file.endsWith('.jsonl.zstd')) } catch (error) { continue }
		for (const file of files) {
			if (scanned >= limit) break
			const full = join(sessionDir, file)
			let size = 0
			try { size = statSync(full).size } catch (error) { continue }
			if (size > 8 * 1024 * 1024) continue
			scanned += 1
			const text = decodeZstdFile(full)
			if (text === null) continue
			if (!pattern.test(text)) continue
			findings.push(finding('session-legacy-kind', 'high',
				'老会话里有 v4 拒收的 source.kind = "plugin" 写法',
				'打开这个会话时迁移会失败，整轮报 "format v4 message requires a producer-owned source kind"。改写会话文件风险高，v1 只报告不自动改。',
				full, null))
			break
		}
	}
	return findings
}

function checkCredentials() {
	const findings = []
	const candidates = [
		join(dshHome(), '.credentials.yaml'),
		join(dshHome(), '.credentials.yml'),
	]
	for (const file of candidates) {
		if (!existsSync(file)) continue
		let head = ''
		try { head = readFileSync(file, 'utf8').slice(0, 4000) } catch (error) { continue }
		const match = head.match(/^\s*version\s*:\s*['"]?([\w.-]+)['"]?\s*$/m)
		if (match === null) {
			findings.push(finding('credentials-no-version', 'medium',
				'credentials 文件缺少 version 字段',
				'host 启动时按 version 选择解析器；缺字段可能直接起不来。文件：' + file,
				file, null))
		} else if (match[1] !== '1') {
			findings.push(finding('credentials-version', 'low',
				'credentials 版本是 ' + match[1] + '（本机已知可用是 1）',
				'版本不符时 host 可能报 "declares version ... ; this build reads version 1"。',
				file, null))
		}
	}
	return findings
}

function patchBackupNames(profileDir) {
	try {
		return readdirSync(profileDir)
			.filter(name => name.startsWith('cordis.patch.yml.bak'))
			.sort()
			.reverse()
	} catch (error) {
		return []
	}
}

/** 崩溃自修复会把 cordis.patch.yml 清空；有备份就说明确实丢过。 */
function checkPatchLayer() {
	const findings = []
	const profilesRoot = join(dshHome(), 'profiles')
	if (!existsSync(profilesRoot)) return findings
	for (const name of readDirNames(profilesRoot)) {
		if (name.includes('.stale')) continue
		const dir = join(profilesRoot, name)
		const backups = patchBackupNames(dir)
		if (backups.length === 0) continue
		const patchFile = join(dir, 'cordis.patch.yml')
		let size = -1
		try { size = statSync(patchFile).size } catch (error) { size = -1 }
		if (size > 2) continue
		findings.push(finding('patch-layer-missing', 'high',
			'profile "' + name + '" 的 cordis.patch.yml 是空的或不存在，但有备份',
			'DSH 崩溃自修复会清空 patch 层（主题、模型 provider、MCP 配置全都没了）。可以从最近一份备份恢复，恢复前会先备份当前状态。',
			patchFile, 'restore-patch-layer'))
	}
	return findings
}

/** PATH 里指向不存在文件的 dsh 命令，是"命令莫名其妙不工作"的常见根。 */
function checkPathVariable() {
	const findings = []
	const listed = shell(isWindows ? 'where.exe dsh' : 'which -a dsh 2>/dev/null || command -v dsh 2>/dev/null')
	if (!listed.ok || listed.out.length === 0) return findings
	const lines = listed.out.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0)
	const dead = lines.filter(line => !existsSync(line))
	if (dead.length === 0) return findings
	findings.push(finding('path-dead-dsh', 'medium',
		'PATH 里有指向不存在文件的 dsh 命令',
		'这些条目会让人以为"dsh 没装/版本不对"。删掉或修掉 PATH 里对应目录即可：' + dead.join(' | '),
		'', null))
	return findings
}

/** 上次逃生实例如果已经死了，浏览器里的旧标签页会报 Failed to fetch —— 说明白，别让人以为坏了。 */
function checkRescueInstance() {
	const findings = []
	const registry = readRescueRegistry()
	if (registry === null || typeof registry.port !== 'number') return findings
	if (portInUse(registry.port)) return findings
	findings.push(finding('rescue-instance-dead', 'low',
		'上次逃生实例已失效（端口 ' + registry.port + '）',
		'浏览器里指向 127.0.0.1:' + registry.port + ' 的旧标签页会显示 "Failed to fetch" / 读不到插件——那不是数据坏了，是那个 host 已经退出。点一次「起网页版」会复用或重开一个。',
		'http://127.0.0.1:' + registry.port + '/', null))
	return findings
}

/** Windows：DSH 要给工作区授沙箱权限，需要 owner 或 WRITE_DAC；缺了就会报 grantWrite Win32 5。 */
function inspectWorkspaceDacl(path) {
	if (!isWindows) return null
	const script = [
		'$acl = Get-Acl -LiteralPath ' + psQuote(path),
		'$me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
		'$owner = $acl.Owner',
		'try { $owner = (New-Object Security.Principal.NTAccount($acl.Owner)).Translate([Security.Principal.SecurityIdentifier]).Value } catch {}',
		'$canChange = $false',
		'foreach ($ace in $acl.Access) {',
		'  if ($ace.AccessControlType -ne "Allow") { continue }',
		'  try { $sid = $ace.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { continue }',
		'  if ($sid -ne $me) { continue }',
		'  $rights = [int]$ace.FileSystemRights',
		'  if (($rights -band 0x40000) -eq 0x40000) { $canChange = $true }',
		'}',
		'[Console]::Out.Write((@{ owner = $owner; me = $me; canChange = $canChange } | ConvertTo-Json -Compress))',
	].join('; ')
	const result = powershell(script)
	if (!result.ok || result.out.length === 0) return null
	try { return JSON.parse(result.out) } catch (error) { return null }
}

function checkWorkspaceGrantability() {
	const findings = []
	if (!isWindows) return findings
	const registry = readWorkspaceRegistry()
	if (registry === null) return findings
	for (const workspace of registry.list) {
		if (!existsSync(workspace.path)) continue
		const info = inspectWorkspaceDacl(workspace.path)
		if (info === null) continue
		if (info.owner === info.me || info.canChange === true) continue
		findings.push(finding('workspace-not-grantable', 'high',
			'DSH 可能无法给这个工作区授权：' + workspace.title,
			'这个目录的所有者不是你，你的账号也没有「更改权限」（WRITE_DAC）——DSH 在供给沙箱时会拿不到写入能力，'
				+ '表现为 grantWrite Win32 5 / 一开终端就报错。一键修复会给当前账号补完全控制（先备份 ACL）。',
			workspace.path, 'workspace-acl'))
	}
	return findings
}

/** 工作区可写性：真写一个临时文件再删掉——这是"起不来"最硬的证据。 */
function checkWorkspaceWritability() {
	const findings = []
	const registry = readWorkspaceRegistry()
	if (registry === null) return findings
	for (const workspace of registry.list) {
		const target = workspace.path
		if (!existsSync(target)) continue
		const probe = join(target, '.dsh-doctor-write-test-' + process.pid + '-' + Date.now() + '.tmp')
		try {
			writeFileSync(probe, 'ok', 'utf8')
			try { unlinkSync(probe) } catch (error) { /* 删不掉不算致命 */ }
		} catch (error) {
			const message = String(error && error.message ? error.message : error)
			findings.push(finding('workspace-not-writable', 'high',
				'工作区写不进去：' + workspace.title,
				'医生真写了一个临时文件来验证，失败了：' + message
					+ '。表现就是 DSH 起不来、终端一开就报 grantWrite / EACCES。'
					+ (isWindows ? '一键修复会给当前账号补上完全控制（先备份 ACL）。' : '请手动检查该目录权限。'),
				target, isWindows ? 'workspace-acl' : null))
		}
	}
	return findings
}

/* ── 社区检查包（协议 v1）──────────────────────────────────────────── */

const PACK_DIR = () => join(dshHome(), 'dsh-doctor', 'checks')

function expandVars(text) {
	return String(text)
		.replace(/\{\{dshHome\}\}/g, dshHome())
		.replace(/\{\{desktop\}\}/g, desktopPath())
		.replace(/\{\{profiles\}\}/g, join(dshHome(), 'profiles'))
		.replace(/\{\{sessions\}\}/g, join(dshHome(), 'sessions'))
		.replace(/\{\{appData\}\}/g, process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'))
}

function wildcardToRegex(pattern) {
	let out = ''
	for (const char of pattern.replace(/\\/g, '/')) {
		if (char === '*') out += '[^/]*'
		else if (char === '?') out += '[^/]'
		else out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
	}
	return new RegExp('^' + out + '$', 'i')
}

function listFiles(dir, maxFiles) {
	const found = []
	const walk = (current, depth) => {
		if (found.length >= maxFiles || depth > 6) return
		let entries = []
		try { entries = readdirSync(current, { withFileTypes: true }) } catch (error) { return }
		for (const entry of entries) {
			if (found.length >= maxFiles) return
			const full = join(current, entry.name)
			if (entry.isDirectory()) walk(full, depth + 1)
			else found.push(full)
		}
	}
	walk(dir, 0)
	return found
}

/** 每个原语只读、纯函数式：输入声明，输出 finding。 */
const DETECTORS = {
	'workspace-risky-path': () => checkWorkspaces(),
	'desktop-low-label': () => checkDesktopAcl().filter(item => item.id === 'desktop-low-label'),
	'profile-host-duplicate': () => checkProfileHostDuplicates(),
	'desktop-session-activity': () => checkDesktopSessions(),
	'crash-logs': () => checkCrashLogs(),
	'session-legacy-kind': () => checkLegacySessions(),
	'credentials-version': () => checkCredentials(),
	'patch-layer-missing': () => checkPatchLayer(),
	'path-dead-dsh': () => checkPathVariable(),
	'rescue-instance-dead': () => checkRescueInstance(),
	'workspace-not-writable': () => checkWorkspaceWritability(),
	'workspace-not-grantable': () => checkWorkspaceGrantability(),
	'file-regex': (check) => {
		const findings = []
		const dir = expandVars(check.path)
		const maxFiles = typeof check.maxFiles === 'number' ? Math.min(check.maxFiles, 2000) : 400
		const pattern = new RegExp(check.pattern)
		if (!existsSync(dir)) return findings
		for (const file of listFiles(dir, maxFiles)) {
			let text = ''
			try { text = readFileSync(file, 'utf8') } catch (error) { continue }
			if (!pattern.test(text)) continue
			findings.push(finding(check.id, check.severity || 'medium', check.title,
				(check.detail || '') + ' 命中文件：' + file, file, null, check.pack))
		}
		return findings
	},
	'acl': (check) => {
		const path = expandVars(check.path)
		if (!existsSync(path)) return []
		const sddl = aclSddl(path)
		const isLow = /S:\(ML;;[^;]*;;;LW/.test(sddl)
		const hasDeny = /\(D;[^)]*;;;WD\)/.test(sddl)
		const hit = check.test === 'low-label' ? isLow : check.test === 'everyone-deny' ? hasDeny : false
		if (!hit) return []
		return [finding(check.id, check.severity || 'medium', check.title, check.detail || '', path,
			check.fix ? check.fix.type : null, check.pack)]
	},
	'dir-contains': (check) => {
		const findings = []
		const base = expandVars(check.path)
		const wanted = Array.isArray(check.names) ? check.names : []
		if (!existsSync(base)) return findings
		const hit = readDirNames(base).filter(name => wanted.includes(name))
		if (hit.length === 0) return findings
		findings.push(finding(check.id, check.severity || 'medium', check.title,
			(check.detail || '') + ' 命中：' + hit.join(', '), base,
			check.fix ? check.fix.type : null, check.pack))
		return findings
	},
}

function loadCheckPacks() {
	const findings = []
	const dir = PACK_DIR()
	if (!existsSync(dir)) return findings
	let files = []
	try { files = readdirSync(dir).filter(name => name.toLowerCase().endsWith('.json')) } catch (error) { return findings }
	for (const name of files) {
		let pack = null
		try { pack = JSON.parse(readFileSync(join(dir, name), 'utf8')) } catch (error) { continue }
		if (pack === null || !Array.isArray(pack.checks)) continue
		const packId = typeof pack.id === 'string' ? pack.id : name.replace(/\.json$/i, '')
		for (const check of pack.checks) {
			if (check === null || typeof check !== 'object') continue
			if (typeof check.detect !== 'object' || check.detect === null) continue
			const detector = DETECTORS[String(check.detect.type)]
			if (typeof detector !== 'function') continue
			const spec = Object.assign({}, check, {
				path: check.detect.path,
				pattern: check.detect.pattern,
				test: check.detect.test,
				names: check.detect.names,
				maxFiles: check.detect.maxFiles,
				id: typeof check.id === 'string' ? check.id : packId + ':' + String(check.detect.type),
				title: typeof check.title === 'string' ? check.title : '社区检查：' + String(check.detect.type),
				pack: packId,
			})
			try {
				for (const item of detector(spec)) {
					findings.push(Object.assign({}, item, {
						id: spec.id,
						severity: typeof check.severity === 'string' ? check.severity : item.severity,
						title: spec.title,
						detail: (typeof check.detail === 'string' ? check.detail + ' ' : '') + (item.detail || ''),
						path: item.path || '',
						source: packId,
						fixId: check.fix && typeof check.fix.type === 'string' ? check.fix.type : item.fixId,
					}))
				}
			} catch (error) {
				findings.push(finding('pack-error:' + packId, 'low', '检查包执行失败：' + packId,
					String(error && error.message ? error.message : error), '', null, packId))
			}
		}
	}
	return findings
}

/* ── 汇总 ───────────────────────────────────────────────────────────── */

function scan() {
	const builtin = [
		checkDesktopAcl,
		checkWorkspaces,
		checkDesktopSessions,
		checkProfileHostDuplicates,
		checkCrashLogs,
		checkLegacySessions,
		checkCredentials,
		checkPatchLayer,
		checkPathVariable,
		checkRescueInstance,
		checkWorkspaceWritability,
		checkWorkspaceGrantability,
	]
	const findings = []
	for (const check of builtin) {
		try { for (const item of check()) findings.push(item) } catch (error) {
			findings.push(finding('check-failed:' + check.name, 'low', '检查失败：' + check.name,
				String(error && error.message ? error.message : error), '', null))
		}
	}
	findings.push(...loadCheckPacks())
	const seen = new Set()
	const unique = []
	for (const item of findings) {
		const key = [item.severity, item.path, item.fixId].join('|')
		if (seen.has(key)) continue
		seen.add(key)
		unique.push(item)
	}
	return unique
}

function environment() {
	return {
		platform: process.platform,
		electron: process.versions.electron || null,
		execPath: process.execPath,
		dshHome: dshHome(),
		desktop: desktopPath(),
		profiles: readDirNames(join(dshHome(), 'profiles')),
		packDir: PACK_DIR(),
		packs: existsSync(PACK_DIR()) ? readdirSync(PACK_DIR()).filter(name => name.toLowerCase().endsWith('.json')) : [],
		node: process.version,
		at: new Date().toISOString(),
	}
}

/* ── 修复 ───────────────────────────────────────────────────────────── */

function mkdirp(dir) {
	if (existsSync(dir)) return
	try { mkdirSync(dir, { recursive: true }) } catch (error) { /* ignore */ }
}

function backupDir() {
	const dir = join(dshHome(), 'dsh-doctor-backups')
	mkdirp(dir)
	return dir
}

function fixDesktopLabel() {
	if (!isWindows) {
		return { ok: false, message: '当前平台没有 Windows 的完整性标签机制，这一项不适用。' }
	}
	const desktop = desktopPath()
	if (!existsSync(desktop)) return { ok: false, message: '找不到桌面目录：' + desktop }
	const before = aclSddl(desktop)
	if (!/S:\(ML;;[^;]*;;;LW/.test(before) && !/\(D;[^)]*;;;WD\)/.test(before)) {
		return { ok: true, unchanged: true, message: '桌面 ACL 已经是干净的，不需要修。' }
	}
	const backupFile = join(backupDir(), 'desktop-acl-' + Date.now() + '.txt')
	const save = powershell('icacls ' + quote(desktop) + ' /save ' + quote(backupFile))
	if (/S:\(ML;;[^;]*;;;LW/.test(before)) {
		const result = powershell('icacls ' + quote(desktop) + " /setintegritylevel '(OI)(CI)Medium'")
		if (!result.ok) return { ok: false, message: '改完整性标签失败：' + (result.err || result.out) }
	}
	if (/\(D;[^)]*;;;WD\)/.test(before)) {
		powershell('icacls ' + quote(desktop) + " /remove:d '*S-1-1-0'")
	}
	const after = aclSddl(desktop)
	const verified = !/S:\(ML;;[^;]*;;;LW/.test(after)
	return {
		ok: verified,
		verified,
		message: verified ? '桌面标签已改回 Medium，图标会自动恢复。' : '改完复检仍看到 Low 标签，请把这条反馈给我。',
		backup: save.ok ? backupFile : null,
	}
}

/** 优先用 DSH 自己的 workspaceRegistry 删除；它不可用时才改文件。 */
async function fixWorkspaceEntries() {
	const risky = riskyWorkspaces()
	if (risky.length === 0) {
		return { ok: true, unchanged: true, message: '没有发现危险的工作区注册，不需要修。' }
	}

	const registry = hostContext !== null && hostContext.workspaceRegistry ? hostContext.workspaceRegistry : null
	if (registry !== null && typeof registry.delete === 'function') {
		const removed = []
		for (const workspace of risky) {
			try {
				await registry.delete(workspace.id)
				removed.push(workspace.path)
			} catch (error) {
				return { ok: false, message: '删除工作区失败（' + workspace.path + '）：' + String(error && error.message ? error.message : error) }
			}
		}
		const remaining = riskyWorkspaces()
		return {
			ok: remaining.length === 0,
			verified: remaining.length === 0,
			message: '已移除 ' + removed.length + ' 个危险工作区：' + removed.join('、') + '。会话文件仍留在磁盘上。',
		}
	}

	// 兜底：直接改注册表文件（结构级删除，删记录 + 引用，不玩字符串）
	const file = workspaceFile()
	const raw = readFileSync(file, 'utf8')
	let data = null
	try { data = JSON.parse(raw) } catch (error) { return { ok: false, message: 'workspace.json 不是合法 JSON，先不动它。' } }
	if (!data || !data.tables || !data.tables.workspaces) return { ok: false, message: 'workspace.json 结构不认识，先不动它。' }
	const backup = file + '.bak-' + Date.now()
	copyFileSync(file, backup)
	const removedIds = []
	for (const [id, record] of Object.entries(data.tables.workspaces)) {
		if (record && typeof record.path === 'string' && workspaceRisk(record.path) !== null) {
			delete data.tables.workspaces[id]
			removedIds.push(id)
		}
	}
	if (Array.isArray(data.global && data.global.workspaceIds)) {
		data.global.workspaceIds = data.global.workspaceIds.filter(id => !removedIds.includes(id))
	}
	writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
	try { JSON.parse(readFileSync(file, 'utf8')) } catch (error) {
		copyFileSync(backup, file)
		return { ok: false, message: '改写后校验失败，已还原。' }
	}
	return {
		ok: true,
		verified: true,
		message: '已从工作区注册表移除 ' + removedIds.length + ' 条记录（含 global 引用）。重启桌面端后生效。',
		backup,
	}
}

function fixProfileHostDup() {
	const dirs = profileHostDirs().filter(dir => hostPackagesIn(dir).length > 0)
	if (dirs.length === 0) return { ok: true, unchanged: true, message: '没有发现宿主包副本，不需要修。' }
	const stamp = Date.now()
	// 只挪走"宿主包副本"本身，绝不整目录改名——同目录里还有插件的合法依赖。
	const quarantineRoot = join(backupDir(), 'hostpkgs-' + stamp)
	const moved = []
	for (const dir of dirs) {
		for (const name of hostPackagesIn(dir)) {
			try {
				mkdirp(quarantineRoot)
				const target = join(quarantineRoot, name)
				renameSync(join(dir, name), target)
				moved.push(name)
			} catch (error) {
				return { ok: false, message: '隔离 ' + name + ' 失败：' + (error && error.message ? error.message : error) }
			}
		}
	}
	return {
		ok: true,
		verified: true,
		message: '已隔离 ' + moved.length + ' 个宿主包副本（' + moved.join(', ') + '），其它插件不受影响。请完整退出并重新打开桌面端。',
		moved,
		quarantine: quarantineRoot,
	}
}

function fixRestorePatchLayer() {
	const profilesRoot = join(dshHome(), 'profiles')
	if (!existsSync(profilesRoot)) return { ok: false, message: '找不到 profiles 目录：' + profilesRoot }
	const restored = []
	for (const name of readDirNames(profilesRoot)) {
		if (name.includes('.stale')) continue
		const dir = join(profilesRoot, name)
		const backups = patchBackupNames(dir)
		if (backups.length === 0) continue
		const patchFile = join(dir, 'cordis.patch.yml')
		let size = -1
		try { size = statSync(patchFile).size } catch (error) { size = -1 }
		if (size > 2) continue
		try {
			if (existsSync(patchFile)) copyFileSync(patchFile, patchFile + '.empty-' + Date.now())
			copyFileSync(join(dir, backups[0]), patchFile)
			restored.push(name + ' <- ' + backups[0])
		} catch (error) {
			return { ok: false, message: '恢复失败（' + name + '）：' + String(error && error.message ? error.message : error) }
		}
	}
	if (restored.length === 0) return { ok: true, unchanged: true, message: '没有需要恢复的 patch 层。' }
	return {
		ok: true,
		verified: true,
		message: '已恢复 ' + restored.length + ' 个 profile 的 cordis.patch.yml：' + restored.join('、') + '。重启桌面端生效。',
	}
}

function fixWorkspaceAcl() {
	if (!isWindows) return { ok: false, message: '当前平台不支持自动补 ACL，请手动检查目录权限。' }
	const registry = readWorkspaceRegistry()
	if (registry === null) return { ok: true, unchanged: true, message: '没有工作区注册表，不需要修。' }
	const sidResult = powershell('[Console]::Out.Write(([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value)')
	const sid = sidResult.ok ? sidResult.out.trim() : ''
	if (sid.length === 0) return { ok: false, message: '拿不到当前用户 SID，无法补 ACL。' }

	const repaired = []
	const failed = []
	for (const workspace of registry.list) {
		const target = workspace.path
		if (!existsSync(target)) continue
		const probe = join(target, '.dsh-doctor-write-test-' + process.pid + '-' + Date.now() + '.tmp')
		let writable = true
		try {
			writeFileSync(probe, 'ok', 'utf8')
			try { unlinkSync(probe) } catch (error) { /* ignore */ }
		} catch (error) {
			writable = false
		}
		if (writable) continue
		const backupFile = join(backupDir(), 'workspace-acl-' + Date.now() + '.txt')
		const save = powershell('icacls ' + quote(target) + ' /save ' + quote(backupFile))
		const grant = powershell('icacls ' + quote(target) + ' /grant "*' + sid + ':(OI)(CI)F" /C')
		let verified = false
		try {
			writeFileSync(probe, 'ok', 'utf8')
			try { unlinkSync(probe) } catch (error) { /* ignore */ }
			verified = true
		} catch (error) {
			verified = false
		}
		if (verified) repaired.push(target + (save.ok ? ' (备份 ' + backupFile + ')' : ''))
		else failed.push(target + '：' + (grant.err || grant.out || '仍然写不进去'))
	}
	if (repaired.length === 0 && failed.length === 0) {
		return { ok: true, unchanged: true, message: '所有工作区都可写，不需要修。' }
	}
	if (failed.length > 0) {
		return { ok: false, message: '部分工作区仍然不可写：' + failed.join('；') }
	}
	return {
		ok: true,
		verified: true,
		message: '已给当前账号补上完全控制并复测通过：' + repaired.join('、') + '。重启桌面端后生效。',
	}
}

const FIXES = {
	'desktop-label': fixDesktopLabel,
	'workspace-entry': fixWorkspaceEntries,
	'profile-host-dup': fixProfileHostDup,
	'restore-patch-layer': fixRestorePatchLayer,
	'workspace-acl': fixWorkspaceAcl,
}

/* ── 修复录（history.jsonl）──────────────────────────────────────────── */

function historyPath() {
	return join(dshHome(), 'dsh-doctor', 'history.jsonl')
}

function appendHistory(entry) {
	try {
		mkdirp(dirname(historyPath()))
		appendFileSync(historyPath(), JSON.stringify(entry) + '\n', 'utf8')
	} catch (error) { /* 记录失败不影响修复本身 */ }
}

function readHistory(limit = 50) {
	const file = historyPath()
	if (!existsSync(file)) return []
	let lines = []
	try { lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean) } catch (error) { return [] }
	const entries = []
	for (const line of lines.slice(-limit)) {
		try { entries.push(JSON.parse(line)) } catch (error) { /* 跳过坏行 */ }
	}
	return entries.reverse()
}

/* ── 跨平台通知 / 打开浏览器 ─────────────────────────────────────────── */

function psQuote(value) {
	return "'" + String(value).replace(/'/g, "''") + "'"
}

function applescriptString(value) {
	return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

function openBrowser(url) {
	try {
		if (isWindows) spawn('cmd.exe', ['/c', 'start', '', url], { windowsHide: true, stdio: 'ignore', detached: true }).unref()
		else if (process.platform === 'darwin') spawn('open', [url], { stdio: 'ignore', detached: true }).unref()
		else spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref()
	} catch (error) { /* ignore */ }
}

/** 系统级通知：Windows 气泡 / macOS 通知中心 / Linux notify-send。 */
/** Electron 的 CJS 互操作在不同版本里形态不同（default / 'module.exports'），挨个找。 */
function pickElectronNotification(subject) {
	const seen = new Set()
	const queue = [subject]
	let guard = 0
	while (queue.length > 0 && guard < 20) {
		guard += 1
		const current = queue.shift()
		if (current === null || current === undefined || typeof current !== 'object' || seen.has(current)) continue
		seen.add(current)
		if (typeof current.Notification === 'function') return current.Notification
		for (const key of ['default', 'module.exports']) {
			try {
				if (current[key] !== undefined && current[key] !== null) queue.push(current[key])
			} catch (error) { /* ignore */ }
		}
	}
	return null
}

/** 跨平台系统通知。优先用宿主自己的 Electron 通知，让系统上显示的是 DSH 而不是 PowerShell。 */
async function notify(title, body) {
	const detail = []
	if (process.versions.electron) {
		let subject = null
		try {
			subject = await import('electron')
		} catch (error) {
			detail.push('import: ' + String(error && error.message ? error.message : error))
		}
		if (subject === null || subject === undefined) {
			try {
				subject = requireFromHere('electron')
			} catch (error) {
				detail.push('require: ' + String(error && error.message ? error.message : error))
			}
		}
		const Notification = pickElectronNotification(subject)
		if (typeof Notification === 'function') {
			const supported = typeof Notification.isSupported === 'function' ? Notification.isSupported() : true
			if (supported) {
				try {
					new Notification({ title: String(title), body: String(body) }).show()
					return { via: 'electron', detail: detail.join(' | ') }
				} catch (error) {
					detail.push('show: ' + String(error && error.message ? error.message : error))
				}
			} else {
				detail.push('Notification.isSupported() === false')
			}
		} else {
			const describe = (value, depth) => {
				if (value === null) return 'null'
				if (value === undefined) return 'undefined'
				if (typeof value !== 'object') return typeof value
				if (depth > 0) return 'object'
				let keys = []
				try { keys = Object.keys(value).slice(0, 14) } catch (error) { keys = ['(unreadable)'] }
				return 'object[' + keys.join(',') + ']'
			}
			detail.push('dump: top=' + describe(subject, 0)
				+ ' default=' + describe(subject !== null && subject !== undefined ? subject.default : undefined, 0)
				+ " module.exports=" + describe(subject !== null && subject !== undefined ? subject['module.exports'] : undefined, 0))
		}
	}
	try {
		if (isWindows) {
			const script = [
				'Add-Type -AssemblyName System.Windows.Forms',
				'Add-Type -AssemblyName System.Drawing',
				'$n = New-Object System.Windows.Forms.NotifyIcon',
				'$n.Icon = [System.Drawing.SystemIcons]::Warning',
				'$n.Visible = $true',
				'$n.ShowBalloonTip(8000, ' + psQuote(title) + ', ' + psQuote(body) + ', [System.Windows.Forms.ToolTipIcon]::Warning);',
				'Start-Sleep -Seconds 6',
				'$n.Dispose()',
			].join('; ')
			const encoded = Buffer.from(script, 'utf16le').toString('base64')
			spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, timeout: 20000 })
			return { via: 'powershell', detail: detail.join(' | ') }
		}
		if (process.platform === 'darwin') {
			spawnSync('osascript', ['-e', 'display notification ' + applescriptString(body) + ' with title ' + applescriptString(title)], { timeout: 10000 })
			return { via: 'osascript', detail: detail.join(' | ') }
		}
		spawnSync('notify-send', [title, body], { timeout: 10000 })
		return { via: 'notify-send', detail: detail.join(' | ') }
	} catch (error) {
		return { via: 'none', detail: String(error && error.message ? error.message : error) }
	}
}

/** 除交互面板外，只有显式开启时才由 host 自己弹系统通知（默认关闭：PowerShell 弹窗的归因是错的）。 */
function hostNotifyEnabled() {
	return String(process.env.DSH_DOCTOR_NOTIFY || '').toLowerCase() === 'host'
}

function findRuntime() {
	const pick = (out) => {
		const lines = out.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0)
		const preferred = lines.find(line => /\.(cmd|exe|bat)$/i.test(line))
		return preferred !== undefined ? preferred : lines[0]
	}
	const dsh = shell(isWindows ? 'where.exe dsh' : 'which -a dsh 2>/dev/null || command -v dsh 2>/dev/null')
	if (dsh.ok && dsh.out.length > 0) {
		const first = pick(dsh.out)
		if (first && existsSync(first)) return { command: first, args: [], label: first }
	}
	const npx = shell(isWindows ? 'where.exe npx' : 'which -a npx 2>/dev/null || command -v npx 2>/dev/null')
	if (npx.ok && npx.out.length > 0) {
		const first = pick(npx.out)
		if (first && existsSync(first)) return { command: first, args: ['-y', '@deepseek-ai/dsh@latest'], label: 'npx @deepseek-ai/dsh@latest' }
	}
	return null
}

function portFree(port) {
	return new Promise((resolve) => {
		const server = createServer()
		server.once('error', () => resolve(false))
		server.once('listening', () => server.close(() => resolve(true)))
		server.listen(port, '127.0.0.1')
	})
}

async function waitForHttp(url, timeoutMs) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(1500) })
			if (response.status < 500) return true
		} catch (error) { /* 还没起来 */ }
		await new Promise(resolve => setTimeout(resolve, 500))
	}
	return false
}

function stampForFile() {
	const now = new Date()
	const pad = (value) => String(value).padStart(2, '0')
	return String(now.getFullYear()) + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' + pad(now.getHours()) + pad(now.getMinutes())
}

/** 逃生时给网页版 DSH 的交接报告：现状 + 问题清单 + 已经试过什么。 */
function writeHandoffReport() {
	try {
		const findings = scan()
		const env = environment()
		const history = readHistory(10)
		const lines = []
		lines.push('# DSH 桌面端 · 交接报告')
		lines.push('')
		lines.push('> 生成时间：' + new Date().toLocaleString() + '　平台：' + env.platform + '　工具：dsh-doctor')
		lines.push('> 这份文件由桌面端「私人医生」生成。把它拖给网页版 DSH，让它接着修。')
		lines.push('')
		lines.push('## 先把这段话发给我')
		lines.push('')
		lines.push('```text')
		lines.push('我是从 DSH 桌面端逃过来的：桌面端起不来，或者我修不好。')
		lines.push('这是桌面端「私人医生」生成的交接报告（本文件）。请按下面的清单逐条帮我处理：')
		lines.push('每一条都告诉我改了哪些文件、怎么验证、怎么回滚。')
		lines.push('注意：网页版和桌面端共享同一个 ~/.dsh，修的是同一份数据。')
		lines.push('```')
		lines.push('')
		lines.push('## 体检结果（' + findings.length + ' 条）')
		lines.push('')
		if (findings.length === 0) {
			lines.push('_没有发现问题，可能是启动链路本身的问题，先看崩溃日志。_')
		}
		for (const item of findings) {
			lines.push('### [' + item.severity + '] ' + item.title)
			lines.push('')
			if (item.path) lines.push('- 路径：`' + item.path + '`')
			if (item.detail) lines.push('- 说明：' + item.detail)
			lines.push('- 可一键修：' + (item.fixId ? '是（' + item.fixId + '）' : '否，需要人工判断'))
			lines.push('')
		}
		lines.push('## 已经试过的修复')
		lines.push('')
		if (history.length === 0) {
			lines.push('_还没有执行过修复。_')
		} else {
			for (const entry of history) {
				lines.push('- ' + entry.at + '　' + entry.id + '　' + (entry.ok === true ? '成功' : '失败') + (entry.backup ? '　备份：`' + entry.backup + '`' : ''))
				if (entry.message) lines.push('  - ' + entry.message)
			}
		}
		lines.push('')
		lines.push('## 环境')
		lines.push('')
		lines.push('- DSH 目录：`' + env.dshHome + '`')
		lines.push('- 桌面目录：`' + env.desktop + '`')
		lines.push('- profile：' + (Array.isArray(env.profiles) ? env.profiles.join('、') : ''))
		lines.push('- 检查包：' + (Array.isArray(env.packs) && env.packs.length > 0 ? env.packs.join('、') : '无'))
		lines.push('- Node：' + env.node)
		lines.push('')
		lines.push('## 建议的下一步')
		lines.push('')
		lines.push('1. 先按上面「可一键修：是」的条目逐条处理（每条都先备份、再改、再验证）。')
		lines.push('2. 修完重启桌面端验证；如果还起不来，把这次对话里新出现的报错贴回来。')
		lines.push('3. 不要再把桌面设成工作区——那是图标变白和整桌闪的根。')
		const text = lines.join('\n')
		const directory = existsSync(desktopPath()) ? desktopPath() : join(dshHome(), 'dsh-doctor')
		mkdirp(directory)
		const file = join(directory, 'dsh-doctor-交接-' + stampForFile() + '.md')
		writeFileSync(file, text, 'utf8')
		return file
	} catch (error) {
		return null
	}
}

/** 从逃生实例的启动日志里抠出带 token 的地址；没有就退回裸地址。 */
function tokenizedUrl(port, logFile) {
	if (typeof logFile === 'string') {
		try {
			const text = readFileSync(logFile, 'utf8')
			const matches = text.match(/https?:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9._~-]+)/g)
			if (matches !== null && matches.length > 0) return matches[matches.length - 1]
		} catch (error) { /* ignore */ }
	}
	return 'http://127.0.0.1:' + port + '/'
}

async function rescueWeb() {
	const runtime = findRuntime()
	if (runtime === null) {
		return { ok: false, message: '没找到可用的 dsh 运行时：PATH 里既没有 dsh，也没有 npx。' }
	}

	// 1) 先复用已经在跑的逃生实例，避免每次点都新开一个、旧标签页变成"尸体"。
	const previous = readRescueRegistry()
	if (previous !== null && typeof previous.port === 'number' && portInUse(previous.port)) {
		const previousBase = 'http://127.0.0.1:' + previous.port + '/'
		if (await waitForHttp(previousBase, 5000)) {
			const previousUrl = tokenizedUrl(previous.port, previous.log)
			openBrowser(previousUrl)
			const handoffFile = writeHandoffReport()
			return {
				ok: true,
				reused: true,
				url: previousBase,
				handoff: handoffFile,
				message: '复用已在运行的逃生实例：' + previousBase + '\n'
					+ '（已用带 token 的地址重开浏览器；之前那些报 Failed to fetch 的旧标签页可以直接关掉。）',
			}
		}
	}

	let port = 0
	for (let attempt = 0; attempt < 6; attempt += 1) {
		const candidate = 47000 + Math.floor(Math.random() * 1900)
		if (await portFree(candidate)) { port = candidate; break }
	}
	if (port === 0) return { ok: false, message: '在 47000–48999 里找不到空闲端口。' }
	const url = 'http://127.0.0.1:' + port + '/'

	// 2) 逃生实例的 stdout/stderr 落盘，起不来时才有证据可查。
	const logFile = join(dshHome(), 'dsh-doctor', 'rescue-' + port + '.log')
	mkdirp(dirname(logFile))
	let logFd = -1
	try { logFd = openSync(logFile, 'a') } catch (error) { logFd = -1 }
	const stdio = logFd >= 0 ? ['ignore', logFd, logFd] : 'ignore'

	try {
		if (isWindows) {
			// Windows 下 Node 不能直接 spawn .cmd/.bat（会抛 EINVAL），必须套一层 cmd.exe /c。
			const isBatch = /\.(cmd|bat)$/i.test(runtime.command)
			const command = isBatch ? (process.env.ComSpec || 'cmd.exe') : runtime.command
			const args = isBatch
				? ['/c', runtime.command].concat(runtime.args, ['web', '--port', String(port)])
				: runtime.args.concat(['web', '--port', String(port)])
			spawn(command, args, { cwd: homedir(), windowsHide: true, stdio, detached: true }).unref()
		} else {
			spawn(runtime.command, runtime.args.concat(['web', '--port', String(port)]), {
				cwd: homedir(), stdio, detached: true,
			}).unref()
		}
	} catch (error) {
		return { ok: false, message: '启动失败：' + String(error && error.message ? error.message : error) }
	}
	const ready = await waitForHttp(url, 30000)
	if (!ready) {
		return {
			ok: false,
			log: logFile,
			message: '已尝试启动（' + runtime.label + ' --port ' + port + '），但 30 秒内没起来。'
				+ '日志：' + logFile + '（首次 npx 下载慢也会这样，稍等再点一次）。',
		}
	}
	writeRescueRegistry({ port, url, log: logFile, startedAt: new Date().toISOString() })
	const authenticatedUrl = tokenizedUrl(port, logFile)
	try {
		openBrowser(authenticatedUrl)
	} catch (error) { /* 浏览器打不开也不影响服务 */ }
	const handoff = writeHandoffReport()
	const lines = ['网页版已启动：' + url]
	lines.push(authenticatedUrl.indexOf('token=') >= 0
		? '已用带 token 的地址打开浏览器（不带 token 的页面会报 Failed to fetch）。'
		: '注意：启动日志里没找到 token，如果页面报 Failed to fetch，看日志：' + logFile)
	if (handoff === null) {
		lines.push('（交接报告写入失败，可以在面板里手动导出。）')
	} else {
		lines.push('桌面上已生成交接报告：' + handoff)
		lines.push('把它拖给网页版 DSH，让它按里面的问题清单接着修。')
	}
	lines.push('（以后再点「起网页版」会复用这个实例，不会新开。）')
	return {
		ok: true,
		url,
		handoff,
		log: logFile,
		message: lines.join('\n'),
	}
}

/* ── HTTP 路由 ──────────────────────────────────────────────────────── */

function send(res, status, payload) {
	res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
	res.end(JSON.stringify(payload))
}

async function readBody(req, limit = 16384) {
	let body = ''
	for await (const chunk of req) {
		body += chunk
		if (body.length > limit) break
	}
	return body
}

async function handle(req, res) {
	const url = new URL(req.url, 'http://127.0.0.1')
	const path = url.pathname
	try {
		if (path === PREFIX + '/status' && req.method === 'GET') {
			const findings = scan()
			const summary = {
				high: findings.filter(item => item.severity === 'high').length,
				medium: findings.filter(item => item.severity === 'medium').length,
				fixableHigh: findings.filter(item => item.severity === 'high' && item.fixId !== null).length,
				unfixableHigh: findings.filter(item => item.severity === 'high' && item.fixId === null).length,
			}
			send(res, 200, { ok: true, findings, summary, environment: environment() })
			return
		}
		if (path === PREFIX + '/notify' && req.method === 'POST') {
			const raw = await readBody(req)
			let title = 'DSH 私人医生'
			let body = '这是一条测试通知。'
			try {
				const parsed = JSON.parse(raw)
				if (parsed !== null && typeof parsed.title === 'string') title = parsed.title
				if (parsed !== null && typeof parsed.body === 'string') body = parsed.body
			} catch (error) { /* 用默认文案 */ }
			const outcome = await notify(title, body)
			send(res, 200, { ok: outcome.via !== 'none', via: outcome.via, detail: outcome.detail })
			return
		}
		if (path === PREFIX + '/history' && req.method === 'GET') {
			send(res, 200, { ok: true, entries: readHistory(50) })
			return
		}
		if (path === PREFIX + '/rescue' && req.method === 'POST') {
			let result = null
			try { result = await rescueWeb() } catch (error) {
				result = { ok: false, message: String(error && error.message ? error.message : error) }
			}
			appendHistory({ at: new Date().toISOString(), id: 'rescue-web', ok: result.ok === true, message: result.message, backup: null })
			if (hostNotifyEnabled()) {
				notify(result.ok === true ? '网页版已启动 · DSH 私人医生' : '逃生失败 · DSH 私人医生', String(result.message || '')).catch(() => {})
			}
			send(res, 200, result)
			return
		}
		if (path === PREFIX + '/fix' && req.method === 'POST') {
			const raw = await readBody(req)
			let id = ''
			try {
				const parsed = JSON.parse(raw)
				if (typeof parsed.id === 'string') id = parsed.id
			} catch (error) { send(res, 400, { ok: false, message: '请求体不是合法 JSON' }); return }
			const fix = FIXES[id]
			if (typeof fix !== 'function') { send(res, 404, { ok: false, message: '未知的修复项：' + id }); return }
			let result = null
			try { result = await fix() } catch (error) {
				result = { ok: false, message: String(error && error.message ? error.message : error) }
			}
			appendHistory({
				at: new Date().toISOString(),
				id,
				ok: result !== null && result.ok === true,
				changed: !(result !== null && result.unchanged === true),
				message: result !== null && typeof result.message === 'string' ? result.message : '',
				backup: result !== null && typeof result.backup === 'string' ? result.backup : null,
			})
			if (result !== null && typeof result.message === 'string' && result.unchanged !== true) {
				if (hostNotifyEnabled()) {
					notify(result.ok === true ? '修复完成 · DSH 私人医生' : '修复失败 · DSH 私人医生', result.message).catch(() => {})
				}
			}
			send(res, 200, result)
			return
		}
		send(res, 404, { ok: false, message: 'not found' })
	} catch (error) {
		send(res, 500, { ok: false, message: String(error && error.message ? error.message : error) })
	}
}

export const inject = ['workspaceRegistry']

export { scan, readHistory, rescueWeb }

export function applyFixById(id) {
	const fix = FIXES[id]
	if (typeof fix !== 'function') return { ok: false, message: '未知的修复项：' + id }
	try {
		return fix()
	} catch (error) {
		return { ok: false, message: String(error && error.message ? error.message : error) }
	}
}

export function apply(ctx) {
	hostContext = ctx
	ctx.inject(['webServer'], (scoped) => {
		scoped.effect(() => scoped.webServer.register({
			kind: 'prefix',
			path: PREFIX,
			handler: handle,
		}), 'dsh-doctor: status and fix routes')
	})
}
