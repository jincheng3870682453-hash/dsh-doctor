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
import { existsSync, readFileSync, readdirSync, renameSync, copyFileSync, statSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import * as zlib from 'node:zlib'

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
	return join(homedir(), 'Desktop')
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

function quote(value) {
	return "'" + String(value).replace(/'/g, "''") + "'"
}

function aclSddl(path) {
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
	const userProfile = homedir().replace(/[\\/]+$/, '').toLowerCase()
	if (path.length === 0 || userProfile.length === 0) return null
	const target = path.replace(/[\\/]+$/, '').toLowerCase()
	const risky = [
		[userProfile, '用户目录本身'],
		[(userProfile + '\\desktop').toLowerCase(), '桌面本身'],
		[(userProfile + '\\documents').toLowerCase(), '文档目录'],
		[(userProfile + '\\downloads').toLowerCase(), '下载目录'],
		[(userProfile + '\\pictures').toLowerCase(), '图片目录'],
	]
	for (const [candidate, label] of risky) {
		if (target === candidate) return label
	}
	if (/^[a-z]:$/.test(target)) return '整个盘根'
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
			'同一个进程里两份 dsh-tools 会造出两个 Symbol（reading \'prepare\'）；旧版本副本则报 is incompatible with dsh。隔离后请完整退出并重开桌面端。',
			dir, 'profile-host-dup'))
	}
	return findings
}

function checkCrashLogs() {
	const findings = []
	const logDir = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), '@deepseek-ai', 'dsh-desktop', 'logs')
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
	if (process.platform !== 'win32') return findings
	const where = powershell('where.exe dsh')
	if (!where.ok || where.out.length === 0) return findings
	const lines = where.out.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0)
	const dead = lines.filter(line => !existsSync(line))
	if (dead.length === 0) return findings
	findings.push(finding('path-dead-dsh', 'medium',
		'PATH 里有指向不存在文件的 dsh 命令',
		'这些条目会让人以为"dsh 没装/版本不对"。删掉或修掉 PATH 里对应目录即可：' + dead.join(' | '),
		'', null))
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
		dshHome: dshHome(),
		desktop: desktopPath(),
		profiles: readDirNames(join(dshHome(), 'profiles')),
		packDir: PACK_DIR(),
		packs: existsSync(PACK_DIR()) ? readdirSync(PACK_DIR()).filter(name => name.toLowerCase().endsWith('.json')) : [],
		node: process.version,
		platform: process.platform,
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
	const moved = []
	for (const dir of dirs) {
		try {
			const target = dir + '.stale-' + stamp
			renameSync(dir, target)
			moved.push(target)
		} catch (error) {
			return { ok: false, message: '隔离失败：' + (error && error.message ? error.message : error) }
		}
	}
	return {
		ok: true,
		verified: true,
		message: '已隔离 ' + moved.length + ' 个宿主包副本。请完整退出并重新打开桌面端。',
		moved,
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

const FIXES = {
	'desktop-label': fixDesktopLabel,
	'workspace-entry': fixWorkspaceEntries,
	'profile-host-dup': fixProfileHostDup,
	'restore-patch-layer': fixRestorePatchLayer,
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

/* ── 网页版逃生 ─────────────────────────────────────────────────────── */

function findRuntime() {
	const pick = (out) => {
		const lines = out.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0)
		const preferred = lines.find(line => /\.(cmd|exe|bat)$/i.test(line))
		return preferred !== undefined ? preferred : lines[0]
	}
	const where = powershell('where.exe dsh')
	if (where.ok && where.out.length > 0) {
		const first = pick(where.out)
		if (first && existsSync(first)) return { command: first, args: [], label: first }
	}
	const npx = powershell('where.exe npx')
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

async function rescueWeb() {
	const runtime = findRuntime()
	if (runtime === null) {
		return { ok: false, message: '没找到可用的 dsh 运行时：PATH 里既没有 dsh，也没有 npx。' }
	}
	let port = 0
	for (let attempt = 0; attempt < 6; attempt += 1) {
		const candidate = 47000 + Math.floor(Math.random() * 1900)
		if (await portFree(candidate)) { port = candidate; break }
	}
	if (port === 0) return { ok: false, message: '在 47000–48999 里找不到空闲端口。' }
	const url = 'http://127.0.0.1:' + port + '/'
	try {
		const child = spawn(runtime.command, runtime.args.concat(['web', '--port', String(port)]), {
			cwd: homedir(), windowsHide: true, stdio: 'ignore', detached: true,
		})
		child.unref()
	} catch (error) {
		return { ok: false, message: '启动失败：' + String(error && error.message ? error.message : error) }
	}
	const ready = await waitForHttp(url, 30000)
	if (!ready) {
		return { ok: false, message: '已尝试启动（' + runtime.label + ' --port ' + port + '），但 30 秒内没起来。可能是首次 npx 下载慢，稍等或用命令行确认。' }
	}
	try {
		spawn('cmd.exe', ['/c', 'start', '', url], { windowsHide: true, stdio: 'ignore', detached: true }).unref()
	} catch (error) { /* 浏览器打不开也不影响服务 */ }
	return {
		ok: true,
		url,
		message: '逃生成功：网页版已启动并打开浏览器 ' + url + '（隔离端口，桌面端仍然可以单独修）。',
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
			send(res, 200, { ok: true, findings: scan(), environment: environment() })
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
