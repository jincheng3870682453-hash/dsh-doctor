// 对比两份 app.asar 快照：依赖新增/移除/版本变化、client 包集合变化。
import { readFileSync } from 'node:fs'

const [fileA, fileB] = process.argv.slice(2)
const a = JSON.parse(readFileSync(fileA, 'utf8'))
const b = JSON.parse(readFileSync(fileB, 'utf8'))

const depsA = a.deps ?? {}
const depsB = b.deps ?? {}
const added = Object.keys(depsB).filter(name => !(name in depsA))
const removed = Object.keys(depsA).filter(name => !(name in depsB))
const changed = Object.keys(depsB)
	.filter(name => name in depsA && depsA[name] !== depsB[name])
	.map(name => ({ name, from: depsA[name], to: depsB[name] }))

const clientA = new Set(a.clientPackages ?? [])
const clientB = new Set(b.clientPackages ?? [])
const clientAdded = [...clientB].filter(name => !clientA.has(name))
const clientRemoved = [...clientA].filter(name => !clientB.has(name))

console.log(JSON.stringify({
	from: { version: a.appVersion, commit: a.buildCommit },
	to: { version: b.appVersion, commit: b.buildCommit },
	counts: {
		deps: [Object.keys(depsA).length, Object.keys(depsB).length],
		packages: [a.dshPackages.length, b.dshPackages.length],
		client: [clientA.size, clientB.size],
	},
	added,
	removed,
	changedCount: changed.length,
	changedSample: changed.slice(0, 30),
	clientAdded,
	clientRemoved,
}, null, 2))
