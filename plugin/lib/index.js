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
import { existsSync, readFileSync, readdirSync, renameSync, copyFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

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
	const builtin = [checkDesktopAcl, checkWorkspaces, checkDesktopSessions, checkProfileHostDuplicates, checkCrashLogs]
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

const FIXES = {
	'desktop-label': fixDesktopLabel,
	'workspace-entry': fixWorkspaceEntries,
	'profile-host-dup': fixProfileHostDup,
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
			send(res, 200, result)
			return
		}
		send(res, 404, { ok: false, message: 'not found' })
	} catch (error) {
		send(res, 500, { ok: false, message: String(error && error.message ? error.message : error) })
	}
}

export const inject = ['workspaceRegistry']

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
