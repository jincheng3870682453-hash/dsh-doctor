// 插件 → doctor-sys 桥的行为测试（不需要真的引擎 exe）。
//
// 覆盖：
//   1. 没配 DSH_DOCTOR_SYS / 路径不存在 => 返回 null（调用方走 PowerShell 兜底）；
//   2. 配了 => 走 CLI 协议（--key value / 布尔变旗标），解析第一行 JSON 应答；
//   3. 引擎答 ok:false => 原样返回对象（由调用方决定回退），不是 null；
//   4. 输出不是 JSON / 进程起不来 => null。
//
// unix（CI 的 ubuntu job）用可执行 shell 脚本当假引擎全量验证；Windows 本机
// 没法直接 spawn 脚本文件（.cmd 会 EINVAL），只验 1 的回退分支——桥的正向
// 逻辑由 ubuntu 覆盖，Windows 下真实 exe 的行为由 doctor-sys 自己的 selftest 覆盖。
import { strict as assert } from 'node:assert'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

delete process.env.DSH_DOCTOR_SYS
rmSync(scratch, { recursive: true, force: true })
console.log('bridge test OK (' + process.platform + ')')
