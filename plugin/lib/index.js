/**
 * dsh-doctor 的 host 半边。
 *
 * 它只做两件事：
 *   1. 读本机状态（桌面 ACL、工作区注册、profile 里的宿主包副本、会话、崩溃日志）；
 *   2. 通过同源路由把这些状态和"一键修复"暴露给侧边栏面板。
 *
 * 设计约束（怕把这台机器搞爆）：
 *   - 所有检查/修复各自 try/catch，单条失败不影响其它；
 *   - 不写 DSH 安装目录、不碰 app.asar；
 *   - 每个写操作先备份，改完立刻复检；
 *   - 没有 shell 通道：路由只接受固定的 fix id，绝不执行任意命令。
 */
import { existsSync, readFileSync, readdirSync, renameSync, copyFileSync, statSync, writeFileSync, lstatSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const PREFIX = '/dsh-doctor'
const CRITICAL_HOST_PACKAGES = ['dsh-tools', 'dsh-skill', 'schemastery', 'dsh-util-values', 'cordis']

function dshHome() {
	const configured = process.env.DSH_HOME
	if (typeof configured === 'string' && configured.length > 0) return configured
	return join(homedir(), '.dsh')
}

function desktopPath() {
	return join(homedir(), 'Desktop')
}

/** 跑一条 PowerShell，永远不抛。 */
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

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, 'utf8'))
	} catch (error) {
		return null
	}
}

function latestWriteMs(dir) {
	let newest = 0
	try {
		const entries = readdirSync(dir, { withFileTypes: true })
		for (const entry of entries) {
			const full = join(dir, entry.name)
			try {
				if (entry.isDirectory()) newest = Math.max(newest, latestWriteMs(full))
				else newest = Math.max(newest, statSync(full).mtimeMs)
			} catch (error) { /* 单个条目失败忽略 */ }
		}
	} catch (error) { /* 目录不可读忽略 */ }
	return newest
}

function finding(id, severity, title, detail, path, fixId) {
	return { id, severity, title, detail, path: path === undefined ? '' : path, fixId: fixId === undefined ? null : fixId }
}

/* ── 检查 ───────────────────────────────────────────────────────────── */

function checkDesktopAcl() {
	const findings = []
	const desktop = desktopPath()
	if (!existsSync(desktop)) return findings
	const sddl = aclSddl(desktop)
	if (sddl.length === 0) return findings
	if (/S:\(ML;;[^;]*;;;LW/.test(sddl)) {
		findings.push(finding('desktop-low-label', 'high',
			'桌面被打了 Low 完整性标签（图标会变白）',
			'沙箱授写权限的副产物。图标变白不是因为缓存坏了——Explorer 在低完整性目录里取不到图标。修复会改回 Medium，同时保留能力 ACE（写入不受影响）。',
			desktop, 'desktop-label'))
	}
	if (/\(D;[^)]*;;;WD\)/.test(sddl)) {
		findings.push(finding('desktop-everyone-deny', 'medium',
			'桌面上留着 Everyone 的删除拒绝项',
			'沙箱授权时盖上的，DSH 从不回收。它不影响图标渲染，但会挡住正常清理。',
			desktop, 'desktop-label'))
	}
	return findings
}

function readWorkspaceEntries() {
	const file = join(dshHome(), 'storages', 'workspace.json')
	if (!existsSync(file)) return { file, entries: [] }
	let raw = ''
	try { raw = readFileSync(file, 'utf8') } catch (error) { return { file, entries: [] } }
	const entries = []
	const matches = raw.match(/"([A-Za-z]:[^"]{1,400})"/g)
	if (matches !== null) {
		for (const match of matches) {
			const value = match.slice(1, -1).replace(/\\\\/g, '\\')
			if (!entries.includes(value)) entries.push(value)
		}
	}
	return { file, entries }
}

