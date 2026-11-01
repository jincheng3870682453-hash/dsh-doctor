// dsh-doctor 常驻守护（独立进程，和 DSH 完全解耦）。
//
// 为什么是独立进程：DSH 瘫痪时，写在 DSH 里的任何东西（含插件）都一起死，
// 弹不出任何提示。只有活在它外面的进程才能喊人。
//
// 用法：
//   node tools/watch.mjs --url http://127.0.0.1:19387 --interval 5 --cooldown 600
//
// 行为：
//   - 每 N 秒探测一次 DSH 的本地 HTTP 服务；
//   - 连续 3 次失败 => 判"瘫痪" => 弹 Windows 原生气泡提醒（同一问题 10 分钟内只弹一次）；
//   - 全程只读探测，不重启 DSH、不改任何东西。
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

function arg(name, fallback) {
	const index = process.argv.indexOf(name)
	if (index < 0) return fallback
	const value = process.argv[index + 1]
	return value === undefined ? fallback : value
}

const url = arg('--url', 'http://127.0.0.1:19387')
const intervalSeconds = Math.max(2, Number(arg('--interval', '5')) || 5)
const cooldownSeconds = Math.max(30, Number(arg('--cooldown', '600')) || 600)
const failuresBeforeAlert = 3
const home = process.env.DSH_HOME || join(homedir(), '.dsh')
const logDir = join(home, 'dsh-doctor')
const logFile = join(logDir, 'watch.log')

try { mkdirSync(logDir, { recursive: true }) } catch (error) { /* ignore */ }

function log(line) {
	const text = new Date().toISOString() + ' ' + line + '\n'
	try { appendFileSync(logFile, text, 'utf8') } catch (error) { /* ignore */ }
	process.stdout.write(text)
}

/** doctor-sys 引擎可用就返回它的路径：环境变量优先，其次仓库里 cargo 的构建产物。 */
function enginePath() {
	const candidates = [
		process.env.DSH_DOCTOR_SYS,
		fileURLToPath(new URL('../doctor-sys/target/release/doctor-sys.exe', import.meta.url)),
	].filter((item) => typeof item === 'string' && item.length > 0)
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate
	}
	return null
}

/** Windows 原生气泡通知：doctor-sys 引擎优先（Shell_NotifyIconW），WinForms 兜底。 */
function balloon(title, text) {
	if (process.platform !== 'win32') {
		log('notify(skip, non-windows): ' + title + ' - ' + text)
		return
	}
	const engine = enginePath()
	if (engine !== null) {
		try {
			const run = spawnSync(engine, ['notify', '--title', title, '--body', text, '--timeoutMs', '10000'],
				{ windowsHide: true, encoding: 'utf8', timeout: 20000 })
			const answer = typeof run.stdout === 'string'
				? (() => { try { return JSON.parse(run.stdout.split(/\r?\n/, 1)[0]) } catch (error) { return null } })()
				: null
			if (answer !== null && answer.ok === true && answer.data && answer.data.shown === true) {
				log('notify via doctor-sys: ' + title)
				return
			}
			log('doctor-sys notify not shown, falling back to WinForms')
		} catch (error) {
			log('doctor-sys notify failed, falling back to WinForms: ' + String(error && error.message ? error.message : error))
		}
	}
	const script = [
		'Add-Type -AssemblyName System.Windows.Forms',
		'Add-Type -AssemblyName System.Drawing',
		'$n = New-Object System.Windows.Forms.NotifyIcon',
		'$n.Icon = [System.Drawing.SystemIcons]::Warning',
		'$n.Visible = $true',
		"$n.ShowBalloonTip(10000, " + psString(title) + ', ' + psString(text) + ', [System.Windows.Forms.ToolTipIcon]::Warning)',
		'Start-Sleep -Seconds 8',
		'$n.Dispose()',
	].join('; ')
	const encoded = Buffer.from(script, 'utf16le').toString('base64')
	try {
		spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, timeout: 20000 })
	} catch (error) {
		log('notify failed: ' + String(error && error.message ? error.message : error))
	}
}

function psString(value) {
	return "'" + String(value).replace(/'/g, "''") + "'"
}

async function probe() {
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(3000) })
		return response.status < 500
	} catch (error) {
		return false
	}
}

let consecutiveFailures = 0
let lastAlertAt = 0
let down = false

async function tick() {
	const alive = await probe()
	if (alive) {
		if (down) log('recovered: ' + url)
		consecutiveFailures = 0
		down = false
		return
	}
	consecutiveFailures += 1
	log('probe failed (' + consecutiveFailures + '/' + failuresBeforeAlert + '): ' + url)
	if (consecutiveFailures < failuresBeforeAlert) return
	const now = Date.now()
	if (now - lastAlertAt < cooldownSeconds * 1000) return
	lastAlertAt = now
	down = true
	log('DSH looks down, notifying')
	balloon(
		'DSH 桌面版已瘫痪',
		'连续 ' + failuresBeforeAlert + ' 次探测无响应。可以打开侧边栏「私人医生」修复，或先用网页版继续工作。',
	)
}

log('watch started: url=' + url + ' interval=' + intervalSeconds + 's cooldown=' + cooldownSeconds + 's')
await tick()
setInterval(() => { tick().catch((error) => log('tick error: ' + String(error))) }, intervalSeconds * 1000)
