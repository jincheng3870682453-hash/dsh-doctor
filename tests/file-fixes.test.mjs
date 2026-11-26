import { strict as assert } from 'node:assert'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyFixById, scan, fixRestorePatchLayer } from '../plugin/lib/index.js'

const scratch = mkdtempSync(join(tmpdir(), 'dsh-doctor-file-fixes-'))
try {
	const home = join(scratch, 'home')
	process.env.DSH_HOME = home
	mkdirSync(join(home, 'storages'), { recursive: true })
	const registry = join(home, 'storages', 'workspace.json')
	writeFileSync(registry, JSON.stringify({
		global: { workspaceIds: ['keep', 'gone'] },
		tables: { workspaces: {
			keep: { path: join(scratch, 'keep'), title: 'keep' },
			gone: { path: join(scratch, 'gone'), title: 'gone' },
		} },
	}))
	const created = await applyFixById('create-workspace-dir')
	assert.equal(created.ok, true)
	assert.ok(existsSync(join(scratch, 'gone')))
	assert.equal((await applyFixById('create-workspace-dir')).unchanged, true)

	writeFileSync(join(home, '.credentials.yaml'), 'version: 1\nrecords:\n  one:\n    grant: old\n  one:\n    grant: new\n')
	assert.equal((await applyFixById('compact-credentials')).ok, true)
	const credentials = readFileSync(join(home, '.credentials.yaml'), 'utf8')
	assert.equal((credentials.match(/grant:/g) || []).length, 1)
	assert.match(credentials, /grant: new/)
	assert.equal((await applyFixById('compact-credentials')).unchanged, true)

	for (const profile of ['one', 'two']) {
		const dir = join(home, 'profiles', profile, 'node_modules', '@deepseek-ai', 'dsh-tools')
		mkdirSync(dir, { recursive: true })
		writeFileSync(join(dir, 'package.json'), '{}')
	}
	const moved = await applyFixById('profile-host-dup')
	assert.equal(moved.ok, true, moved.message)
	assert.equal(moved.verified, true)
	assert.equal(scan().filter(item => item.id === 'profile-host-duplicate').length, 0)
	assert.equal((await applyFixById('profile-host-dup')).unchanged, true)

	const profile = join(home, 'profiles', 'one')
	writeFileSync(join(profile, 'cordis.patch.yml'), '')
	writeFileSync(join(profile, 'cordis.patch.yml.bak-1'), 'name: restored\n')
	assert.equal((await applyFixById('restore-patch-layer')).ok, true)
	assert.equal(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8'), 'name: restored\n')
	assert.equal((await applyFixById('restore-patch-layer')).unchanged, true)

	// 当前项写后复检失败也必须回滚；只在测试中注入复检失败，真实复制仍执行。
	writeFileSync(join(profile, 'cordis.patch.yml'), '')
	writeFileSync(join(profile, 'cordis.patch.yml.bak-1'), 'name: restored\n')
	const failed = await fixRestorePatchLayer({ verify: () => false })
	assert.equal(failed.ok, false)
	assert.equal(failed.restored, true, failed.message)
	assert.equal(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8'), '', '当前项必须恢复为原始空文件，而非只恢复先前成功项')
	console.log('file fixes integration OK (directories / credentials / two-profile isolation / patch / current-item rollback)')
} finally {
	delete process.env.DSH_HOME
	rmSync(scratch, { recursive: true, force: true })
}
