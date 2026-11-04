// 体检放在 worker 线程里跑：扫描里有大量 spawnSync（PowerShell/icacls），
// 跑在 host 主线程会把 DSH 界面卡住，所以整包丢进 worker。
import { parentPort } from 'node:worker_threads'
import { scan } from './index.js'

parentPort.on('message', (request) => {
	try {
		const findings = scan()
		parentPort.postMessage({ id: request && request.id, ok: true, findings })
	} catch (error) {
		parentPort.postMessage({ id: request && request.id, ok: false, message: String(error && error.message ? error.message : error) })
	}
})
