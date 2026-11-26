// 体检放在 worker 线程里跑：扫描里有大量 spawnSync（PowerShell/icacls），
// 跑在 host 主线程会把 DSH 界面卡住，所以整包丢进 worker。
import { parentPort } from 'node:worker_threads'
// 发行包里宿主是 index.mjs；兼容 npm/开发目录的 index.js。
import { existsSync } from 'node:fs'
const host = new URL(existsSync(new URL('./index.mjs', import.meta.url)) ? './index.mjs' : './index.js', import.meta.url)
const { scan } = await import(host)

parentPort.on('message', (request) => {
	try {
		const findings = scan()
		parentPort.postMessage({ id: request && request.id, ok: true, findings })
	} catch (error) {
		parentPort.postMessage({ id: request && request.id, ok: false, message: String(error && error.message ? error.message : error) })
	}
})
