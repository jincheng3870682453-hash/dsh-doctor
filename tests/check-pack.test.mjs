import { strict as assert } from 'node:assert'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateCheckPack, loadCheckPacks, applyFixById, matchPackRegex } from '../plugin/lib/index.js'

const base = () => ({
	protocolVersion: 1, id: 'test-pack', title: 'test',
	checks: [{ id: 'test:item', title: 'item', severity: 'medium', detect: { type: 'workspace-risky-path' } }],
})
for (const [name, mutate] of [
	['protocol version', pack => { pack.protocolVersion = 2 }],
	['severity', pack => { pack.checks[0].severity = 'urgent' }],
	['fix allowlist', pack => { pack.checks[0].fix = { type: 'exec' } }],
	['prototype detector', pack => { pack.checks[0].detect.type = 'constructor' }],
	['nested quantifier', pack => { pack.checks[0].detect = { type: 'file-regex', path: '{{profiles}}', pattern: '(a+)+$', maxFiles: 10 } }],
	['missing maxFiles', pack => { pack.checks[0].detect = { type: 'file-regex', path: '{{profiles}}', pattern: 'safe', maxFiles: 0 } }],
	['relative path', pack => { pack.checks[0].detect = { type: 'dir-contains', path: 'relative/path', names: ['x'] } }],
]) {
	const pack = base()
	mutate(pack)
	assert.throws(() => validateCheckPack(pack), undefined, name)
}
assert.deepEqual(validateCheckPack(base()).id, 'test-pack')
assert.equal(matchPackRegex('safe', 'safe text'), true)
assert.equal(matchPackRegex('missing', 'safe text'), false)
const overlappingStarted = Date.now()
assert.equal(matchPackRegex('(a|a*)+$', 'a'.repeat(50000) + 'b'), false)
assert.ok(Date.now() - overlappingStarted < 10000, '重叠分支必须在 worker 超时后被终止')
console.log('bounded regex OK (match / miss / overlapping-branch timeout)')
const scratch = mkdtempSync(join(tmpdir(), 'dsh-doctor-pack-'))
try {
	process.env.DSH_HOME = join(scratch, 'home')
	const dir = join(process.env.DSH_HOME, 'dsh-doctor', 'checks')
	mkdirSync(dir, { recursive: true })
	writeFileSync(join(dir, 'bad.json'), JSON.stringify({ ...base(), protocolVersion: 2 }))
	const findings = loadCheckPacks()
	assert.equal(findings.length, 1)
	assert.equal(findings[0].id, 'pack-error:bad')
	assert.equal(findings[0].fixId, null)
	assert.equal(applyFixById('__proto__').ok, false)
	assert.equal(applyFixById('constructor').ok, false)
	console.log('check-pack validation OK (7 invalid cases + valid case + runtime isolation)')
} finally {
	delete process.env.DSH_HOME
	rmSync(scratch, { recursive: true, force: true })
}
