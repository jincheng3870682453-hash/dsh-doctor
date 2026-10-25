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
import { homedir, hostname } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import * as zlib from 'node:zlib'

import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'

const requireFromHere = createRequire(import.meta.url)

const zstdDecompress = typeof zlib.zstdDecompressSync === 'function' ? zlib.zstdDecompressSync : null
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

const PREFIX = '/dsh-doctor'
const CRITICAL_HOST_PACKAGES = ['dsh-tools', 'dsh-skill', 'schemastery', 'dsh-util-values', 'cordis']

/**
 * 桌面 Low 完整性标签的判据。字段结构固定：ML;flags;rights;;;SID。
 * flags 吸收继承/递归标志（空、ID、CIOI），前缀 (?:AI) 吸收 SACL 自动继承控制位——
 * DSH 直写的标签是 S:(ML;;NW;;;LW)，SetNamedSecurityInfoW 写的读回是 S:AI(ML;CIOI;NW;;;ME)。
 */
const LOW_LABEL_PATTERN = /S:(?:AI)?\(ML;[^;]*;[^;]*;;;LW/

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

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, 'utf8'))
	} catch (error) {
		return null
	}
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

/* ── doctor-sys 桥（P1）：DSH_DOCTOR_SYS 指向引擎 exe 时，ACL/外壳动作优先走它 ── */

function doctorSysPath() {
	const configured = process.env.DSH_DOCTOR_SYS
	if (typeof configured === 'string' && configured.length > 0 && existsSync(configured)) return configured
	return null
}

/**
 * 调 doctor-sys 原语（CLI 形式，JSON 一行应答）。
 * 返回解析后的应答对象（含 ok:false 的失败应答）；没配/起不来/输出不合法返回 null，
 * 调用方据此回退 PowerShell。协议见 doctor-sys/README.md。
 */
