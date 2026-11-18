// 一次性：通过 GitHub API 建轻量 tag（本地 git 无法 push 时的备用路径）。
// 用法：GH_TOKEN=... node tools/tag-api.mjs <tag-name> <sha>
const [, , tag, sha] = process.argv
if (!tag || !sha) { console.error('usage: node tools/tag-api.mjs <tag> <sha>'); process.exit(1) }
const token = process.env.GH_TOKEN
if (!token) { console.error('GH_TOKEN is not set'); process.exit(1) }
const body = JSON.stringify({ ref: `refs/tags/${tag}`, sha })
const res = await fetch('https://api.github.com/repos/jincheng3870682453-hash/dsh-doctor/git/refs', {
	method: 'POST',
	headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'push-helper', 'Content-Type': 'application/json', Accept: 'application/vnd.github+json' },
	body,
})
console.log('status', res.status)
console.log((await res.text()).slice(0, 300))
process.exit(res.status === 201 ? 0 : 1)
