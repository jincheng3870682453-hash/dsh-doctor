// 工作区完整性标签检查与修复的行为测试（不需要真引擎、不碰真实桌面）。
//
// 背景：DSH 把"向下写"的隔离手段盖在用户自己的项目目录上（工作区被打 Low 标签）。
// 写探针探不出它（Medium 进程写 Low 对象是放行的），只能读 SDDL——
// 所以 checkWorkspaceLabels 用 aclSddl 判据，fixWorkspaceLabel 复用引擎/icacls 链路。
//
// 方式：DSH_HOME 指向临时目录 + 造假 workspace.json；
// Windows 上用 .cmd 假引擎回放 acl-read 的 SDDL（桥接会套 cmd.exe /c），
// 非引擎路径则回退 PowerShell——CI 的 ubuntu job 没有 PowerShell 语义，只测 JS 侧
// 的注册表/降级逻辑；Windows 本地与 CI runner 走全量 SDDL 断言。
import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const scratch = mkdtempSync(join(tmpdir(), 'dsh-doctor-wslabel-'))
const home = join(scratch, 'dsh-home')
process.env.DSH_HOME = home
mkdirSync(join(home, 'storages'), { recursive: true })

const workspaceDir = join(scratch, 'project')
mkdirSync(workspaceDir, { recursive: true })
writeFileSync(join(home, 'storages', 'workspace.json'), JSON.stringify({
	unit: { name: 'workspace', version: 2 },
	global: { initialized: true, workspaceIds: ['proj'] },
	tables: { workspaces: { proj: { path: workspaceDir, title: '项目' } } },
}, null, 2), 'utf8')

const engine = await import('../plugin/lib/index.js')

// LOW_LABEL_PATTERN 判据本身已有 tests/label-pattern.test.mjs 全表覆盖；
// 这里验证检查函数把"注册的工作区 + Low SDDL"接到同一个判据上。
assert.equal(engine.LOW_LABEL_PATTERN.test('S:(ML;;NW;;;LW)'), true, '经典直写形态应命中')
assert.equal(engine.LOW_LABEL_PATTERN.test('S:AI(ML;CIOI;NW;;;ME)'), false, 'Medium 标签不应命中')