function doctorSys(op, args = {}, timeout = 20000) {
	const exe = doctorSysPath()
	if (exe === null) return null
	const cli = [op]
	for (const [key, value] of Object.entries(args)) {
		if (value === true) cli.push('--' + key)
		else if (value !== false && value !== null && value !== undefined) cli.push('--' + key, String(value))
	}
	try {
		// Windows 上 spawnSync 不能直接跑 .cmd/.bat（EINVAL），必须套 cmd.exe /c。
		// 这样桥接也能接受 .cmd 假引擎/包装脚本（测试与自定义引擎都受益）。
		const isBatch = isWindows && /\.(cmd|bat)$/i.test(exe)
		const command = isBatch ? (process.env.ComSpec || 'cmd.exe') : exe
		const argv = isBatch ? ['/c', exe, ...cli] : cli
		const run = spawnSync(command, argv, { windowsHide: true, encoding: 'utf8', timeout })
		if (run.error || run.status !== 0 || typeof run.stdout !== 'string') return null
		const line = run.stdout.split(/\r?\n/, 1)[0]
		const parsed = JSON.parse(line)
		return typeof parsed === 'object' && parsed !== null ? parsed : null
	} catch (error) {
		return null
	}
}

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
	// 引擎优先：一次拿到完整 SDDL（含标签），比再开一个 PowerShell 快一个数量级。
	const viaEngine = doctorSys('acl-read', { path })
	if (viaEngine !== null && viaEngine.ok === true && viaEngine.data && typeof viaEngine.data.sddl === 'string') {
		return viaEngine.data.sddl
	}
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
	if (sddl.length === 0) {
		// 读不到 ≠ 干净：静默漏报比误报更危险（PS 版一直有这条，这里对齐）。
		findings.push(finding('desktop-acl-unreadable', 'medium',
			'桌面 ACL 读不到，无法判断完整性标签',
			'引擎和 PowerShell 都没拿到桌面的 SDDL。可能是权限或系统策略问题；修图标前先解决读取。',
			desktop, null))
		return findings
	}
	if (LOW_LABEL_PATTERN.test(sddl)) {
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

/**
 * 第三方插件在模块加载阶段抛错（ReferenceError/TypeError…）时，DSH 会直接
 * 弹「应用无法启动」。崩溃日志里有插件文件路径，这条检查负责把它指出来。
 */
function checkPluginBootFailure() {
	const findings = []
	const logDir = crashLogDir()
	if (!existsSync(logDir)) return findings
	let files = []
	try { files = readdirSync(logDir).filter(name => name.startsWith('crash-')) } catch (error) { return findings }
	const seen = new Set()
	for (const name of files) {
		let text = ''
		try { text = readFileSync(join(logDir, name), 'utf8').slice(0, 65536) } catch (error) { continue }
		// 第一种：启动器直接写「<插件>: import failed」，没有文件路径。
		const bootMatch = /(?:^|\n)\s*([a-z0-9][\w@/.-]*): import failed/i.exec(text)
		if (bootMatch !== null) {
			const pluginName = bootMatch[1]
			if (!seen.has('boot|' + pluginName)) {
				seen.add('boot|' + pluginName)
				findings.push(finding('plugin-boot-failure', 'medium',
					'插件启动失败：' + pluginName,
					'崩溃日志显示 `' + pluginName + '` 在启动阶段 import 失败，宿主因此没起来。'
						+ '常见原因：插件刚自更新/自重载（文件正被替换）、或与当前 DSH 版本不兼容。'
						+ '先重启一次；如果反复出现，就禁用/更新这个插件。崩溃日志：' + name,
					join(logDir, name), null))
			}
			continue
		}
		if (!text.includes('file:///')) continue
		const error = /(ReferenceError|TypeError|SyntaxError|RangeError): ([^\r\n]+)/.exec(text)
		if (error === null) continue
		const fileMatch = /file:\/\/\/([^\s)'"]+?\.(?:js|mjs|cjs|ts))/.exec(text)
		if (fileMatch === null) continue
		let filePath = fileMatch[1]
		try { filePath = decodeURIComponent(filePath) } catch (error) { /* 保留原样 */ }
		filePath = filePath.replace(/\//g, '\\')
		if (!/^[A-Za-z]:/.test(filePath)) filePath = filePath.replace(/^\\/, '')
		const key = error[1] + '|' + filePath
		if (seen.has(key)) continue
		seen.add(key)
		findings.push(finding('plugin-boot-failure', 'high',
			'第三方插件在启动时崩溃：' + error[2].slice(0, 80),
			'`' + filePath + '` 在模块加载阶段抛出 `' + error[1] + ': ' + error[2] + '`，DSH 宿主直接起不来。'
				+ '这是插件代码的问题，不是 DSH 本体：ESM 是严格模式，引用未声明的变量（比如漏写 `const server = …`）就会这样。'
				+ '处理：在启动失败对话框点「禁用第三方插件、备份 profile patch 并重启」；再到该插件目录修掉/更新/移除它。'
				+ '崩溃日志：' + name,
			join(logDir, name), null))
	}
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

/**
 * profile 里注册的 stdio MCP server：任何一条加载失败，host 会直接退出，
 * 桌面端表现为「应用无法启动或已意外停止」。这里做启动前的静态体检：
 * 入口文件是否存在、能不能过 `node --check`。
 */
function checkMcpEntries() {
	const findings = []
	const profilesRoot = join(dshHome(), 'profiles')
	if (!existsSync(profilesRoot)) return findings
	let nodeBinary = null
	for (const candidate of ['node', 'node.exe']) {
		const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 5000 })
		if (probe.status === 0) { nodeBinary = candidate; break }
	}
	for (const name of readDirNames(profilesRoot)) {
		if (name.includes('.stale')) continue
		const patchFile = join(profilesRoot, name, 'cordis.patch.yml')
		let text = ''
		try { text = readFileSync(patchFile, 'utf8') } catch (error) { continue }
		const lines = text.split(/\r?\n/)
		lines.forEach((line, index) => {
			if (!line.includes('@deepseek-ai/dsh-mcp-client')) return
			const block = lines.slice(index, index + 40).join('\n')
			for (const match of block.matchAll(/([A-Za-z]:[\\/][^"'\s,]+?\.(?:js|mjs|cjs))/g)) {
				const entry = match[1].replace(/\//g, '\\')
				if (!existsSync(entry)) {
					findings.push(finding('mcp-entry-broken', 'high',
						'MCP server 入口文件不存在：' + entry.split('\\').pop(),
						'profile「' + name + '」注册了这个 stdio MCP server，但入口文件不存在。'
							+ '**任何一个 MCP server 加载失败，DSH host 都会直接退出**，桌面端就是「应用无法启动或已意外停止」。'
							+ '修复：补回该文件，或从 cordis.patch.yml 里移除这一行。',
						entry, null))
					continue
				}
				if (nodeBinary === null) continue
				const check = spawnSync(nodeBinary, ['--check', entry], { encoding: 'utf8', timeout: 5000 })
				if (check.status !== 0) {
					const reason = String(check.stderr || '').split(/\r?\n/).filter(item => item.trim().length > 0).slice(-2).join(' ')
					findings.push(finding('mcp-entry-broken', 'high',
						'MCP server 入口无法加载：' + entry.split('\\').pop(),
						'`node --check` 失败：' + (reason || '未知语法错误') + '。'
							+ 'DSH 启动时只要有一个 MCP server 加载失败，host 就直接退出。修复该文件，或先从 patch 里移除这一行。',
						entry, null))
				}
			}
		})
	}
	return findings
}

/**
 * 启动失败时常见的自救是把 ~/.dsh 改名后重开，DSH 会新建一份干净家目录。
 * 旧目录还在旁边，会话/插件/设置都在里面——这条检查防止"救活了但把数据忘了"。
 */
function checkStaleHomeBackup() {
	const findings = []
	const home = dshHome()
	const parent = dirname(home)
	let names = []
	try { names = readdirSync(parent) } catch (error) { return findings }
	const current = home.toLowerCase()
	for (const name of names) {
		if (!/^\.dsh(?:[._\s-]|$)/i.test(name)) continue
		const path = join(parent, name)
		if (path.toLowerCase() === current) continue
		if (!existsSync(join(path, 'profiles')) && !existsSync(join(path, 'sessions')) && !existsSync(join(path, 'storages'))) continue
		let sessionCount = 0
		try {
			const sessionsDir = join(path, 'sessions')
			if (existsSync(sessionsDir)) {
				for (const workspace of readdirSync(sessionsDir)) {
					try { sessionCount += readdirSync(join(sessionsDir, workspace)).length } catch (error) { /* skip */ }
				}
			}
		} catch (error) { /* skip */ }
		findings.push(finding('stale-home-backup', 'medium',
			'发现旧 DSH 家目录（可能是改名救急留下的）：' + name,
			'当前家目录是 `' + home + '`，旁边还有一份 `' + path + '`'
				+ (sessionCount > 0 ? '（约 ' + sessionCount + ' 个会话目录）' : '')
				+ '。多半是启动失败时把它改名绕过、让 DSH 新建了一份干净配置。'
				+ '**先别删**：需要找回会话/插件/设置时从里面拷；确认不要了再清理。',
			path, null))
	}
	return findings
}

/** storages 下的 JSON 损坏时，相关的启动/加载可能直接失败；这里做只读解析。 */
function checkStorageCorrupt() {
	const findings = []
	const dir = join(dshHome(), 'storages')
	if (!existsSync(dir)) return findings
	let names = []
	try { names = readdirSync(dir) } catch (error) { return findings }
	for (const name of names) {
		if (!name.endsWith('.json')) continue
		const path = join(dir, name)
		let size = 0
		try { size = statSync(path).size } catch (error) { continue }
		if (size > 8 * 1024 * 1024) continue
		try {
			JSON.parse(readFileSync(path, 'utf8'))
		} catch (error) {
			findings.push(finding('storage-corrupt', 'medium',
				'存储文件损坏：' + name,
				'`' + path + '` 不是合法 JSON（' + String(error.message || error).slice(0, 120) + '）。'
					+ 'DSH 启动/加载相关状态时可能直接失败。修复：先备份这个文件，再删除让它重建；'
					+ '需要保数据时把文件发出来人工修。',
				path, null))
		}
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
		} catch (error) {
			const message = String(error && error.message ? error.message : error)
			findings.push(finding('workspace-not-writable', 'high',
				'工作区写不进去：' + workspace.title,
				'医生真写了一个临时文件来验证，失败了：' + message
					+ '。表现就是 DSH 起不来、终端一开就报 grantWrite / EACCES。'
					+ (isWindows ? '一键修复会给当前账号补上完全控制（先备份 ACL）。' : '请手动检查该目录权限。'),
				target, isWindows ? 'workspace-acl' : null))
		} finally {
			// 无论成败都清理（writeFileSync 抛错时也可能留下半截文件），绝不给用户留垃圾。
			try { unlinkSync(probe) } catch (error) { /* 删不掉不算致命 */ }
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
	'plugin-boot-failure': () => checkPluginBootFailure(),
	'session-legacy-kind': () => checkLegacySessions(),
	'credentials-version': () => checkCredentials(),
	'patch-layer-missing': () => checkPatchLayer(),
	'mcp-entry-broken': () => checkMcpEntries(),
	'path-dead-dsh': () => checkPathVariable(),
	'stale-home-backup': () => checkStaleHomeBackup(),
	'storage-corrupt': () => checkStorageCorrupt(),
	'rescue-instance-dead': () => checkRescueInstance(),
	'workspace-not-writable': () => checkWorkspaceWritability(),
	'workspace-not-grantable': () => checkWorkspaceGrantability(),
	'zombie-dsh-process': () => checkZombieProcesses(),
	'bundle-identity-drift': () => checkBundleIdentityDrift(),
	'bundle-version-skew': () => checkBundleVersionSkew(),
	'runtime-metadata-stale': () => checkRuntimeMetadataStale(),
	'permission-too-broad': () => checkPermissionTooBroad(),
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
		const isLow = LOW_LABEL_PATTERN.test(sddl)
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
		checkPluginBootFailure,
		checkLegacySessions,
		checkCredentials,
		checkPatchLayer,
		checkMcpEntries,
		checkPathVariable,
		checkStaleHomeBackup,
		checkStorageCorrupt,
		checkRescueInstance,
		checkWorkspaceWritability,
		checkWorkspaceGrantability,
		checkZombieProcesses,
		checkBundleIdentityDrift,
		checkBundleVersionSkew,
		checkRuntimeMetadataStale,
		checkPermissionTooBroad,
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

/* ── 异步体检（worker 线程 + 缓存，别卡住宿主）───────────────────────── */

let scanWorker = null
let scanRequestId = 0
const scanWaiters = new Map()
let scanCache = { at: 0, findings: null }

/** 上次体检结果落盘：面板打开时直接读它，不再一进来就全量扫描。 */
function lastScanFile() {
	return join(dshHome(), 'dsh-doctor', 'last-scan.json')
}

function readLastScan() {
	const data = readJson(lastScanFile())
	if (data === null || !Array.isArray(data.findings)) return null
	return { at: typeof data.at === 'number' ? data.at : 0, findings: data.findings }
}

function saveLastScan(findings) {
	try {
		mkdirSync(join(dshHome(), 'dsh-doctor'), { recursive: true })
		writeFileSync(lastScanFile(), JSON.stringify({ at: Date.now(), findings }))
	} catch (error) { /* 落盘失败不影响体检 */ }
}

function ensureScanWorker() {
	if (scanWorker !== null) return scanWorker
	try {
		scanWorker = new Worker(new URL('./scan-worker.mjs', import.meta.url))
		scanWorker.unref()
		scanWorker.on('message', (message) => {
			const waiter = scanWaiters.get(message && message.id)
			if (waiter === undefined) return
			scanWaiters.delete(message.id)
			if (message.ok === true) waiter.resolve(message.findings)
			else waiter.reject(new Error(String(message.message || 'scan worker failed')))
		})
		scanWorker.on('error', (error) => {
			for (const waiter of scanWaiters.values()) waiter.reject(error)
			scanWaiters.clear()
			scanWorker = null
		})
		scanWorker.on('exit', () => { scanWorker = null })
	} catch (error) {
		scanWorker = null
	}
	return scanWorker
}

function scanInWorker() {
	const worker = ensureScanWorker()
	if (worker === null) return Promise.reject(new Error('worker unavailable'))
	const id = (scanRequestId += 1)
	return new Promise((resolve, reject) => {
		scanWaiters.set(id, { resolve, reject })
		try {
			worker.postMessage({ id })
		} catch (error) {
			scanWaiters.delete(id)
			reject(error)
			return
		}
		setTimeout(() => {
			if (!scanWaiters.has(id)) return
			scanWaiters.delete(id)
			reject(new Error('scan worker timeout'))
		}, 30000)
	})
}

/** 体检结果缓存 8 秒：面板打开、图标轮询、报告生成不会反复全量扫描。 */
async function scanCached() {
	const now = Date.now()
	if (scanCache.findings !== null && now - scanCache.at < 8000) return scanCache.findings
	try {
		const findings = await scanInWorker()
		scanCache = { at: Date.now(), findings }
		saveLastScan(findings)
		return findings
	} catch (error) {
		const message = String(error && error.message ? error.message : error)
		// 超时/崩溃：先终止卡住的 worker，再如实报错；不要退回同步扫描把宿主也拖死。
		if (scanWorker !== null) {
			try { scanWorker.terminate() } catch (terminateError) { /* ignore */ }
			scanWorker = null
		}
		if (/timeout/i.test(message)) {
			throw new Error('体检超时（后台扫描超过 30 秒），请重试；如果反复超时，先把体检交给独立 EXE：dsh-doctor.exe scan')
		}
		// worker 起不来（老运行时 / 权限）就退回同步扫描，功能不能因此消失。
		const findings = scan()
		scanCache = { at: Date.now(), findings }
		saveLastScan(findings)
		return findings
	}
}

function environment() {	return {
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

/** 改 ACL 的互斥锁：自动巡检和手动修复可能同时动手，互相覆盖。 */
function acquireAclLock() {
	const file = join(dshHome(), 'dsh-doctor', 'acl.lock')
	try {
		mkdirp(dirname(file))
		if (existsSync(file)) {
			let age = 0
			try { age = Date.now() - statSync(file).mtimeMs } catch (error) { age = 0 }
			if (age < 120000) return null
			try { unlinkSync(file) } catch (error) { /* 过期锁清掉 */ }
		}
		writeFileSync(file, String(process.pid), 'utf8')
		return file
	} catch (error) {
		return null
	}
}

function releaseAclLock(file) {
	try { unlinkSync(file) } catch (error) { /* ignore */ }
}

function fixDesktopLabel() {
	const lock = acquireAclLock()
	if (lock === null) return { ok: false, message: '另一个 ACL 修复正在进行，稍后再试。' }
	try {
		return fixDesktopLabelUnlocked()
	} finally {
		releaseAclLock(lock)
	}
}

function fixDesktopLabelUnlocked() {
	if (!isWindows) {
		return { ok: false, message: '当前平台没有 Windows 的完整性标签机制，这一项不适用。' }
	}
	const desktop = desktopPath()
	if (!existsSync(desktop)) return { ok: false, message: '找不到桌面目录：' + desktop }
	const before = aclSddl(desktop)
	if (before.length === 0) {
		// 读不到就动手是瞎修：明确失败，让用户知道当前看不到桌面 ACL 的状态。
		return { ok: false, message: '读不到桌面 ACL（引擎和 PowerShell 都失败了），不敢动手。可以先重新体检看看详情。' }
	}
	if (!LOW_LABEL_PATTERN.test(before) && !/\(D;[^)]*;;;WD\)/.test(before)) {
		return { ok: true, unchanged: true, message: '桌面 ACL 已经是干净的，不需要修。' }
	}
	const backupFile = join(backupDir(), 'desktop-acl-' + Date.now() + '.txt')
	// 备份仍用 icacls /save 的格式（EXE 的回滚路径认它）；引擎只在 icacls 不可用时兜底。
	let save = powershell('icacls ' + quote(desktop) + ' /save ' + quote(backupFile))
	let engineUsed = false
	if (!save.ok && doctorSysPath() !== null) {
		const viaEngine = doctorSys('acl-save', { path: desktop, file: backupFile + '.json' })
		if (viaEngine !== null && viaEngine.ok === true) save = { ok: true, out: backupFile + '.json' }
	}
	if (LOW_LABEL_PATTERN.test(before)) {
		const viaEngine = doctorSys('set-integrity-label', { path: desktop, label: 'medium', recursive: true }, 120000)
		if (viaEngine !== null && viaEngine.ok === true) {
			engineUsed = true
		} else {
			const result = powershell('icacls ' + quote(desktop) + " /setintegritylevel '(OI)(CI)Medium'")
			if (!result.ok) return { ok: false, message: '改完整性标签失败：' + (result.err || result.out) }
		}
	}
	if (/\(D;[^)]*;;;WD\)/.test(before)) {
		const viaEngine = doctorSys('remove-deny-ace', { path: desktop, everyone: true }, 120000)
		if (viaEngine !== null && viaEngine.ok === true) {
			engineUsed = true
		} else {
			powershell('icacls ' + quote(desktop) + " /remove:d '*S-1-1-0'")
		}
	}
	const after = aclSddl(desktop)
	// 复检读不到 = 没验证过：宁可报失败（fail-closed），不能拿空串当"没有 Low"。
	const verified = after.length > 0 && !LOW_LABEL_PATTERN.test(after)
	if (verified) refreshShellIcons()
	return {
		ok: verified,
		verified,
		message: verified
			? '桌面标签已改回 Medium，并已通知外壳重新取图标。' + (engineUsed ? '（doctor-sys 引擎）' : '')
			: after.length === 0
				? '改完后读不回桌面 ACL，无法验证是否修好。请重新体检确认。'
				: '改完复检仍看到 Low 标签，请把这条反馈给我。',
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
	const lock = acquireAclLock()
	if (lock === null) return { ok: false, message: '另一个 ACL 修复正在进行，稍后再试。' }
	try {
		return fixWorkspaceAclUnlocked()
	} finally {
		releaseAclLock(lock)
	}
}

function fixWorkspaceAclUnlocked() {
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
		} catch (error) {
			writable = false
		} finally {
			try { unlinkSync(probe) } catch (error) { /* ignore */ }
		}
		if (writable) continue
		const backupFile = join(backupDir(), 'workspace-acl-' + Date.now() + '.txt')
		const save = powershell('icacls ' + quote(target) + ' /save ' + quote(backupFile))
		const grant = powershell('icacls ' + quote(target) + ' /grant "*' + sid + ':(OI)(CI)F" /C')
		let verified = false
		try {
			writeFileSync(probe, 'ok', 'utf8')
			verified = true
		} catch (error) {
			verified = false
		} finally {
			try { unlinkSync(probe) } catch (error) { /* ignore */ }
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
	'reap-zombies': fixReapZombies,
	'refresh-shell': () => {
		const ok = refreshShellIcons()
		return { ok, message: ok ? '已通知外壳重新取图标（不用重启资源管理器）。' : '刷新外壳失败，可以手动重启资源管理器。' }
	},
}

/* ── 修复录（history.jsonl）──────────────────────────────────────────── */

function historyPath() {
	return join(dshHome(), 'dsh-doctor', 'history.jsonl')
}

/** 修复录超过 256 KB 就轮转到 history.1.jsonl（只留一代），不会一直长。 */
const HISTORY_ROTATE_BYTES = 256 * 1024

function appendHistory(entry) {
	try {
		mkdirp(dirname(historyPath()))
		try {
			if (statSync(historyPath()).size > HISTORY_ROTATE_BYTES) {
				try { unlinkSync(historyPath() + '.1') } catch (error) { /* ignore */ }
				renameSync(historyPath(), historyPath() + '.1')
			}
		} catch (error) { /* 没有旧文件或轮转失败都不影响记录 */ }
		appendFileSync(historyPath(), JSON.stringify(entry) + '\n', 'utf8')
	} catch (error) { /* 记录失败不影响修复本身 */ }
}

function readHistoryLines(file, limit) {
	if (limit <= 0 || !existsSync(file)) return []
	try { return readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).slice(-limit) } catch (error) { return [] }
}

function readHistory(limit = 50) {
	// 刚轮转完主文件会很薄：不够 limit 条就从上一代补齐，面板修复录不断档。
	let lines = readHistoryLines(historyPath(), limit)
	if (lines.length < limit) {
		lines = readHistoryLines(historyPath() + '.1', limit - lines.length).concat(lines)
	}
	const entries = []
	for (const line of lines) {
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
		if (first && existsSync(first)) return { command: first, args: [], label: first, kind: 'dsh' }
	}
	const npx = shell(isWindows ? 'where.exe npx' : 'which -a npx 2>/dev/null || command -v npx 2>/dev/null')
	if (npx.ok && npx.out.length > 0) {
		const first = pick(npx.out)
		if (first && existsSync(first)) return { command: first, args: ['-y', '@deepseek-ai/dsh@latest'], label: 'npx @deepseek-ai/dsh@latest', kind: 'npx' }
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
/** 逃生交接 = 求助报告 + 一段"你先看这个"的话，直接丢给网页版 DSH 就能接着修。 */
async function writeHandoffReport() {
	try {
		const findings = await scanCached()
		const report = buildAiReport(findings)
		const head = [
			'# DSH 桌面端 · 逃生交接报告',
			'',
			'> 由「DSH 私人医生」生成 · ' + new Date().toLocaleString(),
			'> 桌面端已经修不动了，所以把问题清单交给网页版继续。下面这份是给 AI 看的报告，问题点已按严重度排好。',
			'',
			'```text',
			'我是从 DSH 桌面端逃过来的：桌面端起不来，或者我修不好。',
			'这份文件是桌面端「私人医生」生成的体检报告，问题点已经列出来了。',
			'请按严重度从高到低处理；每条都告诉我改了什么、怎么验证、怎么回滚。',
			'网页版和桌面端共享同一个 ~/.dsh，修的是同一份数据。',
			'```',
			'',
			'---',
			'',
		].join('\n')
		const text = head + report
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

/** 把带 token 的地址落到桌面：浏览器没自动弹出来时，用户还能手动复制。 */
function writeUrlHint(url) {
	try {
		const directory = existsSync(desktopPath()) ? desktopPath() : join(dshHome(), 'dsh-doctor')
		mkdirp(directory)
		const file = join(directory, 'dsh-doctor-网页版地址.txt')
		writeFileSync(file,
			'DSH 网页版（逃生）地址：\n' + url + '\n\n'
			+ '如果浏览器没有自动打开，把上面那行整段复制到浏览器地址栏（注意要带上 token）。\n'
			+ '这个实例会一直开着；再点「起网页版」会复用同一个实例，不会新开。\n', 'utf8')
		return file
	} catch (error) {
		return null
	}
}

/** 逃生启动互斥锁：两个窗口同时点「起网页版」会各起一个实例、互不知情。 */
function acquireRescueLock() {
	const file = join(dshHome(), 'dsh-doctor', 'rescue.lock')
	try {
		mkdirp(dirname(file))
		if (existsSync(file)) {
			let age = 0
			try { age = Date.now() - statSync(file).mtimeMs } catch (error) { age = 0 }
			// npx 首次要联网下载，等待上限 3 分钟，锁的过期时间不能比它短。
			if (age < 180000) return { busy: true }
			try { unlinkSync(file) } catch (error) { /* 过期锁清掉 */ }
		}
		writeFileSync(file, String(process.pid), 'utf8')
		return { file }
	} catch (error) {
		return { error: String(error && error.message ? error.message : error) }
	}
}

function releaseRescueLock(file) {
	try { unlinkSync(file) } catch (error) { /* ignore */ }
}

async function rescueWeb() {
	const lock = acquireRescueLock()
	if (lock.busy === true) {
		return {
			ok: false,
			message: '已经有另一个窗口在启动逃生实例（互斥锁 3 分钟内有效）。\n'
				+ '等它起好后再点一次就会复用；一直没起来就看日志 ~/.dsh/dsh-doctor/rescue-*.log。',
		}
	}
	// 锁建不起来（目录不可写等）不该拦住逃生本身：直接继续，只是失去互斥保护。
	if (typeof lock.file !== 'string') return await rescueWebUnlocked()
	try {
		return await rescueWebUnlocked()
	} finally {
		releaseRescueLock(lock.file)
	}
}

async function rescueWebUnlocked() {
	const runtime = findRuntime()
	if (runtime === null) {
		return {
			ok: false,
			message: '这台电脑没有可用的 dsh 运行时（PATH 里既没有 dsh 也没有 npx）。\n'
				+ '两种情况：① 只装了 DSH 桌面端、没装命令行——请用「环境包」（自带 node，解压即用）；'
				+ '② 装了 Node 但没配进 PATH——装一遍 Node 再点一次。',
		}
	}

	// 1) 先复用已经在跑的逃生实例，避免每次点都新开一个、旧标签页变成"尸体"。
	const previous = readRescueRegistry()
	if (previous !== null && typeof previous.port === 'number' && portInUse(previous.port)) {
		const previousBase = 'http://127.0.0.1:' + previous.port + '/'
		if (await waitForHttp(previousBase, 5000)) {
			const previousUrl = tokenizedUrl(previous.port, previous.log)
			openBrowser(previousUrl)
			const handoffFile = await writeHandoffReport()
			const urlHint = writeUrlHint(previousUrl)
			return {
				ok: true,
				reused: true,
				url: previousBase,
				handoff: handoffFile,
				urlFile: urlHint,
				message: '复用已在运行的逃生实例：' + previousBase + '\n'
					+ (urlHint !== null ? '桌面上已写好地址：' + urlHint + '\n' : '')
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
	// npx 第一次要下载，给它最多 3 分钟；本机 dsh 30 秒足够。
	const waitMs = runtime.kind === 'npx' ? 180000 : 30000
	const ready = await waitForHttp(url, waitMs)
	if (!ready) {
		const npxHint = runtime.kind === 'npx'
			? '\n这次走的是 npx（需要联网下载 DSH）。如果一直没反应或报错，说明这台机器没有可用的 Node 环境——下载「环境包」解压后运行即可，不需要装 Node。'
			: ''
		return {
			ok: false,
			log: logFile,
			message: '已尝试启动（' + runtime.label + ' --port ' + port + '），但 ' + Math.round(waitMs / 1000) + ' 秒内没起来。'
				+ '\n日志：' + logFile + npxHint,
		}
	}
	writeRescueRegistry({ port, url, log: logFile, startedAt: new Date().toISOString() })
	const authenticatedUrl = tokenizedUrl(port, logFile)
	try {
		openBrowser(authenticatedUrl)
	} catch (error) { /* 浏览器打不开也不影响服务 */ }
	const handoff = await writeHandoffReport()
	const urlHint = writeUrlHint(authenticatedUrl)
	const lines = ['网页版已启动：' + url]
	if (urlHint !== null) lines.push('桌面上已写好地址：' + urlHint + '（浏览器没弹出来就手动复制它）')
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
		urlFile: urlHint,
		log: logFile,
		message: lines.join('\n'),
	}
}

/* ── 自动巡检 / 刷新外壳 / 僵尸进程回收 ─────────────────────────────── */

function autoFixEnabled() {
	return String(process.env.DSH_DOCTOR_AUTOFIX || '1').toLowerCase() !== '0'
}

/** 让 Explorer 重新取图标（SHChangeNotify），不用重启资源管理器、不闪。 */
function refreshShellIcons() {
	if (!isWindows) return false
	// 引擎优先（原生调用，不起 PowerShell 进程）；没配或失败走 Add-Type。
	const viaEngine = doctorSys('shell-refresh', {})
	if (viaEngine !== null && viaEngine.ok === true) return true
	const script = [
		"$sig = @'",
		'using System;',
		'using System.Runtime.InteropServices;',
		'public class DshDocShell {',
		'  [DllImport("shell32.dll")] public static extern void SHChangeNotify(int e, uint f, IntPtr i1, IntPtr i2);',
		'}',
		"'@",
		'Add-Type -TypeDefinition $sig',
		'[DshDocShell]::SHChangeNotify(0x08000000, 0x1000, [IntPtr]::Zero, [IntPtr]::Zero)',
	].join('; ')
	const result = powershell(script)
	return result.ok
}

/** 列出"命令行里带 dsh + web + --port"的进程。 */
function listDshWebProcesses() {
	if (!isWindows) return []
	const script = [
		'$items = @()',
		'Get-CimInstance Win32_Process -Filter "Name=\'node.exe\' OR Name=\'cmd.exe\'" | ForEach-Object {',
		'  $line = [string]$_.CommandLine',
		'  if ($line -match "dsh" -and $line -match "web" -and $line -match "--port\\s+(\\d+)") {',
		'    $items += [pscustomobject]@{ pid = $_.ProcessId; port = [int]$Matches[1]; cmd = $line }',
		'  }',
		'}',
		'[Console]::Out.Write(($items | ConvertTo-Json -Compress -Depth 3))',
	].join('; ')
	const result = powershell(script)
	if (!result.ok || result.out.length === 0) return []
	try {
		const parsed = JSON.parse(result.out)
		return Array.isArray(parsed) ? parsed : [parsed]
	} catch (error) {
		return []
	}
}

/** 读一个包的 clients 导出路径（exports["./client"]）。 */
function clientExportPath(installed) {
	const exp = installed.exports
	if (exp === null || typeof exp !== 'object') return null
	const entry = exp['./client']
	if (typeof entry === 'string') return entry
	if (entry !== null && typeof entry === 'object' && typeof entry.default === 'string') return entry.default
	return null
}

/**
 * 依赖名 / 包名 / 客户端模块 id 必须三者一致。
 * 改了 npm 包名却忘了同步 cordis.patch.yml 的 name 或 client.js 里的
 * `window.__ModuleLoader__.load({ id })` 时：宿主半边还能跑（接口正常），
 * 浏览器半边却会静默不注册——表现就是侧边栏图标和面板"被挤掉了"。
 */
function checkBundleIdentityDrift() {
	const findings = []
	const profilesRoot = join(dshHome(), 'profiles')
	for (const profileName of readDirNames(profilesRoot)) {
		if (profileName.includes('.stale')) continue
		const profileDir = join(profilesRoot, profileName)
		const pkg = readJson(join(profileDir, 'package.json'))
		if (pkg === null || pkg.dependencies === undefined || pkg.dependencies === null) continue
		for (const depName of Object.keys(pkg.dependencies)) {
			const packageDir = join(profileDir, 'node_modules', depName)
			const installed = readJson(join(packageDir, 'package.json'))
			if (installed === null || typeof installed.name !== 'string') continue

			if (installed.name !== depName) {
				findings.push(finding('bundle-identity-drift', 'high',
					'依赖名与包名不一致：' + depName,
					'profile「' + profileName + '」的依赖叫 `' + depName + '`，安装包却自称 `' + installed.name + '`。'
						+ 'DSH 用包名标识客户端模块：名字不一致时，宿主插件照常加载（接口、体检都正常），'
						+ '但侧边栏图标和面板不会注册。修复：`name:` 与依赖名对齐，重新装一次 bundle。',
					packageDir, null))
				continue
			}

			const decl = installed.dsh !== undefined && installed.dsh !== null && installed.dsh.client !== undefined ? installed.dsh.client : null
			if (decl === null) continue
			const clientRel = clientExportPath(installed)
			if (clientRel === null) continue
			const clientFile = join(packageDir, clientRel)
			let source = ''
			try { source = readFileSync(clientFile, 'utf8').slice(0, 4096) } catch (error) { continue }
			const match = /__ModuleLoader__\.load\(\{\s*id:\s*['"]([^'"]+)['"]/.exec(source)
			if (match !== null && match[1] !== depName) {
				findings.push(finding('bundle-identity-drift', 'high',
					'客户端模块 id 与包名不一致：' + depName,
					'`' + clientFile + '` 注册的模块 id 是 `' + match[1] + '`，包名却是 `' + installed.name + '`。'
						+ '这种不一致在宿主侧看不出来，但浏览器半边会静默失败——侧边栏图标、面板全部消失。'
						+ '修复：把 id 改成包名，再重新安装 bundle。',
					clientFile, null))
			}
		}
	}
	return findings
}

/**
 * 当前 DSH 运行时的真实版本：
 *   - Electron 宿主里 fs 能读 app.asar（process.resourcesPath），拿到最准的版本；
 *   - CLI / 环境包里读不到 asar，退回 ~/.dsh/dsh-runtimes 的 runtime.json（可能过期）。
 */
function installedRuntime() {
	const candidates = []
	if (typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0) {
		candidates.push(join(process.resourcesPath, 'app.asar', 'package.json'))
	}
	for (const candidate of candidates) {
		const meta = readJson(candidate)
		if (meta !== null && typeof meta.version === 'string') return { version: meta.version, source: candidate, exact: true }
	}
	const runtimeFile = join(dshHome(), 'dsh-runtimes', 'dsh-primary-runtime', 'runtime.json')
	const meta = readJson(runtimeFile)
	if (meta !== null && typeof meta.desktopVersion === 'string') {
		return { version: meta.desktopVersion, source: runtimeFile, exact: false }
	}
	return null
}

/**
 * profile 里 @deepseek-ai/* 插件固定在旧版本时，运行时的兼容性守卫会直接禁用它们。
 * 表现是插件仍在列表里、但功能不工作（或启动时 "did not activate"）。
 */
function checkBundleVersionSkew() {
	const findings = []
	const runtime = installedRuntime()
	// runtime.json 在桌面端更新后经常不刷新（本机实测），拿它当基准会全是误报；
	// 只有从 app.asar 读到的版本才可信。
	if (runtime === null || runtime.exact !== true) return findings
	const profilesRoot = join(dshHome(), 'profiles')
	for (const profileName of readDirNames(profilesRoot)) {
		if (profileName.includes('.stale')) continue
		const profileDir = join(profilesRoot, profileName)
		const pkg = readJson(join(profileDir, 'package.json'))
		if (pkg === null || pkg.dependencies === undefined || pkg.dependencies === null) continue
		for (const depName of Object.keys(pkg.dependencies)) {
			if (!depName.startsWith('@deepseek-ai/')) continue
			const declared = String(pkg.dependencies[depName] || '')
			if (!/^\d/.test(declared)) continue
			const installed = readJson(join(profileDir, 'node_modules', depName, 'package.json'))
			const version = installed !== null && typeof installed.version === 'string' ? installed.version : declared
			if (version === runtime.version) continue
			findings.push(finding('bundle-version-skew', 'medium',
				'插件版本与运行时不一致：' + depName,
				'profile「' + profileName + '」里是 `' + version + '`，运行时是 `' + runtime.version + '`'
					+ (runtime.exact ? '' : '（来自 runtime.json，可能过期）')
					+ '。兼容性守卫会禁用版本不符的插件，表现为"插件还在列表里但功能不工作"。'
					+ '修复：把该插件升级到与运行时一致的版本，或先禁用/移除它。',
				join(profileDir, 'node_modules', depName), null))
		}
	}
	return findings
}

/** runtime.json 在桌面端更新后可能不刷新，依赖它的版本判断会全部错位。 */
function checkRuntimeMetadataStale() {
	const findings = []
	const runtimeFile = join(dshHome(), 'dsh-runtimes', 'dsh-primary-runtime', 'runtime.json')
	const meta = readJson(runtimeFile)
	if (meta === null || typeof meta.desktopVersion !== 'string') return findings
	// 只有 Electron 宿主能读 app.asar 拿到准确版本；CLI / 环境包跳过。
	const appFile = typeof process.resourcesPath === 'string'
		? join(process.resourcesPath, 'app.asar', 'package.json')
		: null
	const appMeta = appFile === null ? null : readJson(appFile)
	if (appMeta === null || typeof appMeta.version !== 'string') return findings
	if (meta.desktopVersion !== appMeta.version) {
		findings.push(finding('runtime-metadata-stale', 'low',
			'运行时元数据版本过期',
			'`runtime.json` 里写的是 `' + String(meta.desktopVersion) + '`，实际桌面端已是 `' + appMeta.version + '`。'
				+ '任何读取 runtime.json 判断版本的工具/插件都会误判。',
			runtimeFile, null))
	}
	return findings
}

/**
 * 权限过宽：danger-full-access 等于把整台机器交给模型，approval: never 连确认都省了。
 * 用户的文件一旦被删，DSH 不经过回收站，常规手段找不回来。
 * 会话的权限投影在 ~/.dsh/storages/session_projcache.json 的 tables.sessions.<id>.rows.permissions。
 */
function checkPermissionTooBroad() {
	const findings = []
	const cacheFile = join(dshHome(), 'storages', 'session_projcache.json')
	const cache = readJson(cacheFile)
	if (cache === null || typeof cache !== 'object') return findings
	const sessions = cache.tables !== undefined && cache.tables !== null && cache.tables.sessions !== undefined && cache.tables.sessions !== null
		? cache.tables.sessions
		: {}
	const broad = []
	for (const [sessionId, row] of Object.entries(sessions)) {
		const value = row !== null && row !== undefined && row.rows !== undefined && row.rows !== null
			&& row.rows.permissions !== undefined && row.rows.permissions !== null
			&& row.rows.permissions.val !== undefined && row.rows.permissions.val !== null
			? row.rows.permissions.val
			: null
		if (value === null) continue
		if (value.sandbox !== 'danger-full-access' && value.preset !== 'danger-full-access') continue
		broad.push({ sessionId, approval: String(value.approval || '') })
	}
	if (broad.length === 0) return findings
	const noApproval = broad.filter(item => item.approval === 'never').length
	const sample = broad.slice(0, 5).map(item => item.sessionId.replace(/^session-/, '').slice(0, 8)).join('、')
	findings.push(finding('permission-too-broad', noApproval > 0 ? 'high' : 'medium',
		'有 ' + broad.length + ' 个会话开着 danger-full-access' + (noApproval > 0 ? '（其中 ' + noApproval + ' 个连审批也关了）' : ''),
		'这些会话的沙箱是 danger-full-access' + (noApproval > 0 ? '、审批策略 never' : '')
			+ '——等于把整台机器交给模型，误删文件**不经过回收站、不可撤销**。'
			+ '涉及会话：' + sample + (broad.length > 5 ? ' 等' : '') + '。'
			+ '建议：会话里用 `/permission` 切到 `workspace-write` + `ask`；新会话在设置里改默认权限。'
			+ '已经被删的文件，恢复路径见 docs/recovery.md。',
		cacheFile, null))
	return findings
}

/** 端口已经没人听、进程却还挂着的残余实例——回收它们，终结无限重载。 */
function checkZombieProcesses() {
	const findings = []
	if (!isWindows) return findings
	for (const item of listDshWebProcesses()) {
		if (typeof item.port !== 'number' || typeof item.pid !== 'number') continue
		if (item.pid === process.pid) continue
		if (portInUse(item.port)) continue
		findings.push(finding('zombie-dsh-process', 'medium',
			'发现僵尸 DSH 进程：PID ' + item.pid + '（端口 ' + item.port + ' 已失效）',
			'进程还挂着但端口已经没人监听，常见于逃生实例被杀后残留、或被沙箱打断的启动。回收它不会影响正在用的实例。',
			'', 'reap-zombies'))
	}
	return findings
}

function fixReapZombies() {
	const killed = []
	for (const item of listDshWebProcesses()) {
		if (typeof item.port !== 'number' || typeof item.pid !== 'number') continue
		if (item.pid === process.pid) continue
		if (portInUse(item.port)) continue
		// 杀之前再核一次命令行：防 PID 在扫描与杀之间被系统复用，误杀无关进程。
		const verify = powershell('$p = Get-CimInstance Win32_Process -Filter "ProcessId=' + item.pid + '"; if ($null -ne $p) { [Console]::Out.Write([string]$p.CommandLine) }')
		const commandLine = verify.ok ? verify.out : ''
		if (commandLine.indexOf('--port ' + item.port) < 0 || commandLine.toLowerCase().indexOf('dsh') < 0) continue
		const result = powershell('Stop-Process -Id ' + item.pid + ' -Force -ErrorAction SilentlyContinue')
		if (result.ok) killed.push(item.pid)
	}
	if (killed.length === 0) return { ok: true, unchanged: true, message: '没有发现可回收的僵尸进程。' }
	return { ok: true, verified: true, message: '已回收 ' + killed.length + ' 个僵尸进程（PID：' + killed.join(', ') + '）。' }
}

/**
 * 后台自动巡检：每 30 秒看一眼桌面完整性标签。
 * 一旦被 DSH 重新降级（或收回拒绝项），立刻重置 + 刷新外壳，不打扰用户。
 */
function startAutoGuard(ctx) {
	if (!isWindows || !autoFixEnabled()) return
	let lastRun = 0
	let fixCount = 0
	let windowStart = 0
	const tick = () => {
		try {
			const now = Date.now()
			if (now - lastRun < 30000) return
			lastRun = now
			const desktop = desktopPath()
			if (!existsSync(desktop)) return
			const sddl = aclSddl(desktop)
			if (sddl.length === 0) return
			const low = LOW_LABEL_PATTERN.test(sddl)
			const deny = /\(D;[^)]*;;;WD\)/.test(sddl)
			if (!low && !deny) return

			// 防抖：一小时内最多自动拉回 5 次。超过说明 DSH 在反复改写，
			// 这时硬拉只会造成反复闪屏，应该让用户去改工作区，而不是和它打乒乓。
			if (now - windowStart > 3600000) { windowStart = now; fixCount = 0 }
			if (fixCount >= 5) {
				appendHistory({
					at: new Date().toISOString(),
					id: 'auto-desktop-label', ok: false, changed: false,
					message: '自动巡检：一小时内已自动修复 5 次，暂停。请把桌面从 DSH 工作区里移走（否则会一直反复）。',
					backup: null,
				})
				return
			}

			fixCount += 1
			const result = fixDesktopLabel()
			appendHistory({
				at: new Date().toISOString(),
				id: 'auto-desktop-label',
				ok: result.ok === true,
				changed: !(result.unchanged === true),
				message: '自动巡检：' + String(result.message || ''),
				backup: typeof result.backup === 'string' ? result.backup : null,
			})
			// 只有标签被降级（会白图标）才需要刷新外壳；单纯残留拒绝项不必刷。
			if (result.ok === true && low) refreshShellIcons()
		} catch (error) { /* 守护自己不许抛 */ }
	}
	try {
		ctx.effect(() => {
			const timer = setInterval(tick, 30000)
			return () => clearInterval(timer)
		}, 'dsh-doctor: auto guard')
	} catch (error) { /* 老版本 ctx 没有 effect 时静默降级 */ }
}

/* ── 自动更新 ───────────────────────────────────────────────────────── */

const REPO = 'jincheng3870682453-hash/dsh-doctor'
const RELEASES_URL = 'https://github.com/' + REPO + '/releases'

function readOwnVersion() {
	try {
		return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || '0.0.0'
	} catch (error) {
		return '0.0.0'
	}
}

function compareVersions(left, right) {
	const a = String(left).replace(/^v/, '').split('.').map(part => Number(part.replace(/\D.*$/, '')) || 0)
	const b = String(right).replace(/^v/, '').split('.').map(part => Number(part.replace(/\D.*$/, '')) || 0)
	for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
		const x = a[index] || 0
		const y = b[index] || 0
		if (x !== y) return x > y ? 1 : -1
	}
	return 0
}

async function checkUpdate() {
	const current = readOwnVersion()
	try {
		const response = await fetch('https://api.github.com/repos/' + REPO + '/releases/latest', {
			headers: { 'user-agent': 'dsh-doctor', accept: 'application/vnd.github+json' },
			signal: AbortSignal.timeout(10000),
		})
		if (!response.ok) {
			return { ok: false, current, message: '检查更新失败：GitHub 返回 HTTP ' + response.status }
		}
		const data = await response.json()
		const latest = String(data.tag_name || '').replace(/^v/, '')
		return {
			ok: true,
			current,
			latest,
			newer: compareVersions(latest, current) > 0,
			url: String(data.html_url || RELEASES_URL),
			publishedAt: data.published_at || null,
			name: data.name || null,
		}
	} catch (error) {
		return { ok: false, current, message: '检查更新失败（可能连不上 GitHub）：' + String(error && error.message ? error.message : error) }
	}
}

/** 只允许打开本仓库的 Release 页面，避免变成任意 URL 的跳板。 */
function openReleasePage(url) {
	const target = String(url || RELEASES_URL)
	if (!target.startsWith(RELEASES_URL)) return { ok: false, message: '只允许打开本仓库的 Release 页面。' }
	openBrowser(target)
	return { ok: true, message: '已在浏览器打开下载页：' + target }
}

/* ── 脱敏：报告对外提交前，把能定位到"某个人"的东西换成占位符 ─────────── */

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 替换规则（保留目录结构，方便维护者定位）：
 *   C:\Users\张三\...        -> C:\Users\user\...
 *   /home/zhangsan/...       -> /home/user/...
 *   /Users/zhangsan/...      -> /Users/user/...   (macOS)
 *   <当前用户名>（散落在日志里） -> user
 *   <当前主机名>             -> <machine>
 *   name@example.com         -> user@example.com
 */
function sanitizeText(input) {
	let out = String(input === null || input === undefined ? '' : input)
	if (out.length === 0) return out
	const user = String(process.env.USERNAME || process.env.USER || '').trim()
	const machine = hostname()

	// 用户名可能带空格（C:\Users\John Doe），所以匹配到下一个分隔符为止，不排除空格。
	out = out.replace(/([A-Za-z]:\\Users\\)([^\\\r\n]+)/gi, '$1user')
	out = out.replace(/(\/home\/)([^/\r\n]+)/g, '$1user')
	out = out.replace(/(\/Users\/)([^/\r\n]+)/g, '$1user')

	if (user.length >= 3) {
		try {
			out = out.replace(new RegExp('(?<![A-Za-z0-9_])' + escapeRegExp(user) + '(?![A-Za-z0-9_])', 'gi'), 'user')
		} catch (error) { /* 老运行时没有 lookbehind，退化为全局替换 */ out = out.split(user).join('user') }
	}
	if (machine.length >= 3) out = out.split(machine).join('<machine>')
	out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'user@example.com')
	return out
}

/* ── 环境差异报告（对照标准 DSH 基线）────────────────────────────────── */

const DEFAULT_BASELINE = {
	requiredBundles: ['@deepseek-ai/dsh-base'],
	guiProfiles: ['desktop', 'web'],
	guiRequiredBundles: ['@deepseek-ai/dsh-web-app'],
	requiredFiles: ['package.json', 'cordis.patch.yml'],
	forbiddenDependencies: ['@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-skill', '@deepseek-ai/schemastery', '@deepseek-ai/dsh-util-values', 'schemastery'],
	forbiddenTopLevel: ['dsh-tools', 'dsh-skill', 'schemastery', 'dsh-util-values'],
	submitAs: 'https://github.com/jincheng3870682453-hash/dsh-doctor/issues/new',
}

function readBaselineFile() {
	const candidates = [
		new URL('../../baseline/expected.json', import.meta.url),
		new URL('../baseline.json', import.meta.url),
	]
	for (const candidate of candidates) {
		try {
			const parsed = JSON.parse(readFileSync(candidate, 'utf8'))
			if (parsed !== null && typeof parsed === 'object') return normalizeBaseline(parsed)
		} catch (error) { /* 试下一个 */ }
	}
	return null
}

/** baseline/expected.json 是给人和文档看的，字段分组不同；这里归一成代码用的形状。 */
function normalizeBaseline(parsed) {
	const profiles = parsed.profiles !== undefined && parsed.profiles !== null ? parsed.profiles : {}
	const report = parsed.report !== undefined && parsed.report !== null ? parsed.report : {}
	return {
		requiredBundles: Array.isArray(profiles.requiredBundles) ? profiles.requiredBundles : DEFAULT_BASELINE.requiredBundles,
		requiredFiles: Array.isArray(profiles.requiredFiles) ? profiles.requiredFiles : DEFAULT_BASELINE.requiredFiles,
		guiProfiles: Array.isArray(profiles.guiProfiles) ? profiles.guiProfiles : DEFAULT_BASELINE.guiProfiles,
		guiRequiredBundles: Array.isArray(profiles.guiRequiredBundles) ? profiles.guiRequiredBundles : DEFAULT_BASELINE.guiRequiredBundles,
		forbiddenDependencies: Array.isArray(profiles.forbiddenDependencies) ? profiles.forbiddenDependencies : DEFAULT_BASELINE.forbiddenDependencies,
		forbiddenTopLevel: Array.isArray(profiles.forbiddenNodeModulesTopLevel) ? profiles.forbiddenNodeModulesTopLevel : DEFAULT_BASELINE.forbiddenTopLevel,
		submitAs: typeof report.submitAs === 'string' && report.submitAs.length > 0 ? report.submitAs : DEFAULT_BASELINE.submitAs,
	}
}

function crashLogSummary() {
	const dir = crashLogDir()
	if (!existsSync(dir)) return { count: 0, newest: null, firstLine: '' }
	let files = []
	try { files = readdirSync(dir).filter(name => name.startsWith('crash-')) } catch (error) { return { count: 0, newest: null, firstLine: '' } }
	let newest = null
	let firstLine = ''
	for (const name of files) {
		try {
			const stat = statSync(join(dir, name))
			if (newest === null || stat.mtimeMs > newest.mtimeMs) newest = { name, mtimeMs: stat.mtimeMs }
		} catch (error) { /* ignore */ }
	}
	if (newest !== null) {
		try {
			const lines = readFileSync(join(dir, newest.name), 'utf8').split(/\r?\n/).filter(line => line.trim().length > 0)
			firstLine = lines.length > 0 ? lines[0].trim().slice(0, 300) : ''
		} catch (error) { firstLine = '' }
	}
	return { count: files.length, newest: newest !== null ? new Date(newest.mtimeMs).toISOString() : null, firstLine }
}

function collectEnvironmentSnapshot() {
	const profilesRoot = join(dshHome(), 'profiles')
	const profileList = []
	for (const name of readDirNames(profilesRoot)) {
		if (name.includes('.stale')) continue
		const dir = join(profilesRoot, name)
		const pkg = readJson(join(dir, 'package.json')) || {}
		const bundles = pkg.dsh && Array.isArray(pkg.dsh.profile && pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : []
		const dependencies = pkg.dependencies ? Object.keys(pkg.dependencies) : []
		const topLevel = readDirNames(join(dir, 'node_modules'))
		profileList.push({ name, dir, bundles, dependencies, topLevel })
	}
	const registry = readWorkspaceRegistry()
	const workspaces = registry === null ? [] : registry.list.map(item => ({ id: item.id, path: item.path, title: item.title }))
	const desktopSddl = aclSddl(desktopPath())
	const dshOnPath = shell(isWindows ? 'where.exe dsh' : 'which -a dsh 2>/dev/null || command -v dsh 2>/dev/null')
	const pathEntries = dshOnPath.ok
		? dshOnPath.out.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
		: []
	return {
		at: new Date().toISOString(),
		platform: process.platform,
		node: process.version,
		electron: process.versions.electron || null,
		dshHome: dshHome(),
		desktop: desktopPath(),
		desktopLow: LOW_LABEL_PATTERN.test(desktopSddl),
		desktopDeny: /\(D;[^)]*;;;WD\)/.test(desktopSddl),
		profiles: profileList,
		workspaces,
		crash: crashLogSummary(),
		pathEntries,
		zombies: listDshWebProcesses().length,
		packs: existsSync(PACK_DIR()) ? readdirSync(PACK_DIR()).filter(name => name.toLowerCase().endsWith('.json')) : [],
	}
}

function computeEnvironmentDiff(snapshot, baseline) {
	const diffs = []
	const add = (severity, title, detail, path) => diffs.push({ severity, title, detail, path: path || '' })

	for (const workspace of snapshot.workspaces) {
		const risk = workspaceRisk(workspace.path)
		if (risk !== null) add('high', '工作区注册到了危险位置', '「' + risk + '」被注册为工作区：' + workspace.path + '，DSH 每次授权都会改写它的 ACL。', workspace.path)
	}

	if (snapshot.desktopLow) add('high', '桌面被降为低完整性', '桌面的完整性标签是 Low，Explorer 取不到图标（图标会变白）。', snapshot.desktop)
	if (snapshot.desktopDeny) add('medium', '桌面残留拒绝删除项', '桌面上存在 Everyone 拒绝删除的 ACE。', snapshot.desktop)

	for (const profile of snapshot.profiles) {
		const bundles = Array.isArray(profile.bundles) ? profile.bundles : []
		const dependencies = Array.isArray(profile.dependencies) ? profile.dependencies : []
		const topLevel = Array.isArray(profile.topLevel) ? profile.topLevel : []
		const missing = baseline.requiredBundles.filter(bundle => !bundles.includes(bundle))
		if (missing.length > 0) add('medium', 'profile 缺少标准 bundle', 'profile「' + profile.name + '」缺少：' + missing.join('、'), profile.name)
		if (baseline.guiProfiles.includes(profile.name)) {
			const missingGui = baseline.guiRequiredBundles.filter(bundle => !bundles.includes(bundle))
			if (missingGui.length > 0) add('medium', 'GUI profile 缺少 web-app bundle', 'profile「' + profile.name + '」缺少：' + missingGui.join('、'), profile.name)
		}
		const badDeps = dependencies.filter(dep => baseline.forbiddenDependencies.includes(dep))
		if (badDeps.length > 0) add('medium', 'profile 依赖里出现宿主包', 'profile「' + profile.name + '」的 dependencies 含：' + badDeps.join('、') + '（应交给运行时提供）', profile.name)
		const badTop = topLevel.filter(name => baseline.forbiddenTopLevel.includes(name))
		if (badTop.length > 0) add('high', 'profile 里出现宿主包副本', 'profile「' + profile.name + '」的 node_modules 顶层有：' + badTop.join('、'), profile.name)
		for (const file of baseline.requiredFiles) {
			const target = join(profile.dir, file)
			if (!existsSync(target)) add('medium', 'profile 缺少必需文件', 'profile「' + profile.name + '」缺少：' + file, target)
		}
	}

	for (const entry of snapshot.pathEntries) {
		if (!existsSync(entry)) add('low', 'PATH 里有失效的 dsh 入口', '指向不存在的文件：' + entry, entry)
	}

	if (snapshot.crash.count > 0) {
		add('low', '存在桌面端崩溃日志', '共 ' + snapshot.crash.count + ' 个，最近 ' + String(snapshot.crash.newest || '未知')
			+ (snapshot.crash.firstLine ? '，首行：' + snapshot.crash.firstLine : ''), '')
	}
	if (snapshot.zombies > 0) add('low', '存在僵尸 DSH 进程', '检测到 ' + snapshot.zombies + ' 个"端口已死但进程还在"的实例。', '')

	return diffs
}

function buildDiffReport() {
	const baseline = readBaselineFile() || DEFAULT_BASELINE
	const snapshot = collectEnvironmentSnapshot()
	const diffs = computeEnvironmentDiff(snapshot, baseline)
	const high = diffs.filter(item => item.severity === 'high').length
	const lines = []
	lines.push('# DSH 环境差异报告')
	lines.push('')
	lines.push('> 生成时间：' + new Date(snapshot.at).toLocaleString() + '　平台：' + snapshot.platform)
	lines.push('> 对照基线：' + (readBaselineFile() !== null ? 'baseline/expected.json' : '内置默认基线'))
	lines.push('> 差异：' + high + ' 个高危 / ' + diffs.length + ' 条共')
	lines.push('')
	lines.push('## 环境快照')
	lines.push('')
	lines.push('- DSH 目录：`' + snapshot.dshHome + '`')
	lines.push('- 桌面：`' + snapshot.desktop + '`')
	lines.push('- Node：' + snapshot.node + (snapshot.electron ? ' · Electron ' + snapshot.electron : ''))
	lines.push('- profile：' + snapshot.profiles.map(profile => profile.name + '(' + profile.bundles.length + ' bundles / ' + profile.topLevel.length + ' pkgs)').join('、'))
	lines.push('- 工作区：' + (snapshot.workspaces.length > 0 ? snapshot.workspaces.map(item => item.title + ' -> ' + item.path).join('；') : '无'))
	lines.push('- 桌面完整性：' + (snapshot.desktopLow ? 'Low（异常）' : 'OK') + (snapshot.desktopDeny ? ' · 有拒绝项' : ''))
	lines.push('- 崩溃日志：' + snapshot.crash.count + ' 个' + (snapshot.crash.newest ? '（最近 ' + snapshot.crash.newest + '）' : ''))
	lines.push('- dsh 命令：' + (snapshot.pathEntries.length > 0 ? snapshot.pathEntries.join('、') : 'PATH 里没有'))
	lines.push('- 僵尸进程：' + snapshot.zombies)
	lines.push('- 检查包：' + (snapshot.packs.length > 0 ? snapshot.packs.join('、') : '无'))
	lines.push('')
	lines.push('## 与标准基线的差异（' + diffs.length + ' 条）')
	lines.push('')
	if (diffs.length === 0) {
		lines.push('没有发现差异——这台机器的 DSH 结构与标准基线一致。')
	}
	for (const diff of diffs) {
		lines.push('### [' + diff.severity + '] ' + diff.title)
		lines.push('')
		if (diff.detail) lines.push(diff.detail)
		if (diff.path) lines.push('')
		if (diff.path) lines.push('`' + diff.path + '`')
		lines.push('')
	}
	lines.push('## 后端报错')
	lines.push('')
	if (snapshot.crash.count === 0) {
		lines.push('没有崩溃日志。')
	} else {
		lines.push('- 崩溃日志数：' + snapshot.crash.count + '，最近：' + String(snapshot.crash.newest || '未知'))
		if (snapshot.crash.firstLine) lines.push('- 最近一次首行：`' + snapshot.crash.firstLine + '`')
		lines.push('- 完整日志目录：`' + crashLogDir() + '`')
	}
	lines.push('')
	lines.push('## 提交方式')
	lines.push('')
	lines.push('1. 想求助：把本文件贴到 issue / 浏览器里的 AI；')
	lines.push('2. 想贡献：按 CONTRIBUTING.md 整理成 bug 图鉴条目或检查包；')
	lines.push('3. 提交地址：' + String(baseline.submitAs || DEFAULT_BASELINE.submitAs))
	lines.push('')
	lines.push('> 已脱敏：用户名 / 主机名 / 邮箱 / 用户主目录已替换为占位符（user、<machine>、user@example.com），其余路径保留原样以便定位。')
	return sanitizeText(lines.join('\n'))
}

function writeDiffReport() {
	try {
		const markdown = buildDiffReport()
		const directory = existsSync(desktopPath()) ? desktopPath() : join(dshHome(), 'dsh-doctor')
		mkdirp(directory)
		const file = join(directory, 'dsh-doctor-环境差异-' + stampForFile() + '.md')
		writeFileSync(file, markdown, 'utf8')
		return file
	} catch (error) {
		return null
	}
}

/* ── 给 AI 的求助报告 ───────────────────────────────────────────────── */

function buildAiReport(findingsParam) {
	const findings = Array.isArray(findingsParam) ? findingsParam : scan()
	const env = environment()
	const history = readHistory(10)
	const lines = []
	lines.push('# DSH 桌面端 · 问题求助报告')
	lines.push('')
	lines.push('> 由「DSH 私人医生」生成 · ' + new Date().toLocaleString() + ' · 平台 ' + env.platform)
	lines.push('')
	lines.push('## 给 AI 的约束（请先读，再回答）')
	lines.push('')
	lines.push('1. 下面是**本机真实体检结果**，请基于证据判断，不要凭印象或通用经验。')
	lines.push('2. 每条建议都要写清：**要执行的命令 / 预期输出 / 失败时怎么回滚**。')
	lines.push('3. 不要建议"删图标缓存 / 重建图标 / 重启电脑"这类偏方——图标变白的真因是桌面目录被打上低完整性标签（Low integrity）。')
	lines.push('4. 涉及**改权限、删文件、改注册表**之前，先说影响面，等我确认再动手。')
	lines.push('5. 不确定就写"不确定，需要先查 X"，不要编造。')
	lines.push('')
	lines.push('## 现状')
	lines.push('')
	lines.push('- 症状：（把你能看到的现象补在这里，比如"桌面图标全白 / 打开会话就报错"）')
	lines.push('- 最近做过：（装过什么插件、改过什么配置、是不是刚更新过）')
	lines.push('')
	lines.push('## 体检结果（' + findings.length + ' 条）')
	lines.push('')
	if (findings.length === 0) {
		lines.push('_医生没有发现已知问题——可能是新问题，或不在当前检查目录里。_')
	} else {
		for (const item of findings) {
			lines.push('### [' + item.severity + '] ' + item.title)
			lines.push('')
			if (item.path) lines.push('- 路径：`' + item.path + '`')
			if (item.detail) lines.push('- 说明：' + item.detail)
			lines.push('- 可一键修：' + (item.fixId ? '是（' + item.fixId + '）' : '否，需要人工判断'))
			lines.push('')
		}
	}
	lines.push('## 已经试过的修复')
	lines.push('')
	if (history.length === 0) {
		lines.push('_还没有执行过修复。_')
	} else {
		for (const entry of history) {
			lines.push('- ' + entry.at + '　' + entry.id + '　' + (entry.ok === true ? '成功' : '失败')
				+ (entry.backup ? '　备份：`' + entry.backup + '`' : ''))
			if (entry.message) lines.push('  - ' + entry.message)
		}
	}
	lines.push('')
	lines.push('## 环境')
	lines.push('')
	lines.push('- DSH 目录：`' + env.dshHome + '`')
	lines.push('- 桌面：`' + env.desktop + '`')
	lines.push('- profile：' + (Array.isArray(env.profiles) ? env.profiles.join('、') : ''))
	lines.push('- 检查包：' + (Array.isArray(env.packs) && env.packs.length > 0 ? env.packs.join('、') : '无'))
	lines.push('- Node：' + env.node + (env.electron ? ' · Electron ' + env.electron : ''))
	lines.push('')
	lines.push('## 我想问')
	lines.push('')
	lines.push('（在这里写你的问题，例如"下一步应该先修哪个？"）')
	lines.push('')
	lines.push('> 已脱敏：用户名 / 主机名 / 邮箱 / 用户主目录已替换为占位符（user、<machine>、user@example.com）。')
	return sanitizeText(lines.join('\n'))
}

function writeAiReport(findingsParam) {
	try {
		const markdown = buildAiReport(findingsParam)
		const directory = existsSync(desktopPath()) ? desktopPath() : join(dshHome(), 'dsh-doctor')
		mkdirp(directory)
		const file = join(directory, 'dsh-doctor-求助报告-' + stampForFile() + '.md')
		writeFileSync(file, markdown, 'utf8')
		return file
	} catch (error) {
		return null
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
		if (path === PREFIX + '/cached' && req.method === 'GET') {
		// 只读上次落盘结果，不触发扫描：面板打开秒开。
		const cached = readLastScan()
		if (cached === null) {
			send(res, 200, { ok: true, scannedAt: null, findings: [] })
			return
		}
		const findings = cached.findings
		const summary = {
			high: findings.filter(item => item.severity === 'high').length,
			medium: findings.filter(item => item.severity === 'medium').length,
		}
		send(res, 200, { ok: true, scannedAt: cached.at, findings, summary })
		return
	}
	if (path === PREFIX + '/status' && req.method === 'GET') {
			const findings = await scanCached()
			const summary = {
				high: findings.filter(item => item.severity === 'high').length,
				medium: findings.filter(item => item.severity === 'medium').length,
				fixableHigh: findings.filter(item => item.severity === 'high' && item.fixId !== null).length,
				unfixableHigh: findings.filter(item => item.severity === 'high' && item.fixId === null).length,
			}
			send(res, 200, { ok: true, findings, summary, environment: environment() })
			return
		}
		if (path === PREFIX + '/update' && req.method === 'GET') {
			send(res, 200, await checkUpdate())
			return
		}
		if (path === PREFIX + '/update/open' && req.method === 'POST') {
			const raw = await readBody(req)
			let url = RELEASES_URL
			try {
				const parsed = JSON.parse(raw)
				if (parsed !== null && typeof parsed.url === 'string') url = parsed.url
			} catch (error) { /* 用默认地址 */ }
			send(res, 200, openReleasePage(url))
			return
		}
		if (path === PREFIX + '/diff' && req.method === 'GET') {
			send(res, 200, { ok: true, markdown: buildDiffReport() })
			return
		}
		if (path === PREFIX + '/diff/save' && req.method === 'POST') {
			const file = writeDiffReport()
			send(res, 200, file === null
				? { ok: false, message: '差异报告写入失败（桌面不可写？）' }
				: { ok: true, path: file, message: '环境差异报告已保存到：' + file })
			return
		}
		if (path === PREFIX + '/report' && req.method === 'GET') {
			send(res, 200, { ok: true, markdown: buildAiReport(await scanCached()) })
			return
		}
		if (path === PREFIX + '/report/save' && req.method === 'POST') {
			const file = writeAiReport(await scanCached())
			send(res, 200, file === null
				? { ok: false, message: '报告写入失败，可以直接用「复制」把内容发给 AI。' }
				: { ok: true, path: file, message: '报告已保存到：' + file })
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

export { scan, readHistory, rescueWeb, buildAiReport, writeAiReport, checkUpdate, buildDiffReport, writeDiffReport, doctorSys, doctorSysPath, LOW_LABEL_PATTERN, sanitizeText }

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
	// 后台巡检：DSH 再偷偷降级桌面标签，30 秒内自动拉回来。
	startAutoGuard(ctx)
}
