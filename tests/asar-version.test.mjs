/**
 * readAsarJson 的自检：asar 头不是「文件开头就是 JSON」，
 * 数据区从 16 + 对齐后的 JSON 长度开始，错一个字节就读到隔壁文件的内容。
 * 这里手工拼一个最小 asar（JSON 长度故意不对齐），确保偏移算对。
 */
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readAsarJson } from '../plugin/lib/index.js'

const dir = mkdtempSync(join(tmpdir(), 'dsh-doctor-asar-'))
let failed = 0

function check(name, condition) {
	if (condition) {
		console.log('ok:', name)
		return
	}
	failed += 1
	console.log('FAIL:', name)
}

/** 拼一个只含 package.json 的 asar。 */
function buildAsar(entryName, payload) {
	let json = JSON.stringify({ files: { [entryName]: { size: Buffer.byteLength(payload), offset: '0' } } })
	// 故意让 JSON 长度不是 4 的倍数，逼出对齐逻辑。
	if (json.length % 4 === 0) json += ' '
	const jsonBuffer = Buffer.from(json, 'utf8')
	const dataOffset = 16 + Math.ceil(jsonBuffer.length / 4) * 4
	const body = Buffer.from(payload, 'utf8')

	const head = Buffer.alloc(16)
	head.writeUInt32LE(4, 0)
	head.writeUInt32LE(jsonBuffer.length + 4, 4)
	head.writeUInt32LE(jsonBuffer.length, 8)
	head.writeUInt32LE(jsonBuffer.length, 12)

	const padding = Buffer.alloc(dataOffset - 16 - jsonBuffer.length)
	return Buffer.concat([head, jsonBuffer, padding, body])
}

const manifest = JSON.stringify({ name: '@deepseek-ai/dsh-desktop', version: '0.2.2-rc.5' })
const asarPath = join(dir, 'app.asar')
writeFileSync(asarPath, buildAsar('package.json', manifest))

const parsed = readAsarJson(asarPath, 'package.json')
check('读到 package.json', parsed !== null)
check('版本正确', parsed !== null && parsed.version === '0.2.2-rc.5')
check('包名正确', parsed !== null && parsed.name === '@deepseek-ai/dsh-desktop')

check('条目不存在返回 null', readAsarJson(asarPath, 'nope.json') === null)
check('文件不存在返回 null', readAsarJson(join(dir, 'missing.asar'), 'package.json') === null)

// 头损坏：把 JSON 长度写成天文数字，不能抛异常，只能返回 null。
const broken = Buffer.from(buildAsar('package.json', manifest))
broken.writeUInt32LE(0x7fffffff, 12)
const brokenPath = join(dir, 'broken.asar')
writeFileSync(brokenPath, broken)
check('头损坏返回 null', readAsarJson(brokenPath, 'package.json') === null)

// 右边对齐：JSON 长度正好是 4 的倍数时，数据区不能多跳 4 字节。
const alignedPayload = JSON.stringify({ version: '0.2.2-rc.4' })
let alignedJson = JSON.stringify({ files: { 'package.json': { size: Buffer.byteLength(alignedPayload), offset: '0' } } })
while (alignedJson.length % 4 !== 0) alignedJson += ' '
const alignedBuffer = Buffer.from(alignedJson, 'utf8')
const alignedOffset = 16 + alignedJson.length
const alignedHead = Buffer.alloc(16)
alignedHead.writeUInt32LE(4, 0)
alignedHead.writeUInt32LE(alignedJson.length + 4, 4)
alignedHead.writeUInt32LE(alignedJson.length, 8)
alignedHead.writeUInt32LE(alignedJson.length, 12)
const alignedPath = join(dir, 'aligned.asar')
writeFileSync(alignedPath, Buffer.concat([alignedHead, alignedBuffer, Buffer.from(alignedPayload, 'utf8')]))
const alignedParsed = readAsarJson(alignedPath, 'package.json')
check('JSON 长度对齐时也能读', alignedParsed !== null && alignedParsed.version === '0.2.2-rc.4')
check('对齐偏移正确', alignedOffset === 16 + Math.ceil(alignedJson.length / 4) * 4)

rmSync(dir, { recursive: true, force: true })
process.exit(failed === 0 ? 0 : 1)