function workspaceRisk(path) {
	const userProfile = homedir()
	if (path.length === 0 || userProfile.length === 0) return null
	const normalized = path.replace(/[\\/]+$/, '')
	const target = normalized.toLowerCase()
	const profile = userProfile.replace(/[\\/]+$/, '').toLowerCase()
	const risky = [
		[profile, '用户目录本身'],
		[join(userProfile, 'Desktop').toLowerCase(), '桌面本身'],
		[join(userProfile, 'Documents').toLowerCase(), '文档目录'],
		[join(userProfile, 'Downloads').toLowerCase(), '下载目录'],
		[join(userProfile, 'Pictures').toLowerCase(), '图片目录'],
	]
	for (const [candidate, label] of risky) {
		if (target === candidate.toLowerCase()) return label
	}
	if (/^[a-z]:$/.test(target)) return '整个盘根'
	return null
}

function checkWorkspaces() {
	const findings = []
	const { entries } = readWorkspaceEntries()
	for (const entry of entries) {
		const risk = workspaceRisk(entry)
		if (risk === null) continue
		findings.push(finding('workspace-risky-path', 'high',
			'工作区被注册到了「' + risk + '」',
			'每次给这个工作区授沙箱写权限，DSH 都会重新盖一遍 Low 标签和拒绝项，所以图标变白会反复复发。把它改成子目录或别的盘才是断根。',
			entry, 'workspace-entry'))
	}
	return findings
}

function desktopSessionSlug() {
	const desktop = desktopPath()
	const slug = desktop.replace(/[:\\/]/g, '-')
	return '--' + slug + '--'
}

function checkDesktopSessions() {
	const findings = []
	const sessionsRoot = join(dshHome(), 'sessions')
	if (!existsSync(sessionsRoot)) return findings
	const slug = desktopSessionSlug()
	const now = Date.now()
	let dirs = []
	try { dirs = readdirSync(sessionsRoot, { withFileTypes: true }) } catch (error) { return findings }
	for (const dir of dirs) {
		if (!dir.isDirectory() || dir.name.toLowerCase() !== slug.toLowerCase()) continue
		const full = join(sessionsRoot, dir.name)
		const newest = latestWriteMs(full)
		const minutes = newest === 0 ? Infinity : Math.round((now - newest) / 60000)
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
	let profiles = []
	try { profiles = readdirSync(profilesRoot, { withFileTypes: true }) } catch (error) { return results }
	const candidates = []
	for (const profile of profiles) {
		if (!profile.isDirectory()) continue
		const base = join(profilesRoot, profile.name)
		candidates.push(join(base, 'node_modules', '@deepseek-ai'))
		candidates.push(join(base, 'node_modules', '.ignored', '@deepseek-ai'))
	}
	candidates.push(join(profilesRoot, 'node_modules', '@deepseek-ai'))
	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue
		let info = null
		try { info = lstatSync(candidate) } catch (error) { continue }
		if (!info.isDirectory()) continue
		if (candidate.toLowerCase().includes('.ignored') || candidate.toLowerCase().includes('.stale')) continue
		results.push(candidate)
	}
	return results
}

function readDirNames(dir) {
	try {
		return readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
	} catch (error) {
		return []
	}
}

