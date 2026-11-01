// Push the current HEAD tree to GitHub over the REST API.
// Used when github.com:443 is unreachable (git push fails) but api.github.com works.
// Requires GH_TOKEN in the environment.
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const token = process.env.GH_TOKEN
if (!token) {
	console.error('GH_TOKEN is not set')
	process.exit(1)
}
const owner = process.argv[2] || 'jincheng3870682453-hash'
const repo = process.argv[3] || 'dsh-doctor'
const root = resolve(process.argv[4] || '.')
const api = 'https://api.github.com'

async function request(path, options = {}) {
	const response = await fetch(api + path, {
		...options,
		headers: {
			authorization: 'Bearer ' + token,
			accept: 'application/vnd.github+json',
			'user-agent': 'dsh-doctor-push',
			...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
			...(options.headers || {}),
		},
	})
	const text = await response.text()
	let data = null
	try { data = text.length > 0 ? JSON.parse(text) : null } catch (error) { data = null }
	return { ok: response.ok, status: response.status, data, text }
}

async function main() {
	const listing = execSync('git ls-tree -r HEAD', { cwd: root, encoding: 'utf8' })
	const entries = []
	for (const line of listing.split(/\r?\n/)) {
		const match = /^(\d+)\s+blob\s+[0-9a-f]+\t(.+)$/.exec(line)
		if (match === null) continue
		const mode = match[1] === '100755' ? '100755' : '100644'
		const path = match[2]
		const content = readFileSync(resolve(root, path)).toString('base64')
		entries.push({ mode, path, content })
	}
	console.log('files: ' + entries.length)

	const refProbe = await request(`/repos/${owner}/${repo}/git/ref/heads/main`)
	if (!refProbe.ok) {
		console.log('bootstrap: creating the default branch')
		const readme = readFileSync(resolve(root, 'README.md')).toString('base64')
		const boot = await request(`/repos/${owner}/${repo}/contents/README.md`, {
			method: 'PUT',
			body: JSON.stringify({ message: 'chore: initialize repository', content: readme }),
		})
		if (!boot.ok) throw new Error('bootstrap failed: ' + boot.status + ' ' + boot.text.slice(0, 300))
	}

	const tree = []
	for (const entry of entries) {
		const blob = await request(`/repos/${owner}/${repo}/git/blobs`, {
			method: 'POST',
			body: JSON.stringify({ content: entry.content, encoding: 'base64' }),
		})
		if (!blob.ok) throw new Error('blob failed for ' + entry.path + ': ' + blob.status + ' ' + blob.text.slice(0, 200))
		tree.push({ path: entry.path, mode: entry.mode, type: 'blob', sha: blob.data.sha })
		console.log('  blob ' + blob.data.sha.slice(0, 7) + '  ' + entry.path)
	}

	const treeResult = await request(`/repos/${owner}/${repo}/git/trees`, {
		method: 'POST',
		body: JSON.stringify({ tree }),
	})
	if (!treeResult.ok) throw new Error('tree failed: ' + treeResult.status + ' ' + treeResult.text.slice(0, 300))
	console.log('tree ' + treeResult.data.sha)

	const message = execSync('git log -1 --pretty=%s', { cwd: root, encoding: 'utf8' }).trim()
	const commitResult = await request(`/repos/${owner}/${repo}/git/commits`, {
		method: 'POST',
		body: JSON.stringify({ message, tree: treeResult.data.sha }),
	})
	if (!commitResult.ok) throw new Error('commit failed: ' + commitResult.status + ' ' + commitResult.text.slice(0, 300))
	console.log('commit ' + commitResult.data.sha)

	const refResult = await request(`/repos/${owner}/${repo}/git/refs/heads/main`, {
		method: 'PATCH',
		body: JSON.stringify({ sha: commitResult.data.sha, force: true }),
	})
	if (!refResult.ok) throw new Error('ref failed: ' + refResult.status + ' ' + refResult.text.slice(0, 300))
	console.log('ref ' + refResult.data.ref)
	console.log('PUSH_OK https://github.com/' + owner + '/' + repo)
}

main().catch((error) => {
	console.error('FAILED: ' + (error && error.message ? error.message : error))
	process.exit(1)
})
