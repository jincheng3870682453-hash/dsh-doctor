// 找出 session_projcache.json 里 permissions 对象的路径与结构。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const file = join(process.env.USERPROFILE, '.dsh', 'storages', 'session_projcache.json')
const cache = JSON.parse(readFileSync(file, 'utf8'))
const seen = new WeakSet()
const hits = []
function walk(node, path) {
	if (node === null || typeof node !== 'object' || seen.has(node)) return
	seen.add(node)
	if (typeof node.preset === 'string' && (typeof node.sandbox === 'string' || typeof node.approval === 'string')) {
		hits.push({ path, value: node })
		return
	}
	for (const [key, value] of Object.entries(node)) walk(value, path + (path ? '.' : '') + key)
}
walk(cache, '')
console.log('hits:', hits.length)
for (const hit of hits.slice(0, 5)) console.log(hit.path, '=>', JSON.stringify(hit.value))
console.log('root keys:', Object.keys(cache))
if (cache.tables) console.log('table keys:', Object.keys(cache.tables))
