// 只执行引擎校验过的社区正则；由调用方在超时后 terminate()。
import { workerData } from 'node:worker_threads'
let match = false
try { match = new RegExp(workerData.pattern).test(workerData.text) } catch (error) { /* 非法表达式按未命中处理 */ }
const state = workerData.state
Atomics.store(state, 1, match ? 1 : 0)
Atomics.store(state, 0, 1)
Atomics.notify(state, 0)