if (process.platform === 'win32') {
	// 找到当前 node 的绝对路径：假引擎里不能裸调 node（CI runner 的 PATH 里有，
	// 但被沙箱/受控环境启动时未必），用 process.execPath 注入才密封。
	const nodeExe = process.execPath
	// 桥会把假引擎套上 cmd.exe /c 执行。假引擎带状态：
	//   acl-read            → 按 ACL_ANSWER 的当前内容应答（Low 或 Medium）；
	//   set-integrity-label → 默认把应答切到 Medium（模拟标签真的被改掉了）；
	//                         ACL_STICKY=1 时不切（模拟"改了但没生效"，验证 fail-closed）。
	const fake = join(scratch, 'fake-doctor-sys.cmd')
	const answerFile = join(scratch, 'acl-read-answer.json')
	const lowFile = join(scratch, 'answer-low.json')
	const mediumFile = join(scratch, 'answer-medium.json')
	const writeAnswer = (file, sddl) => {
		writeFileSync(file, '{"ok":true,"op":"acl-read","data":{"path":"x","sddl":"' + sddl + '","integrity":"low"}}\n', 'ascii')
	}
	const lowSddl = 'O:S-1-5-21-1G:S:D:AI(A;OICI;FA;;;S-1-5-21-2)S:AI(ML;CIOI;NW;;;LW)'
	const mediumSddl = 'O:S-1-5-21-1G:S:D:AI(A;OICI;FA;;;S-1-5-21-2)S:AI(ML;CIOI;NW;;;ME)'
	writeAnswer(lowFile, lowSddl)
	writeAnswer(mediumFile, mediumSddl)
	writeFileSync(fake, [
		'@echo off',
		'if "%~1"=="acl-read" (',
		'  "' + nodeExe + '" -e "require(\'fs\').createReadStream(process.env.ACL_ANSWER).pipe(process.stdout)"',
		') else if "%~1"=="set-integrity-label" (',
		'  if not "%ACL_STICKY%"=="1" copy /y "%ACL_MEDIUM%" "%ACL_ANSWER%" >nul',
		'  echo {"ok":true,"op":"set-integrity-label","data":{"done":true}}',
		') else (',
		'  echo {"ok":true,"op":"%~1","data":{"done":true}}',
		')',
		'',
	].join('\r\n'), 'ascii')
	process.env.DSH_DOCTOR_SYS = fake
	process.env.ACL_ANSWER = answerFile
	process.env.ACL_MEDIUM = mediumFile
	delete process.env.ACL_STICKY
	// acl-read 的低标签应答直接指向 low 文件；ACL_STICKY 场景由下面单独设置。
	const setSddl = (sddl) => {
		writeAnswer(answerFile, sddl)
	}
	const setRegistry = (id, path, title) => {
		writeFileSync(join(home, 'storages', 'workspace.json'), JSON.stringify({
			unit: { name: 'workspace', version: 2 },
			global: { workspaceIds: [id] },
			tables: { workspaces: { [id]: { path, title } } },
		}, null, 2), 'utf8')
	}

	// 不存在的目录：不触发标签检查（由 workspace-missing 负责）。
	const missing = join(scratch, 'not-there')
	setRegistry('gone', missing, '不存在')
	const scanMissing = await engine.scan()
	assert.ok(!scanMissing.some(item => item.id === 'workspace-low-label'),
		'不存在的目录不应触发 workspace-low-label（实际：' + JSON.stringify(scanMissing.map(f => f.id)) + '）')

	// Low SDDL：高危 + 接上 workspace-label。
	setRegistry('proj', workspaceDir, '项目')
	setSddl('O:S-1-5-21-1G:S:D:AI(A;OICI;FA;;;S-1-5-21-2)S:AI(ML;CIOI;NW;;;LW)')
	const findings = await engine.scan()
	const low = findings.filter(item => item.id === 'workspace-low-label')
	assert.equal(low.length, 1, 'Low SDDL 的工作区应报 workspace-low-label（实际：' + JSON.stringify(findings.map(f => f.id)) + '）')
	assert.equal(low[0].fixId, 'workspace-label', '应接上 workspace-label 修复')
	assert.equal(low[0].severity, 'high', 'Low 标签是高危')
	assert.equal(low[0].path.toLowerCase(), workspaceDir.toLowerCase(), 'path 应指向工作区目录')

	// 干净 SDDL：不应报。
	setSddl('O:S-1-5-21-1G:S:D:AI(A;OICI;FA;;;S-1-5-21-2)S:AI(ML;CIOI;NW;;;ME)')
	const clean = await engine.scan()
	assert.ok(!clean.some(item => item.id === 'workspace-low-label'), 'Medium SDDL 不应报 workspace-low-label')
	assert.ok(!clean.some(item => item.id === 'workspace-everyone-deny'), '干净 SDDL 不应报 workspace-everyone-deny')

	// Everyone 拒绝项：medium，接同一个修复。
	setSddl('O:S-1-5-21-1G:S:D:AI(A;OICI;FA;;;S-1-5-21-2)(D;CIID;DC;;;WD)S:AI(ML;CIOI;NW;;;ME)')
	const deny = await engine.scan()
	const denyFindings = deny.filter(item => item.id === 'workspace-everyone-deny')
	assert.equal(denyFindings.length, 1, 'Everyone 拒绝项应报 workspace-everyone-deny')
	assert.equal(denyFindings[0].severity, 'medium', '拒绝项是提醒级')
	assert.equal(denyFindings[0].fixId, 'workspace-label', '拒绝项也接 workspace-label')

	// ACL 读不到（引擎返回 ok:false → 桥回退 PowerShell；PowerShell 读真目录不会空，
	// 但临时目录是真存在的，因此走"真实读取"，不触发 unreadable——这条只验证不抛）。
	writeFileSync(answerFile, '{"ok":false,"op":"acl-read","error":"boom"}\n', 'ascii')
	const unreadable = await engine.scan()
	assert.ok(Array.isArray(unreadable), '引擎失败降级后 scan 不应抛')

	// 修复链路：假引擎 set-integrity-label/remove-deny-ace 都答 ok，且标签真的被改掉，
	// 修复后复检读回 Medium —— 应 verified。
	setSddl(lowSddl)
	const fix = await engine.applyFixById('workspace-label')
	assert.equal(fix.ok, true, '假引擎下修复应成功（' + JSON.stringify(fix) + '）')
	assert.equal(readFileSync(answerFile, 'utf8').includes(';;;ME'), true, '修复应把假引擎的状态切到 Medium')

	// 复检仍 Low → fail-closed 报失败：ACL_STICKY=1 让"改标签"不生效。
	process.env.ACL_STICKY = '1'
	setSddl(lowSddl)
	const fixBad = await engine.applyFixById('workspace-label')
	assert.equal(fixBad.ok, false, '复检仍 Low 必须报失败（fail-closed）')
	delete process.env.ACL_STICKY

	delete process.env.DSH_DOCTOR_SYS
	delete process.env.ACL_ANSWER
	delete process.env.ACL_MEDIUM
} else {
	// 非 Windows：检查必须明确返回空（Windows 专属），并且 scan 不抛。
	const findings = await engine.scan()
	assert.ok(Array.isArray(findings), 'scan 应返回数组')
	assert.ok(!findings.some(item => item.id.startsWith('workspace-low')), '非 Windows 不应报工作区标签')
}

delete process.env.DSH_HOME
rmSync(scratch, { recursive: true, force: true })
console.log('workspace-label test OK (' + process.platform + ')')
