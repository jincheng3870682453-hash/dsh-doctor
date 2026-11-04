// 自检：worker 线程能不能加载并跑完一次扫描。
import { Worker } from 'node:worker_threads'
const worker = new Worker(new URL('../plugin/lib/scan-worker.mjs', import.meta.url))
worker.on('message', (message) => {
	console.log('worker ok=' + message.ok + ' findings=' + (Array.isArray(message.findings) ? message.findings.length : 'n/a'))
	worker.terminate()
})
worker.on('error', (error) => {
	console.log('worker error: ' + String(error && error.message ? error.message : error))
	worker.terminate()
})
worker.postMessage({ id: 1 })
setTimeout(() => {
	console.log('timeout (worker did not answer in 40s)')
	worker.terminate()
}, 40000)
