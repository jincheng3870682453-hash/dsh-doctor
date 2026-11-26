// doctor-sys 真实 CLI 行为测试：只运行显式指定的现有 exe，不自动编译。
// 用法：DSH_DOCTOR_TEST_ENGINE=/path/to/doctor-sys.exe node tests/rust-cli.test.mjs
import { strict as assert } from 'node:assert'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const engine = process.env.DSH_DOCTOR_TEST_ENGINE
if (!engine) {
	console.log('SKIP rust-cli: 未设置 DSH_DOCTOR_TEST_ENGINE；不会编译 doctor-sys')
	process.exit(0)
}
assert.ok(existsSync(engine), `DSH_DOCTOR_TEST_ENGINE 不存在：${engine}`)

const scratch = mkdtempSync(join(tmpdir(), 'dsh-doctor-rust-cli-'))
let assertions = 0

function run(args, input) {
	const child = spawnSync(engine, args, {
		cwd: scratch,
		input,
		encoding: 'utf8',
		windowsHide: true,
		timeout: 15_000,
	})
	assert.equal(child.error, undefined, child.error?.message)
	assert.equal(child.signal, null, `进程被信号终止：${child.signal}`)
	return child
}

function invoke(op, args = {}) {
	const child = run([], JSON.stringify({ op, args }))
	const lines = child.stdout.trim().split(/\r?\n/).filter(Boolean)
	assert.equal(lines.length, 1, `${op} 必须只输出一行 JSON，实际：${JSON.stringify(child.stdout)}；stderr=${child.stderr}`)
	let body
	try {
		body = JSON.parse(lines[0])
	} catch (error) {
		assert.fail(`${op} 输出不是 JSON：${lines[0]}；${error.message}`)
	}
	assert.equal(body.op, op)
	return { child, body }
}

function expectPrimitiveError(op, args = {}) {
	const { child, body } = invoke(op, args)
	assert.equal(child.status, 1, `${op} 原语失败应退出 1：${JSON.stringify(body)}`)
	assert.equal(body.ok, false)
	assert.equal(typeof body.error, 'string')
	assert.ok(body.error.length > 0)
	assertions += 1
	return body
}

function makeSnapshot(name) {
	const snapshotDir = join(scratch, name)
	const data = join(snapshotDir, 'data')
	mkdirSync(data, { recursive: true })
	return { snapshotDir, data, manifest: join(snapshotDir, 'manifest.json') }
}

function writeManifest(snapshot, entries) {
	writeFileSync(snapshot.manifest, JSON.stringify({ entries }))
}

