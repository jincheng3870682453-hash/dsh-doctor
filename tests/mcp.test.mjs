// MCP 面（tools/mcp.mjs）的 stdio 回归测试。
//
// 覆盖：
//   1. initialize / tools/list：六个工具都在，serverInfo 版本号跟 plugin/package.json 走；
//   2. doctor_scan 在假 DSH_HOME 上正常出结果；
//   3. doctor_sys_list 永远可用（没有引擎也返回表）；
//   4. doctor_sys 读原语：有引擎直通（Windows/CI），没引擎返回 ok:false + 指引（ubuntu）；
//   5. doctor_sys 写原语两段式：不带 token 只拿 dryRun 计划（不执行），
//      错 token 被拒，对 token 放行（引擎结果原样返回，成败由引擎上下文决定），
//      token 一次性（重放被拒）。
import { strict as assert } from 'node:assert'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { version: PLUGIN_VERSION } = require('../plugin/package.json')

const scratch = mkdtempSync(join(tmpdir(), 'dsh-doctor-mcp-'))
const server = spawn(process.execPath, ['tools/mcp.mjs'], {
	cwd: require('node:path').resolve('.'),
	env: { ...process.env, DSH_HOME: join(scratch, 'dsh-home') },
	stdio: ['pipe', 'pipe', 'inherit'],
})

let seq = 0
const pending = new Map()
server.stdout.on('data', (chunk) => {
	for (const line of String(chunk).split(/\r?\n/)) {
		if (line.trim().length === 0) continue
		const message = JSON.parse(line)
		const resolve = pending.get(message.id)
		if (resolve) { pending.delete(message.id); resolve(message) }
	}
})

function call(method, params) {
	seq += 1
	const id = seq
	return new Promise((resolve, reject) => {
		pending.set(id, (message) => {
			if (message.error) reject(new Error(JSON.stringify(message.error)))
			else resolve(message.result)
		})
		server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
		setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout: ' + method)) } }, 60000)
	})
}

function payloadOf(result) {
	return JSON.parse(result.content[0].text)
}

const init = await call('initialize', {})
assert.equal(init.serverInfo.name, 'dsh-doctor')
assert.equal(init.serverInfo.version, PLUGIN_VERSION, 'serverInfo 版本要跟 package.json 走')
console.log('PASS initialize（版本 ' + init.serverInfo.version + '）')

const list = await call('tools/list', {})
const names = list.tools.map((tool) => tool.name)
for (const expected of ['doctor_scan', 'doctor_history', 'doctor_fix', 'doctor_rescue', 'doctor_sys_list', 'doctor_sys']) {
	assert.ok(names.includes(expected), '缺工具：' + expected)
}
console.log('PASS tools/list（6 个工具）')

const scan = payloadOf(await call('tools/call', { name: 'doctor_scan', arguments: {} }))
assert.equal(scan.ok, true)
assert.ok(Array.isArray(scan.findings), '体检结果应是数组')
console.log('PASS doctor_scan（' + scan.findings.length + ' 条发现）')

const sysList = payloadOf(await call('tools/call', { name: 'doctor_sys_list', arguments: {} }))
assert.equal(sysList.ok, true)
assert.ok(sysList.readOnly.includes('acl-read'))
assert.ok(sysList.write.includes('set-integrity-label'))
console.log('PASS doctor_sys_list（engine: ' + (sysList.engine === null ? '未配置（ubuntu 预期）' : '已找到') + '）')

// 读原语：有引擎 ok:true；没引擎 ok:false + 指引（两者都算通过，只验证协议形状）。
const probe = payloadOf(await call('tools/call', {
	name: 'doctor_sys', arguments: { op: 'port-probe', args: { port: 1, timeoutMs: 200 } },
}))
assert.equal(probe.ok, sysList.engine !== null, '读原语的 ok 应与引擎可用性一致')
if (probe.ok) assert.equal(probe.data.open, false, '1 端口不该开着')
console.log('PASS doctor_sys 读原语直通（ok=' + probe.ok + '）')

// 写原语：两段式。
const notifyArgs = { op: 'notify', args: { title: 'mcp-test', body: '两段式确认协议测试' } }
const dry = payloadOf(await call('tools/call', { name: 'doctor_sys', arguments: notifyArgs }))
assert.equal(dry.dryRun, true, '不带 confirm 必须只拿 dryRun')
assert.ok(typeof dry.token === 'string' && dry.token.length >= 8)
assert.equal(dry.plan.op, 'notify')
console.log('PASS 写原语第一步：dryRun + token')

// 错 token：被拒且重新发 token。
const wrong = payloadOf(await call('tools/call', { name: 'doctor_sys', arguments: { ...notifyArgs, confirm: 'deadbeef' } }))
assert.equal(wrong.dryRun, true, '错 token 应再次回到 dryRun')
assert.notEqual(wrong.token, dry.token)
console.log('PASS 错 token 被拒')

// 对 token：放行一次（引擎结果原样返回，成败看上下文）。
const exec = payloadOf(await call('tools/call', { name: 'doctor_sys', arguments: { ...notifyArgs, confirm: dry.token } }))
assert.ok(typeof exec.ok === 'boolean')
assert.equal(exec.dryRun, undefined, '对 token 后不应再是 dryRun')
console.log('PASS 对 token 放行（引擎应答 ok=' + exec.ok + (exec.ok === false ? '：' + String(exec.error).slice(0, 60) : '') + '）')

// 重放：同一 token 第二次必须失效。
const replay = payloadOf(await call('tools/call', { name: 'doctor_sys', arguments: { ...notifyArgs, confirm: dry.token } }))
assert.equal(replay.dryRun, true, 'token 必须一次性')
console.log('PASS token 一次性（重放回 dryRun）')

// 未知名：明确拒绝。
const unknown = payloadOf(await call('tools/call', { name: 'doctor_sys', arguments: { op: 'exec' } }))
assert.equal(unknown.ok, false, 'exec 不在原语表里，必须拒绝')
console.log('PASS 未知名拒绝（无 shell 通道）')

server.kill()
rmSync(scratch, { recursive: true, force: true })
console.log('mcp test OK (' + process.platform + ')')
