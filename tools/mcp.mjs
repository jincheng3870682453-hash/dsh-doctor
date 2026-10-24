// dsh-doctor 的 MCP 面（可选组件）。
//
// 让任何支持 MCP 的 agent（DSH 自己、Claude Code、Codex……）通过受控工具调用医生：
//   doctor_scan       只读体检
//   doctor_history    只读修复录
//   doctor_fix        修复（必须带 confirm: true，否则只返回计划）
//   doctor_rescue     起隔离端口的网页版逃生
//   doctor_sys_list   列出 doctor-sys 引擎原语表（只读/写分类）
//   doctor_sys        调引擎原语；读原语直通，写原语必须两段式：
//                     第一次调用返回 dryRun 计划 + 一次性 token，
//                     带 confirm: <token> 重复同样调用才真正执行。
//
// 没有任何 shell 通道：工具只接受固定的 fix id 和封闭的原语表。
//
// 用法：node tools/mcp.mjs   （stdio 传输，按行分隔的 JSON-RPC）
import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'

import { scan, readHistory, rescueWeb, applyFixById } from '../plugin/lib/index.js'

const require = createRequire(import.meta.url)
const { version: PLUGIN_VERSION } = require('../plugin/package.json')

const FIX_IDS = ['desktop-label', 'workspace-entry', 'profile-host-dup', 'restore-patch-layer']

/** 引擎原语表（封闭白名单，与 doctor-sys/README.md 一致）。 */
const SYS_READ_OPS = ['acl-read', 'proc-list', 'port-probe', 'port-pid', 'selftest', 'version']
const SYS_WRITE_OPS = [
	'acl-save', 'acl-restore', 'set-integrity-label', 'remove-deny-ace', 'shell-refresh',
	'quarantine-dir', 'snapshot-write', 'snapshot-restore', 'proc-kill-tree', 'notify',
]

/** 引擎定位：DSH_DOCTOR_SYS 优先，其次仓库构建产物。 */
function engineExePath() {
	const candidates = [
		process.env.DSH_DOCTOR_SYS,
		fileURLToPath(new URL('../doctor-sys/target/release/doctor-sys.exe', import.meta.url)),
		fileURLToPath(new URL('../dist/release/doctor-sys.exe', import.meta.url)),
	].filter((item) => typeof item === 'string' && item.length > 0)
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate
	}
	return null
}

/** 调引擎原语（CLI 形式，一行 JSON 应答）；起不来返回 ok:false 的说明对象。 */
function callEngine(op, args = {}, timeout = 30000) {
	const exe = engineExePath()
	if (exe === null) {
		return { ok: false, error: '找不到 doctor-sys.exe：设 DSH_DOCTOR_SYS，或先 cargo build / 从 Release 下载放到 dist/release/。' }
	}
	const cli = [op]
	for (const [key, value] of Object.entries(args)) {
		if (value === true) cli.push('--' + key)
		else if (value !== false && value !== null && value !== undefined) cli.push('--' + key, String(value))
	}
	try {
		const run = spawnSync(exe, cli, { windowsHide: true, encoding: 'utf8', timeout })
		if (run.error) return { ok: false, error: '引擎起不来：' + String(run.error.message || run.error) }
		if (typeof run.stdout !== 'string') return { ok: false, error: '引擎没有输出' }
		const parsed = JSON.parse(run.stdout.split(/\r?\n/, 1)[0])
		return typeof parsed === 'object' && parsed !== null ? parsed : { ok: false, error: '引擎应答不是对象' }
	} catch (error) {
		return { ok: false, error: '调引擎失败：' + String(error && error.message ? error.message : error) }
	}
}

/** 写原语的两段式确认：token -> {op, args, expires}，单次有效，5 分钟过期。 */
const pendingConfirms = new Map()
const CONFIRM_TTL_MS = 5 * 60 * 1000

function sameCall(stored, op, args) {
	return stored.op === op && JSON.stringify(stored.args) === JSON.stringify(args)
}

const TOOLS = [
	{
		name: 'doctor_scan',
		description: '只读体检：桌面 ACL、工作区注册、profile 宿主包、会话、credentials、patch 层、PATH。',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	},
	{
		name: 'doctor_history',
		description: '只读：最近的修复记录（时间、动作、结果、备份路径）。',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	},
	{
		name: 'doctor_fix',
		description: '执行一个修复。不传 confirm=true 时只返回可用动作清单，不修改任何东西。',
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string', enum: FIX_IDS },
				confirm: { type: 'boolean' },
			},
			required: ['id'],
			additionalProperties: false,
		},
	},
	{
		name: 'doctor_rescue',
		description: '启动隔离端口的 DSH 网页版并打开浏览器，用于桌面端瘫痪时逃生。',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	},
	{
		name: 'doctor_sys_list',
		description: '列出 doctor-sys 引擎原语表（哪些只读、哪些要两段式确认）以及引擎是否可用。',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	},
	{
		name: 'doctor_sys',
		description: '调用 doctor-sys 引擎原语。读原语（acl-read / proc-list / port-probe / port-pid / selftest）'
			+ '直接执行；写原语（ACL 修改、隔离、快照、杀树、通知、外壳刷新）第一次调用返回 dryRun 计划和一次性 token，'
			+ '必须带 confirm: <token> 重复同样调用才执行。没有 shell 通道，原语表是封闭的。',
		inputSchema: {
			type: 'object',
			properties: {
				op: { type: 'string', enum: [...SYS_READ_OPS, ...SYS_WRITE_OPS] },
				args: {
					type: 'object',
					description: '原语参数（如 {path, label}），见 doctor-sys/README.md 的原语表。',
					additionalProperties: true,
				},
				confirm: { type: 'string', description: '写原语的执行凭证：上一次 dryRun 应答里的 token。' },
			},
			required: ['op'],
			additionalProperties: false,
		},
	},
]