function checkProfileHostDuplicates() {
	const findings = []
	for (const dir of profileHostDirs()) {
		const packages = readDirNames(dir)
		const hostPackages = packages.filter(name => CRITICAL_HOST_PACKAGES.includes(name))
		if (hostPackages.length === 0) continue
		findings.push(finding('profile-host-duplicate', 'high',
			'profile 里出现了宿主包副本：' + hostPackages.join(', '),
			'同一个进程里两份 @deepseek-ai/dsh-tools 会造出两个 Symbol，表现为 "Cannot read properties of undefined (reading \'prepare\')"；旧版本副本则表现为 "is incompatible with dsh"。隔离后请完整退出并重开桌面端。',
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

function scan() {
	const checks = [checkDesktopAcl, checkWorkspaces, checkDesktopSessions, checkProfileHostDuplicates, checkCrashLogs]
	const findings = []
	for (const check of checks) {
		try {
			for (const item of check()) findings.push(item)
		} catch (error) {
			findings.push(finding('check-failed:' + check.name, 'low', '检查失败：' + check.name, String(error && error.message ? error.message : error), '', null))
		}
	}
	return findings
}

function environment() {
	return {
		dshHome: dshHome(),
		desktop: desktopPath(),
		profiles: readDirNames(join(dshHome(), 'profiles')),
		desktopSessions: existsSync(join(dshHome(), 'sessions')) ? readDirNames(join(dshHome(), 'sessions')).length : 0,
		node: process.version,
		platform: process.platform,
		at: new Date().toISOString(),
	}
}

/* ── 修复 ───────────────────────────────────────────────────────────── */

function fixDesktopLabel() {
	const desktop = desktopPath()
	if (!existsSync(desktop)) return { ok: false, message: '找不到桌面目录：' + desktop }
	const before = aclSddl(desktop)
	if (!/S:\(ML;;[^;]*;;;LW/.test(before) && !/\(D;[^)]*;;;WD\)/.test(before)) {
		return { ok: true, unchanged: true, message: '桌面 ACL 已经是干净的，不需要修。' }
	}
	const backupDir = join(dshHome(), 'dsh-doctor-backups')
	try { mkdirp(backupDir) } catch (error) { /* 有则忽略 */ }
	const backupFile = join(backupDir, 'desktop-acl-' + Date.now() + '.txt')
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

function mkdirp(dir) {
	if (existsSync(dir)) return
	try { mkdirSync(dir, { recursive: true }) } catch (error) { /* ignore */ }
}

function fixWorkspaceEntries() {
	const { file } = readWorkspaceEntries()
	if (!existsSync(file)) return { ok: false, message: '找不到工作区注册表：' + file }
	const raw = readFileSync(file, 'utf8')
	let parsed = null
	try { parsed = JSON.parse(raw) } catch (error) { return { ok: false, message: 'workspace.json 不是合法 JSON，先不动它。' } }
	const targets = []
	const matches = raw.match(/"([A-Za-z]:[^"]{1,400})"/g)
	if (matches !== null) {
		for (const match of matches) {
			const value = match.slice(1, -1).replace(/\\\\/g, '\\')
			if (workspaceRisk(value) !== null && !targets.includes(value)) targets.push(value)
		}
	}
	if (targets.length === 0) return { ok: true, unchanged: true, message: '没有发现危险的工作区注册，不需要修。' }

	const backup = file + '.bak-' + Date.now()
	copyFileSync(file, backup)
	let updated = raw
	for (const target of targets) {
		const escaped = target.replace(/\\/g, '\\\\')
		updated = updated.split('"' + escaped + '"').join('')
	}
	updated = updated.replace(/,\s*([\]}])/g, '$1').replace(/([\[{])\s*,/g, '$1').replace(/,\s*,/g, ',')
	try { JSON.parse(updated) } catch (error) {
		copyFileSync(backup, file)
		return { ok: false, message: '改写后不是合法 JSON，已还原。' }
	}
	writeFileSync(file, updated, 'utf8')
	return {
		ok: true,
		verified: true,
		message: '已从工作区注册表移出 ' + targets.length + ' 条危险路径：' + targets.join('、') + '。重启桌面端后生效。',
		backup,
	}
}

function fixProfileHostDup() {
	const dirs = profileHostDirs().filter(dir => {
		const packages = readDirNames(dir)
		return packages.some(name => CRITICAL_HOST_PACKAGES.includes(name))
	})
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
	const body = JSON.stringify(payload)
	res.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store',
	})
	res.end(body)
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
			try { result = fix() } catch (error) {
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

export function apply(ctx) {
	ctx.inject(['webServer'], (scoped) => {
		scoped.effect(() => scoped.webServer.register({
			kind: 'prefix',
			path: PREFIX,
			handler: handle,
		}), 'dsh-doctor: status and fix routes')
	})
}
