// 插件 → doctor-sys 桥的行为测试（不需要真的引擎 exe）。
//
// 覆盖：
//   1. 没配 DSH_DOCTOR_SYS / 路径不存在 => 返回 null（调用方走 PowerShell 兜底）；
//   2. 配了 => 走 CLI 协议（--key value / 布尔变旗标），解析第一行 JSON 应答；
//   3. 引擎答 ok:false => 原样返回对象（由调用方决定回退），不是 null；
//   4. 输出不是 JSON / 进程起不来 => null。
//
// unix（CI 的 ubuntu job）用可执行 shell 脚本当假引擎全量验证；Windows 用 .cmd
// 假引擎验证同一套正向逻辑（桥接会把 .cmd 套上 cmd.exe /c 再跑）。
import { strict as assert } from 'node:assert'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const scratch = mkdtempSync(join(tmpdir(), 'dsh-doctor-bridge-'))
process.env.DSH_HOME = join(scratch, 'dsh-home')

const engine = await import('../plugin/lib/index.js')

// 1. 没配置 => null
delete process.env.DSH_DOCTOR_SYS
assert.equal(engine.doctorSys('acl-read', { path: '/x' }), null, '未配置时应返回 null')
assert.equal(engine.doctorSysPath(), null)

// 1b. 配了但路径不存在 => null
process.env.DSH_DOCTOR_SYS = join(scratch, 'not-there.exe')
assert.equal(engine.doctorSys('acl-read', { path: '/x' }), null, '路径不存在时应返回 null')
assert.equal(engine.doctorSysPath(), null)

if (process.platform !== 'win32') {
	const callLog = join(scratch, 'calls.log')
	const fake = join(scratch, 'fake-doctor-sys')
	writeFileSync(fake, [
		'#!/bin/sh',
		'echo "$@" >> "$CALLS"',
		'echo \'{"ok":true,"op":"fake","data":{"seen":"yes"}}\'',
		'',
	].join('\n'))
	chmodSync(fake, 0o755)

	// 2. 正常调用：CLI 形式 + JSON 应答
	process.env.DSH_DOCTOR_SYS = fake
	process.env.CALLS = callLog
	const answer = engine.doctorSys('set-integrity-label', { path: '/tmp/x y', label: 'medium', recursive: true })
	assert.deepEqual(answer, { ok: true, op: 'fake', data: { seen: 'yes' } }, '应解析第一行 JSON')
	const calls = (await import('node:fs')).readFileSync(callLog, 'utf8').trim().split('\n')
	assert.equal(calls[0], 'set-integrity-label --path /tmp/x y --label medium --recursive', '布尔应转成旗标、字符串应带值')

	// 3. 引擎答 ok:false => 返回对象而非 null（调用方自行回退）
	writeFileSync(fake, '#!/bin/sh\necho \'{"ok":false,"op":"acl-read","error":"boom"}\'\n')
	chmodSync(fake, 0o755)
	const failed = engine.doctorSys('acl-read', { path: '/x' })
	assert.deepEqual(failed, { ok: false, op: 'acl-read', error: 'boom' }, 'ok:false 应原样返回')

	// 4. 输出不是 JSON => null
	writeFileSync(fake, '#!/bin/sh\necho "not json"\n')
	chmodSync(fake, 0o755)
	assert.equal(engine.doctorSys('acl-read', { path: '/x' }), null, '非 JSON 输出应返回 null')

	// 4b. 进程起不来（退出码非 0）=> null
	writeFileSync(fake, '#!/bin/sh\nexit 3\n')
	chmodSync(fake, 0o755)
	assert.equal(engine.doctorSys('acl-read', { path: '/x' }), null, '非 0 退出码应返回 null')
}

if (process.platform === 'win32') {
	// Windows：用 .cmd 假引擎。桥接会套 cmd.exe /c，这里验证同样的正向逻辑。
	const callLog = join(scratch, 'calls-win.log')
	const fake = join(scratch, 'fake-doctor-sys.cmd')
	const writeFake = (text) => writeFileSync(fake, ['@echo off', 'echo %* >> "%CALLS%"', 'echo ' + text, ''].join('\r\n'))
	process.env.DSH_DOCTOR_SYS = fake
	process.env.CALLS = callLog

	writeFake('{"ok":true,"op":"fake","data":{"seen":"yes"}}')
	const answer = engine.doctorSys('set-integrity-label', { path: 'C:\\x y', label: 'medium', recursive: true })
	assert.deepEqual(answer, { ok: true, op: 'fake', data: { seen: 'yes' } }, '.cmd 引擎应解析第一行 JSON')
	const calls = readFileSync(callLog, 'utf8').trim().split(/\r?\n/)
	assert.ok(calls[0].includes('set-integrity-label'), '应调用对的原语')
	assert.ok(calls[0].includes('--path'), '应把参数转成 --key value')
	assert.ok(calls[0].includes('--recursive'), '布尔应转成旗标')

	writeFake('{"ok":false,"op":"acl-read","error":"boom"}')
	const failed = engine.doctorSys('acl-read', { path: '/x' })
	assert.deepEqual(failed, { ok: false, op: 'acl-read', error: 'boom' }, 'ok:false 应原样返回')

	writeFake('not json')
	assert.equal(engine.doctorSys('acl-read', { path: '/x' }), null, '非 JSON 输出应返回 null')
}

delete process.env.DSH_DOCTOR_SYS
rmSync(scratch, { recursive: true, force: true })
console.log('bridge test OK (' + process.platform + ')')