function textResult(data) {
	return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

function callDoctorSys(args) {
	const op = args.op
	const opArgs = (args.args && typeof args.args === 'object') ? args.args : {}
	const isRead = SYS_READ_OPS.includes(op)
	const isWrite = SYS_WRITE_OPS.includes(op)
	if (!isRead && !isWrite) {
		return { ok: false, message: '未知原语', available: { readOnly: SYS_READ_OPS, write: SYS_WRITE_OPS } }
	}
	if (isRead) return callEngine(op, opArgs)

	// 写原语：两段式。先清过期 token。
	const now = Date.now()
	for (const [key, value] of pendingConfirms) {
		if (value.expires < now) pendingConfirms.delete(key)
	}
	const confirm = args.confirm
	if (typeof confirm === 'string' && pendingConfirms.has(confirm)) {
		const stored = pendingConfirms.get(confirm)
		if (!sameCall(stored, op, opArgs)) {
			pendingConfirms.delete(confirm)
			return { ok: false, message: 'token 对不上这次调用（op/args 必须与 dryRun 完全一致）。已作废，重新走一次 dryRun。' }
		}
		pendingConfirms.delete(confirm)
		return callEngine(op, opArgs)
	}
	const token = randomBytes(8).toString('hex')
	pendingConfirms.set(token, { op, args: opArgs, expires: now + CONFIRM_TTL_MS })
	return {
		ok: true,
		dryRun: true,
		message: '写原语未执行。确认后带 confirm: <token> 重复同样的调用（5 分钟内有效，一次性）。',
		plan: { op, args: opArgs, note: '该原语会改动系统状态；引擎层有自己的备份/复检约定，见 doctor-sys/README.md。' },
		token,
	}
}

async function dispatch(method, params) {
	if (method === 'initialize') {
		return {
			protocolVersion: '2024-11-05',
			capabilities: { tools: {} },
			serverInfo: { name: 'dsh-doctor', version: PLUGIN_VERSION },
		}
	}
	if (method === 'ping') return {}
	if (method === 'tools/list') return { tools: TOOLS }
	if (method === 'tools/call') {
		const name = params && params.name
		const args = (params && params.arguments) || {}
		if (name === 'doctor_scan') return textResult({ ok: true, findings: scan() })
		if (name === 'doctor_history') return textResult({ ok: true, entries: readHistory(50) })
		if (name === 'doctor_rescue') return textResult(await rescueWeb())
		if (name === 'doctor_sys_list') {
			return textResult({
				ok: true,
				engine: engineExePath(),
				readOnly: SYS_READ_OPS,
				write: SYS_WRITE_OPS,
				note: '写原语走两段式确认：先 dryRun 拿 token，再带 confirm 重复同样调用。',
			})
		}
		if (name === 'doctor_sys') return textResult(callDoctorSys(args))
		if (name === 'doctor_fix') {
			if (typeof args.id !== 'string' || !FIX_IDS.includes(args.id)) {
				return textResult({ ok: false, message: '未知的修复项', available: FIX_IDS })
			}
			if (args.confirm !== true) {
				return textResult({
					ok: true,
					dryRun: true,
					message: '未执行。确认后带 confirm: true 再调用。',
					plan: { id: args.id, note: '该修复会先备份再修改，可回滚。' },
				})
			}
			return textResult(await applyFixById(args.id))
		}
		throw new Error('unknown tool: ' + String(name))
	}
	throw new Error('unknown method: ' + String(method))
}

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
	const trimmed = line.trim()
	if (trimmed.length === 0) return
	let request = null
	try { request = JSON.parse(trimmed) } catch (error) { return }
	if (request === null || typeof request !== 'object' || request.id === undefined) return
	const respond = (payload) => process.stdout.write(JSON.stringify(payload) + '\n')
	dispatch(request.method, request.params || {}).then((result) => {
		respond({ jsonrpc: '2.0', id: request.id, result })
	}, (error) => {
		respond({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: String(error && error.message ? error.message : error) } })
	})
})
