import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixIntegrityLabelOnPath } from '../plugin/lib/index.js'

const scratch = mkdtempSync(join(tmpdir(), 'dsh-doctor-acl-'))
process.env.DSH_HOME = join(scratch, 'home')
const target = join(scratch, 'project')
mkdirSync(target, { recursive: true })
const low = 'D:(A;;FA;;;AU)(D;CIID;DC;;;WD)S:(ML;;NW;;;LW)'
const medium = 'D:(A;;FA;;;AU)S:(ML;;NW;;;ME)'
try {
	function fixture({ save = true, remove = true, restore = true, sticky = false } = {}) {
		let sddl = low
		const calls = []
		return {
			calls,
			system: {
				isWindows: true,
				aclSddl: () => sddl,
				powershell: () => ({ ok: false, out: '', err: 'no powershell in fixture' }),
				doctorSys: (op, args) => {
					calls.push(op)
					if (op === 'acl-save') {
						if (save) writeFileSync(args.file, JSON.stringify({ path: target, sddl }))
						return { ok: save }
					}
					if (op === 'set-integrity-label') { if (!sticky) sddl = sddl.replace('LW', 'ME'); return { ok: true } }
					if (op === 'remove-deny-ace') {
						if (remove) sddl = sddl.replace('(D;CIID;DC;;;WD)', '')
						return { ok: remove }
					}
					if (op === 'acl-restore') { if (restore) sddl = low; return { ok: restore } }
					return { ok: false }
				},
			},
			getSddl: () => sddl,
		}
	}
	const powerShellOnly = {
		isWindows: true,
		aclSddl: () => medium,
		doctorSys: () => null,
		powershell: () => ({ ok: true, out: '', err: '' }),
	}
	assert.equal(fixIntegrityLabelOnPath(target, { system: powerShellOnly }).unchanged, true)

	const success = fixture()
	const fixed = fixIntegrityLabelOnPath(target, { system: success.system })
	assert.equal(fixed.ok, true)
	assert.equal(fixed.verified, true)
	assert.equal(success.getSddl(), medium)

	const noBackup = fixture({ save: false })
	const refused = fixIntegrityLabelOnPath(target, { system: noBackup.system })
	assert.equal(refused.ok, false)
	assert.equal(noBackup.getSddl(), low)
	assert.ok(!noBackup.calls.includes('set-integrity-label'), '备份失败不得修改 ACL')

	const recovered = fixture({ remove: false })
	const failed = fixIntegrityLabelOnPath(target, { system: recovered.system })
	assert.equal(failed.ok, false)
	assert.equal(failed.restored, true)
	assert.equal(recovered.getSddl(), low)
	assert.ok(recovered.calls.includes('acl-restore'))

	const restoreFailed = fixture({ remove: false, restore: false })
	const unrecovered = fixIntegrityLabelOnPath(target, { system: restoreFailed.system })
	assert.equal(unrecovered.restored, false)
	assert.match(unrecovered.message, /人工恢复/)

	const sticky = fixture({ sticky: true })
	const notVerified = fixIntegrityLabelOnPath(target, { system: sticky.system })
	assert.equal(notVerified.ok, false)
	assert.equal(notVerified.restored, true)
	console.log('acl recovery matrix OK (success / no-backup / rollback / rollback-failed / verify-failed)')
} finally {
	delete process.env.DSH_HOME
	rmSync(scratch, { recursive: true, force: true })
}
