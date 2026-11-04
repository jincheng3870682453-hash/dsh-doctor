// Low 完整性标签判据的真相表：生产形态、引擎/沙箱写入形态、继承形态、否定形态。
// 这张表来自实机抓到的 SDDL——v0.12.0 开发时一个"容忍版"正则把经典形态改漏检了，
// 端到端测试才暴露出来；从此判据只许改这里 + 过这张表。
import { strict as assert } from 'node:assert'

const engine = await import('../plugin/lib/index.js')
const pattern = engine.LOW_LABEL_PATTERN

const cases = [
	['O:SYD:AI(A;OICI;FA;;;SY)S:(ML;;NW;;;LW)', true, '经典直写（DSH 生产形态）'],
	['O:SYD:AI(A;OICI;FA;;;SY)S:AI(ML;;NW;;;LW)', true, 'AI 控制位（SetNamedSecurityInfoW 读回形态）'],
	['S:AI(ML;ID;NW;;;LW)', true, '继承标志 ID（沙箱写出的文件）'],
	['S:(ML;CIOI;NW;;;LW)', true, '递归标志 CIOI（icacls (OI)(CI) / 引擎 recursive）'],
	['S:(ML;CIOI;NWNR;;;LW)', true, 'CIOI + NWNR'],
	['S:(ML;CIOI;NW;;;ME)', false, 'Medium 不算 low'],
	['S:(ML;;NW;;;HI)', false, 'High 不算 low'],
	['O:SYD:AI(A;OICI;FA;;;BA)', false, '没有 S: 段'],
	['', false, '空串（读失败时由调用方 fail-closed，不该由判据背锅）'],
]

for (const [sddl, want, name] of cases) {
	const got = pattern.test(sddl)
	assert.strictEqual(got, want, name + ' 判错了：' + sddl)
	console.log((got === want ? 'PASS' : 'FAIL') + ' ' + name)
}

console.log('label pattern matrix OK (' + cases.length + ' cases)')
