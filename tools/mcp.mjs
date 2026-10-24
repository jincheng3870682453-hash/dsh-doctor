// dsh-doctor 的 MCP 面（可选组件）。
//
// 让任何支持 MCP 的 agent（DSH 自己、Claude Code、Codex……）通过受控工具调用医生：
//   doctor_scan      只读体检
//   doctor_history   只读修复录
//   doctor_fix       修复（必须带 confirm: true，否则只返回计划）
//   doctor_rescue    起隔离端口的网页版逃生
//
// 没有任何 shell 通道：工具只接受固定的 fix id。
//
// 用法：node tools/mcp.mjs   （stdio 传输，按行分隔的 JSON-RPC）
import { createInterface } from 'node:readline'
import { scan, readHistory, rescueWeb, applyFixById } from '../plugin/lib/index.js'

const FIX_IDS = ['desktop-label', 'workspace-entry', 'profile-host-dup', 'restore-patch-layer']

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
]

function textResult(data) {
	return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

async function dispatch(method, params) {
	if (method === 'initialize') {
		return {
			protocolVersion: '2024-11-05',
			capabilities: { tools: {} },
			serverInfo: { name: 'dsh-doctor', version: '0.4.1' },
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

