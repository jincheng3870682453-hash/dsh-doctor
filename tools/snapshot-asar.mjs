// 给一份解包后的 app.asar 拍快照：依赖版本 + @deepseek-ai 包目录 + client 插件清单。
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2]
const out = process.argv[3]
const dshDir = join(root, 'dsh')
const pkg = JSON.parse(readFileSync(join(dshDir, 'package.json'), 'utf8'))
const deps = pkg.dependencies ?? {}

const dshPackages = []
const modulesDir = join(dshDir, 'node_modules', '@deepseek-ai')
try {
	for (const name of readdirSync(modulesDir)) {
		const packageFile = join(modulesDir, name, 'package.json')
		if (!existsSync(packageFile)) continue
		try {
			const meta = JSON.parse(readFileSync(packageFile, 'utf8'))
			dshPackages.push({ name: '@deepseek-ai/' + name, version: meta.version ?? null, client: meta.dsh?.client !== undefined })
		} catch {}
	}
} catch {}

const snapshot = {
	root,
	appVersion: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
	buildCommit: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dshBuildCommit ?? null,
	deps,
	dshPackages,
	clientPackages: dshPackages.filter(item => item.client).map(item => item.name).sort(),
}
writeFileSync(out, JSON.stringify(snapshot, null, 2))
console.log(out, 'deps=' + Object.keys(deps).length, 'packages=' + dshPackages.length, 'client=' + snapshot.clientPackages.length)
