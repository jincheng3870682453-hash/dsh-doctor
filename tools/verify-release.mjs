// 发行验收：结构、版本、引擎同源、实际启动与公开资产哈希。零第三方依赖。
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve, sep, dirname } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
function arg(name, fallback = '') { const index = args.indexOf('--' + name); return index >= 0 ? args[index + 1] : fallback }
if (args.includes('--help')) {
	console.log('node tools/verify-release.mjs --asset all|exe|unix|plugin|env [--root .] [--engine-source path] [--expected-version x.y.z]')
	process.exit(0)
}
const root = resolve(arg('root', fileURLToPath(new URL('..', import.meta.url))))
const out = join(root, 'dist', 'release')
const asset = arg('asset', 'all')
const manifest = JSON.parse(readFileSync(join(root, 'plugin', 'package.json'), 'utf8'))
const version = arg('expected-version', manifest.version)
const engineSource = arg('engine-source') ? resolve(arg('engine-source')) : join(root, 'doctor-sys', 'target', 'release', 'doctor-sys.exe')
const keep = args.includes('--keep')
const checks = []
function assert(condition, message) { if (!condition) throw new Error(message); checks.push(message) }
function pass(message) { checks.push(message) }
function file(dir, name) {
	const path = resolve(dir, ...name.replace(/\\/g, '/').split('/'))
	assert(existsSync(path) && statSync(path).isFile() && statSync(path).size > 0, '非空文件：' + name + '（解包目录：' + dir + '）')
	return path
}
function run(command, argv, options = {}) {
	let result
	try { result = spawnSync(command, argv, { encoding: 'utf8', timeout: 60000, ...options }) }
	catch (error) { throw new Error('无法启动验收命令：' + command + '（' + error.message + '）') }
	assert(result.status === 0, '命令成功：' + command + ' ' + argv.join(' ') + (result.error ? '（' + result.error.message + '）' : '') + (result.status !== 0 ? '：' + String(result.stderr || result.stdout).slice(-1000) : ''))
	return result.stdout
}
function zipEntries(archive) {
	const buffer = readFileSync(archive)
	let eocd = -1
	for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65557); index -= 1) {
		if (buffer.readUInt32LE(index) === 0x06054b50) { eocd = index; break }
	}
	assert(eocd >= 0, 'ZIP 有中央目录')
	const count = buffer.readUInt16LE(eocd + 10)
	let offset = buffer.readUInt32LE(eocd + 16)
	const entries = []
	for (let index = 0; index < count; index += 1) {
		assert(buffer.readUInt32LE(offset) === 0x02014b50, 'ZIP 中央目录条目合法')
		const method = buffer.readUInt16LE(offset + 10)
		const expectedSize = buffer.readUInt32LE(offset + 24)
		const compressedSize = buffer.readUInt32LE(offset + 20)
		const expectedCrc = buffer.readUInt32LE(offset + 16)
		const nameLength = buffer.readUInt16LE(offset + 28)
		const extraLength = buffer.readUInt16LE(offset + 30)
		const commentLength = buffer.readUInt16LE(offset + 32)
		const localOffset = buffer.readUInt32LE(offset + 42)
		const rawName = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
		assert(!rawName.includes('\0'), 'ZIP 名称没有 NUL')
		const name = rawName.replace(/\\/g, '/')
		assert(!name.startsWith('/') && !/^[A-Za-z]:/.test(name) && name.split('/').every(part => part !== '..'), 'ZIP 路径安全：' + rawName)
		assert(buffer.readUInt32LE(localOffset) === 0x04034b50, 'ZIP 本地头合法：' + name)
		const localNameLength = buffer.readUInt16LE(localOffset + 26)
		const localExtraLength = buffer.readUInt16LE(localOffset + 28)
		const dataOffset = localOffset + 30 + localNameLength + localExtraLength
		const data = buffer.subarray(dataOffset, dataOffset + compressedSize)
		const content = method === 0 ? data : method === 8 ? inflateRawSync(data) : null
		assert(content !== null && content.length === expectedSize, 'ZIP 内容解压与长度正确：' + name)
		let crc = 0xffffffff
		for (const byte of content) {
			crc ^= byte
			for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
		}
		assert((crc ^ 0xffffffff) >>> 0 === expectedCrc, 'ZIP CRC 正确：' + name)
		entries.push({ name, content })
		offset += 46 + nameLength + extraLength + commentLength
	}
	return entries
}
function extract(archive, destination) {
	mkdirSync(destination, { recursive: true })
	if (archive.endsWith('.zip')) {
		for (const entry of zipEntries(archive)) {
			if (entry.name.endsWith('/')) continue
			const target = resolve(destination, ...entry.name.split('/'))
			assert(target.startsWith(resolve(destination) + sep), 'ZIP 不能越出解包目录')
			mkdirSync(dirname(target), { recursive: true })
			writeFileSync(target, entry.content)
		}
		return
	}
	const entries = run('tar', ['-tzf', archive]).split(/\r?\n/).filter(Boolean)
	for (const entry of entries) {
		assert(!entry.startsWith('/') && !/^[A-Za-z]:/.test(entry) && entry.split('/').every(part => part !== '..'), 'tar 路径安全：' + entry)
	}
	run('tar', ['-xzf', archive, '-C', destination])
}
function expectedEngine(extracted, engineEntry = 'bin/doctor-sys.exe') {
	assert(existsSync(engineSource) && statSync(engineSource).size > 0, '用于比对的引擎必须存在且非空')
	const actual = file(extracted, engineEntry)
	assert(readFileSync(actual).equals(readFileSync(engineSource)), '引擎与指定构建产物逐字一致')
}
function checkNodePackage(dir) {
	const pkg = JSON.parse(readFileSync(file(dir, 'plugin/package.json'), 'utf8'))
	assert(pkg.version === version && pkg.name === manifest.name, 'Node 包版本与名称正确')
	file(dir, 'plugin/lib/index.mjs')
	file(dir, 'plugin/lib/scan-worker.mjs')
	const worker = file(dir, 'plugin/lib/pack-regex-worker.mjs')
	checkPackRegexWorker(worker)
	const cli = file(dir, 'dsh-doctor.mjs')
	const home = mkdtempSync(join(scratchRoot, 'release-home-'))
	try {
		const result = run(process.execPath, [cli, 'version'], { env: { ...process.env, DSH_HOME: home } }).trim()
		assert(result === version, '解包 CLI 实际返回正确版本：' + result)
	} finally { rmSync(home, { recursive: true, force: true }) }
}
/** 发行包里必须真能跑起检查包正则 worker：漏文件时 matchPackRegex 会静默返回 false。 */
function checkPackRegexWorker(worker) {
	const script = [
		'import { Worker } from "node:worker_threads"',
		'const state = new Int32Array(new SharedArrayBuffer(2 * Int32Array.BYTES_PER_ELEMENT))',
		'const worker = new Worker(process.argv[1], { workerData: { state, id: 1, pattern: "^dsh-", text: "dsh-doctor" }, execArgv: [] })',
		'const status = Atomics.wait(state, 0, 0, 3000)',
		'worker.terminate()',
		'if (status !== "ok" || Atomics.load(state, 0) !== 1 || Atomics.load(state, 1) !== 1) { console.error("pack regex worker did not answer"); process.exit(1) }',
	].join('\n')
	run(process.execPath, ['--input-type=module', '-e', script, worker])
	pass('检查包正则 worker 可执行：' + worker)
}
const scratchRoot = join(root, '.dsh-test-tmp')
mkdirSync(scratchRoot, { recursive: true })
const work = mkdtempSync(join(scratchRoot, 'release-verify-'))
try {
	for (const kind of asset === 'all' ? ['exe', 'unix', 'plugin', 'env'] : [asset]) {
		if (kind === 'exe') {
			const exe = file(out, 'dsh-doctor.exe')
			assert(readFileSync(exe).subarray(0, 2).toString() === 'MZ', 'Windows EXE 是 PE 文件')
			if (process.platform === 'win32') {
				const home = join(work, 'exe-home')
				mkdirSync(home, { recursive: true })
				assert(run(exe, ['version'], { env: { ...process.env, DSH_HOME: home } }).trim() === version, '急救 EXE 实际返回正确版本')
			}
		} else if (kind === 'unix') {
			const archive = file(out, 'dsh-doctor-unix.tar.gz')
			const dir = join(work, 'unix')
			extract(archive, dir)
			checkNodePackage(dir)
			file(dir, 'dsh-doctor.sh')
			file(dir, 'dsh-doctor.command')
		} else if (kind === 'plugin') {
			const dir = join(work, 'plugin')
			extract(file(out, 'dsh-doctor-plugin.zip'), dir)
			const pkg = JSON.parse(readFileSync(file(dir, 'package.json'), 'utf8'))
			assert(pkg.version === version && pkg.name === manifest.name, '插件 zip 版本与名称正确')
			for (const name of ['cordis.patch.yml', 'lib/index.js', 'lib/client.js', 'lib/scan-worker.mjs', 'lib/pack-regex-worker.mjs', 'locale/zh.json', 'locale/en.json', 'icon.svg']) file(dir, name)
			expectedEngine(dir, 'bin/doctor-sys.exe')
			checkPackRegexWorker(file(dir, 'lib/pack-regex-worker.mjs'))
			assert(run(process.execPath, ['--check', join(dir, 'lib', 'index.js')]).length >= 0, '插件宿主语法有效')
		} else if (kind === 'env') {
			const dir = join(work, 'env')
			extract(file(out, 'dsh-doctor-env-win-x64.zip'), dir)
			checkNodePackage(dir)
			file(dir, 'start.cmd')
			file(dir, 'node.exe')
			expectedEngine(dir, 'plugin/bin/doctor-sys.exe')
		} else throw new Error('未知资产：' + kind)
	}
	const publicAssets = ['dsh-doctor.exe', 'dsh-doctor-unix.tar.gz', 'dsh-doctor-env-win-x64.zip']
	const lines = ['# SHA-256 · 仅用于完整性校验，不是签名', '']
	for (const name of publicAssets) {
		const path = join(out, name)
		if (!existsSync(path)) {
			assert(asset !== 'all', '公开资产存在：' + name)
			continue
		}
		const hash = createHash('sha256').update(readFileSync(path)).digest('hex')
		lines.push(hash + '  ' + name)
	}
	if (asset === 'all') {
		writeFileSync(join(out, 'SHA256SUMS.txt'), lines.join('\n') + '\n')
		assert(lines.length === 5, '三个公开资产均生成 SHA-256')
	}
	console.log('RELEASE_OK ' + asset + ' · ' + checks.length + ' 项检查通过')
} finally { if (!keep) rmSync(work, { recursive: true, force: true }); else console.log('验收解包目录保留：' + work) }
