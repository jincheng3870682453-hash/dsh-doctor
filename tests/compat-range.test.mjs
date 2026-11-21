/**
 * 兼容性判定自检。
 *
 * 背景：DSH 的兼容性守卫不是「版本号必须完全相等」，而是读插件清单里的
 * `engines.dsh`，没有就只看 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 的
 * peerDependencies 范围。医生如果只比版本号，就会把「落后但兼容」误报成
 * 「会被拦下」，也会把真正被跳过的说成「面板不显示」。
 *
 * 这里锁住三件事：
 *   1. 精确版本 peer（0.2.2-rc.3）在 rc.5 下确实不满足 —— 真会被跳过；
 *   2. 只有 cordis peer 的包不会触发守卫 —— 只是版本落后；
 *   3. 常见范围写法（^、~、>=、x、*）按 semver 语义判断，认不出的返回 null。
 */
import { compareSemver, semverSatisfies, unmetDshRequirements } from '../plugin/lib/index.js'

let failed = 0

function check(name, actual, expected) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected)
	if (ok) {
		console.log('ok:', name)
		return
	}
	failed += 1
	console.log('FAIL:', name, '->', JSON.stringify(actual), 'expected', JSON.stringify(expected))
}

// ── 版本比较 ────────────────────────────────────────────────
check('rc.3 < rc.5', compareSemver('0.2.2-rc.3', '0.2.2-rc.5'), -1)
check('rc.10 > rc.9（按数字比，不按字符串）', compareSemver('0.2.2-rc.10', '0.2.2-rc.9'), 1)
check('正式版 > 同号预发布', compareSemver('1.0.0', '1.0.0-rc.1'), 1)
check('build 元数据不参与比较', compareSemver('1.0.0+a', '1.0.0+b'), 0)

// ── 范围判断 ────────────────────────────────────────────────
check('精确版本不同 → 不满足', semverSatisfies('0.2.2-rc.5', '0.2.2-rc.3'), false)
check('精确版本相同 → 满足', semverSatisfies('0.2.2-rc.5', '0.2.2-rc.5'), true)
check('^0.2.2-rc.1 覆盖 rc.5', semverSatisfies('0.2.2-rc.5', '^0.2.2-rc.1'), true)
check('^0.2.2-rc.1 不覆盖 0.3.0', semverSatisfies('0.3.0', '^0.2.2-rc.1'), false)
check('~0.2.2-rc.3 覆盖 rc.5', semverSatisfies('0.2.2-rc.5', '~0.2.2-rc.3'), true)
check('~0.2.2-rc.3 不覆盖 0.3.0', semverSatisfies('0.3.0', '~0.2.2-rc.3'), false)
check('~4.1.0 覆盖 4.1.7', semverSatisfies('4.1.7', '~4.1.0'), true)
check('~4.1.0 不覆盖 4.2.0', semverSatisfies('4.2.0', '~4.1.0'), false)
check('>=0.2.0 <0.3.0 覆盖 rc.5', semverSatisfies('0.2.2-rc.5', '>=0.2.0 <0.3.0'), true)
check('>=0.2.0 <0.3.0 不覆盖 0.3.1', semverSatisfies('0.3.1', '>=0.2.0 <0.3.0'), false)
check('1.2.x 覆盖 1.2.9', semverSatisfies('1.2.9', '1.2.x'), true)
check('1.2.x 不覆盖 1.3.0', semverSatisfies('1.3.0', '1.2.x'), false)
check('* 全满足', semverSatisfies('0.2.2-rc.5', '*'), true)
check('workspace:* 视为当前运行时', semverSatisfies('0.2.2-rc.5', 'workspace:*'), true)
check('认不出的写法返回 null', semverSatisfies('0.2.2-rc.5', 'latest'), null)

// ── 清单级判定（与 dsh-app-boot 的 unmetRequirements 对齐）──
const exactPeer = {
	name: '@deepseek-ai/dsh-subagent-claude-code',
	version: '0.2.2-rc.3',
	peerDependencies: {
		'@deepseek-ai/cordis': '~4.1.0',
		'@deepseek-ai/dsh-llm': '0.2.2-rc.3',
		'@deepseek-ai/dsh-session': '0.2.2-rc.3',
	},
}
check('精确 peer 在 rc.5 下不满足', unmetDshRequirements(exactPeer, '0.2.2-rc.5'), {
	'@deepseek-ai/dsh-llm': '0.2.2-rc.3',
	'@deepseek-ai/dsh-session': '0.2.2-rc.3',
})

const cordisOnly = {
	name: '@deepseek-ai/dsh-experimental-plugin-market-bundle',
	version: '0.2.2-rc.3',
	peerDependencies: { '@deepseek-ai/cordis': '~4.1.0' },
}
check('只有 cordis peer → 不触发守卫', unmetDshRequirements(cordisOnly, '0.2.2-rc.5'), {})

check('engines.dsh 优先于 peer', unmetDshRequirements({
	engines: { dsh: '^0.3.0' },
	peerDependencies: { '@deepseek-ai/dsh-llm': '0.2.2-rc.5' },
}, '0.2.2-rc.5'), { 'engines.dsh': '^0.3.0' })

check('清单缺失返回 null', unmetDshRequirements(null, '0.2.2-rc.5'), null)

process.exit(failed === 0 ? 0 : 1)
