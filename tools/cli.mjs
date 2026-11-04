// dsh-doctor 跨平台命令行（Windows / macOS / Linux 通用）。
//
// 与插件共用同一份逻辑：plugin/lib/index.js 导出的 scan / applyFixById / readHistory / rescueWeb。
// 用法：
//   node dsh-doctor.mjs            # 交互菜单
//   node dsh-doctor.mjs scan       # 只读体检
//   node dsh-doctor.mjs fix desktop-label
//   node dsh-doctor.mjs fix workspace-entry --yes
//   node dsh-doctor.mjs history
//   node dsh-doctor.mjs rescue
import { readFileSync } from 'node:fs'
import { scan, applyFixById, readHistory, rescueWeb, buildAiReport, buildDiffReport, writeDiffReport } from '../plugin/lib/index.js'

/** 版本统一从 plugin/package.json 读，避免各处硬编码漂移。 */
function readVersion() {
	const candidates = [
		new URL('../plugin/package.json', import.meta.url),
		new URL('./plugin/package.json', import.meta.url),
	]
	for (const candidate of candidates) {
		try { return String(JSON.parse(readFileSync(candidate, 'utf8')).version) } catch (error) { /* 试下一个 */ }
	}
	return 'unknown'
}

const FIXES = [
	['desktop-label', '修桌面图标变白（Windows 专用）'],
	['workspace-entry', '移除危险工作区（桌面/用户目录/盘根）'],
	['profile-host-dup', '隔离 profile 里的宿主包副本'],
	['restore-patch-layer', '从备份恢复 cordis.patch.yml'],
]

const args = process.argv.slice(2)
const command = (args[0] || '').toLowerCase()

function line(text) { process.stdout.write(text + '\n') }
function hr() { line('─'.repeat(72)) }

function severityLabel(severity) {
	if (severity === 'high') return '[高危]'
	if (severity === 'medium') return '[提醒]'
	return '[信息]'
}

function printFindings(findings) {
	line('')
	if (findings.length === 0) {
		line('没有发现问题。')
		return
	}
	for (const item of findings) {
		line(severityLabel(item.severity) + '  ' + String(item.title))
		if (item.detail) line('    ' + String(item.detail))
		if (item.path) line('    ' + String(item.path))
		if (item.fixId) line('    → 可一键修复：node dsh-doctor.mjs fix ' + item.fixId)
		line('')
	}
	const high = findings.filter(item => item.severity === 'high').length
	const medium = findings.filter(item => item.severity === 'medium').length
	line('总结：' + high + ' 个高危 / ' + medium + ' 条提醒 / 共 ' + findings.length + ' 条')
}

async function runFix(id, options = {}) {
	if (typeof id !== 'string' || id.length === 0) {
		line('可用的修复项：')
		for (const [key, description] of FIXES) line('  ' + key.padEnd(20) + description)
		return 1
	}
	line('执行修复：' + id)
	const result = await applyFixById(id)
	line(String(result !== null && result.message ? result.message : JSON.stringify(result)))
	if (result !== null && result.backup) line('备份：' + result.backup)
	return result !== null && result.ok === true ? 0 : 1
}

async function showHistory() {
	const entries = readHistory(20)
	if (entries.length === 0) { line('还没有修复记录。'); return }
	line('修复录（最近 ' + entries.length + ' 条）：')
	for (const entry of entries) {
		line('  ' + (entry.ok === true ? '[成功]' : '[失败]') + '  ' + entry.at + '  ' + entry.id)
		if (entry.message) line('      ' + entry.message)
	}
}

async function showDiffReport() {
	const file = writeDiffReport()
	if (file) line('差异报告已保存到桌面：' + file)
	line('')
	line(buildDiffReport())
}

async function menu() {
	while (true) {
		line('')
		line('  DSH 私人医生 · 点一下修复。')
		hr()
		line('  1) 体检（只读）')
		line('  2) 修桌面图标变白')
		line('  3) 移除危险工作区')
		line('  4) 隔离 profile 里的宿主包副本')
		line('  5) 恢复被清空的 cordis.patch.yml')
		line('  6) 查看修复录')
		line('  7) 起网页版（最后一招）')
		line('  8) 生成环境差异报告（对照标准 DSH，可提交 issue）')
		line('  0) 退出')
		hr()
		const answer = await ask('  选择：')
		const choice = String(answer || '').trim()
		try {
			if (choice === '0') return 0
			if (choice === '1') printFindings(await scan())
			else if (choice === '2') await runFix('desktop-label')
			else if (choice === '3') await runFix('workspace-entry')
			else if (choice === '4') await runFix('profile-host-dup')
			else if (choice === '5') await runFix('restore-patch-layer')
			else if (choice === '6') await showHistory()
			else if (choice === '7') line(String((await rescueWeb()).message || ''))
			else if (choice === '8') await showDiffReport()
			else line('无效的选择。')
		} catch (error) {
			line('操作失败：' + String(error && error.message ? error.message : error))
		}
	}
}

function ask(prompt) {
	return new Promise((resolve) => {
		process.stdout.write(prompt)
		const onData = (chunk) => {
			process.stdin.pause()
			process.stdin.removeListener('data', onData)
			resolve(String(chunk).trim())
		}
		process.stdin.resume()
		process.stdin.once('data', onData)
	})
}

async function main() {
	if (command === '' || command === 'menu') return menu()
	if (command === 'scan') { printFindings(await scan()); return 0 }
	if (command === 'fix') { return runFix(args[1]) }
	if (command === 'history') { await showHistory(); return 0 }
	if (command === 'rescue') { line(String((await rescueWeb()).message || '')); return 0 }
	if (command === 'report') { line(buildAiReport()); return 0 }
	if (command === 'diff') { await showDiffReport(); return 0 }
	if (command === 'version' || command === '--version' || command === '-v') { line(readVersion()); return 0 }
	line('未知命令：' + command)
	line('可用：scan | fix <id> | history | rescue | version | （无参数进菜单）')
	return 2
}

main().then((code) => { process.exitCode = code }).catch((error) => {
	line('失败：' + String(error && error.stack ? error.stack : error))
	process.exitCode = 1
})