try {
	for (const flag of ['--help', '-h', 'help']) {
		const child = run([flag])
		assert.equal(child.status, 0, `${flag}：${child.stderr}`)
		assert.match(child.stdout, /用法|Usage/i)
		assertions += 1
	}
	const stdioHelp = invoke('help')
	assert.equal(stdioHelp.child.status, 0)
	assert.equal(stdioHelp.body.ok, true)
	assert.match(stdioHelp.body.data.usage, /用法|Usage/i)
	assertions += 1

	const malformed = run([], '{')
	assert.equal(malformed.status, 2)
	assert.equal(malformed.stdout.trim().split(/\r?\n/).length, 1)
	assert.equal(JSON.parse(malformed.stdout).ok, false)
	assertions += 1
	expectPrimitiveError('acl-read', { path: join(scratch, 'definitely-not-present') })

	for (const timeoutMs of ['0', '25']) {
		const { child, body } = invoke('port-probe', {
			host: '127.0.0.1', port: '1', timeoutMs,
		})
		assert.equal(child.status, 0, JSON.stringify(body))
		assert.equal(body.ok, true)
		assert.equal(body.data.port, 1)
		assert.equal(typeof body.data.open, 'boolean')
		assertions += 1
	}
	for (const args of [
		{ pid: '-1', dryRun: true },
		{ pid: '4294967296', dryRun: true },
		{ pid: '12.5', dryRun: true },
	]) {
		expectPrimitiveError('proc-kill-tree', args)
	}
	for (const port of ['0', '-1', '65536', '1.5', '1e3']) {
		expectPrimitiveError('port-pid', { port })
	}
	for (const timeoutMs of ['-1', '4294967296', '2.5']) {
		expectPrimitiveError('notify', { title: 'not sent', body: 'not sent', timeoutMs })
		expectPrimitiveError('port-probe', { host: '127.0.0.1', port: '1', timeoutMs })
	}

	// 正常快照往返：仅写临时目录。
	const source = join(scratch, 'source.txt')
	const writableSnapshot = makeSnapshot('writable-snapshot')
	writeFileSync(source, 'snapshot-content')
	const saved = invoke('snapshot-write', { paths: [source], destDir: writableSnapshot.snapshotDir })
	assert.equal(saved.child.status, 0, JSON.stringify(saved.body))
	writeFileSync(source, 'current-content')
	const restored = invoke('snapshot-restore', { snapshotDir: writableSnapshot.snapshotDir })
	assert.equal(restored.child.status, 0, JSON.stringify(restored.body))
	assert.equal(restored.body.data.restored, 1)
	assert.equal(readFileSync(source, 'utf8'), 'snapshot-content')
	assertions += 1

	// data/../outside 与相对 original 必须在改动前拒绝。
	for (const kind of ['escape', 'relative-original']) {
		const snapshot = makeSnapshot(`invalid-${kind}`)
		const stored = join(snapshot.data, 'stored.txt')
		const target = join(scratch, `${kind}-target.txt`)
		writeFileSync(stored, 'stored')
		writeFileSync(target, 'keep')
		const outside = join(scratch, `${kind}-outside.txt`)
		writeFileSync(outside, 'outside')
		const entry = kind === 'escape'
			? { original: target, stored: `${snapshot.snapshotDir}/../${kind}-outside.txt` }
			: { original: `${kind}-relative.txt`, stored }
		writeManifest(snapshot, [entry])
		const body = expectPrimitiveError('snapshot-restore', { snapshotDir: snapshot.snapshotDir })
		assert.match(body.error, kind === 'escape' ? /data/ : /original/)
		assert.equal(readFileSync(target, 'utf8'), 'keep')
		assert.equal(readdirSync(snapshot.snapshotDir).some(name => name.startsWith('restore-backup-')), false)
	}

	// 同时兼容以 snapshotDir 为基准的 data/x stored。
	const relativeStored = makeSnapshot('relative-stored-snapshot')
	const relativeTarget = join(scratch, 'relative-stored-target.txt')
	writeFileSync(join(relativeStored.data, 'stored.txt'), 'restored')
	writeFileSync(relativeTarget, 'current')
	writeManifest(relativeStored, [{ original: relativeTarget, stored: 'data/stored.txt' }])
	const relativeResult = invoke('snapshot-restore', { snapshotDir: relativeStored.snapshotDir })
	assert.equal(relativeResult.child.status, 0, JSON.stringify(relativeResult.body))
	assert.equal(readFileSync(relativeTarget, 'utf8'), 'restored')
	assertions += 1

	// 后一条 stored 不可读时，前一条也不能提前恢复。
	const preflight = makeSnapshot('preflight-snapshot')
	const goodStored = join(preflight.data, 'good.txt')
	const preflightTarget = join(scratch, 'preflight-target.txt')
	writeFileSync(goodStored, 'snapshot')
	writeFileSync(preflightTarget, 'current')
	writeManifest(preflight, [
		{ original: preflightTarget, stored: goodStored },
		{ original: join(scratch, 'other-target.txt'), stored: join(preflight.data, 'missing.txt') },
	])
	expectPrimitiveError('snapshot-restore', { snapshotDir: preflight.snapshotDir })
	assert.equal(readFileSync(preflightTarget, 'utf8'), 'current')
	assert.equal(readdirSync(preflight.snapshotDir).some(name => name.startsWith('restore-backup-')), false)
	assertions += 1

	// original == stored 可在预检通过后可靠地制造复制失败：源被删除后复制失败，
	// 当前条目必须从备份还原；后一条仍继续处理，外层如实非 0。
	const partial = makeSnapshot('partial-snapshot')
	const firstStored = join(partial.data, 'first.txt')
	const secondStored = join(partial.data, 'second.txt')
	const secondTarget = join(scratch, 'second-target.txt')
	writeFileSync(firstStored, 'before')
	writeFileSync(secondStored, 'restored')
	writeFileSync(secondTarget, 'current')
	writeManifest(partial, [
		{ original: firstStored, stored: firstStored },
		{ original: secondTarget, stored: secondStored },
	])
	const partialBody = expectPrimitiveError('snapshot-restore', { snapshotDir: partial.snapshotDir })
	assert.match(partialBody.error, /1\/2/)
	assert.match(partialBody.error, /非全事务|逐条/)
	assert.equal(readFileSync(firstStored, 'utf8'), 'before')
	assert.equal(readFileSync(secondTarget, 'utf8'), 'restored')
	assertions += 1

	// 自检允许因环境而失败，但退出码与外层 ok 必须一致，且失败项不能被隐藏。
	const selftest = invoke('selftest')
	assert.equal(selftest.body.ok, selftest.child.status === 0)
	assert.equal(selftest.body.data.ok, selftest.child.status === 0)
	assert.ok(Array.isArray(selftest.body.data.checks))
	assertions += 1

	console.log(`rust-cli test OK (${assertions} groups; engine=${resolve(engine)})`)
} finally {
	rmSync(scratch, { recursive: true, force: true })
}
