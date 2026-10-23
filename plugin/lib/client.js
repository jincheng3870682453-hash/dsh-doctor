/**
 * dsh-doctor 的浏览器半边。
 *
 * 两块界面：
 *   - 侧边栏图标（sidebar.panellist 的一个 cell，id = dsh-doctor，自动对应 main 面板）；
 *   - 主面板（main 的 dsh-doctor 键）：列问题、一键修复、看环境。
 *
 * 硬约束：任何渲染/请求失败都必须退化成"看得懂的提示"，绝不让侧边栏或面板整块消失。
 */
window.__ModuleLoader__.load({
	id: 'dsh-doctor',
	factory: (require) => {
		const module = { exports: {} }
		const exports = module.exports

		const React = require('react')
		const h = React.createElement

		const CSS = `
.dshdr-root{display:flex;flex-direction:column;gap:14px;padding:20px 24px;height:100%;box-sizing:border-box;
  overflow:auto;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;
  background:var(--dsw-alias-bg-base)}
.dshdr-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.dshdr-title{font-size:17px;line-height:24px;font-weight:600}
.dshdr-sub{color:var(--dsw-alias-label-tertiary);font-size:12px}
.dshdr-actions{margin-left:auto;display:flex;gap:8px}
.dshdr-btn{height:28px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);
  background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer}
.dshdr-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshdr-btn:disabled{opacity:.5;cursor:default}
.dshdr-btn-primary{border-color:transparent;background:var(--dsw-alias-label-primary);
  color:var(--dsw-alias-label-primary-foreground)}
.dshdr-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:14px 16px;
  display:flex;flex-direction:column;gap:8px;background:var(--dsw-alias-bg-base)}
.dshdr-card-high{border-color:var(--dsw-alias-state-error-primary)}
.dshdr-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dshdr-chip{font-size:11px;line-height:16px;font-weight:600;padding:1px 8px;border-radius:999px;
  border:1px solid currentColor}
.dshdr-high{color:var(--dsw-alias-state-error-primary)}
.dshdr-medium{color:var(--dsw-alias-state-warning-primary,#d97706)}
.dshdr-low{color:var(--dsw-alias-label-tertiary)}
.dshdr-name{font-weight:600;font-size:14px}
.dshdr-detail{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dshdr-path{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary);
  word-break:break-all}
.dshdr-ok{color:var(--dsw-alias-state-success-primary,#15803d);font-weight:600}
.dshdr-empty{padding:28px;text-align:center;color:var(--dsw-alias-label-tertiary);
  border:1px dashed var(--dsw-alias-border-l2);border-radius:12px}
.dshdr-msg{font-size:12px;line-height:18px;padding:8px 10px;border-radius:8px;white-space:pre-line;
  background:var(--dsw-alias-interactive-bg-hover)}
.dshdr-foot{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;
  border-top:1px solid var(--dsw-alias-border-l1);padding-top:10px}
.dshdr-err{color:var(--dsw-alias-state-error-primary);font-size:12px}
/* 结果提示放在面板内容流里（不是浮层）：不盖窗口控件，也不盖面板按钮。 */
.dshdr-toast{display:block;width:100%;box-sizing:border-box;padding:9px 12px;border-radius:10px;
  background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l1);
  color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;white-space:pre-line;
  animation:dshdr-toast-in 160ms ease-out}
.dshdr-toast-bad{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
@keyframes dshdr-toast-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
`

		let styleElement = null
		function ensureStyle() {
			if (typeof document === 'undefined') return
			if (styleElement !== null && styleElement.isConnected === true) return
			const style = document.createElement('style')
			style.setAttribute('data-dsh-doctor', '')
			style.textContent = CSS
			document.head.appendChild(style)
			styleElement = style
		}

		function severityRank(severity) {
			if (severity === 'high') return 0
			if (severity === 'medium') return 1
			return 2
		}

		function severityClass(severity) {
			if (severity === 'high') return 'dshdr-chip dshdr-high'
			if (severity === 'medium') return 'dshdr-chip dshdr-medium'
			return 'dshdr-chip dshdr-low'
		}

		function severityText(severity) {
			if (severity === 'high') return '高危'
			if (severity === 'medium') return '提醒'
			return '信息'
		}

		async function fetchStatus() {
			const response = await fetch('/dsh-doctor/status', { headers: { accept: 'application/json' } })
			if (!response.ok) throw new Error('HTTP ' + response.status)
			return response.json()
		}

		async function fetchHistory() {
			const response = await fetch('/dsh-doctor/history', { headers: { accept: 'application/json' } })
			if (!response.ok) throw new Error('HTTP ' + response.status)
			return response.json()
		}

		async function startRescue() {
			const response = await fetch('/dsh-doctor/rescue', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{}',
			})
			if (!response.ok) throw new Error('HTTP ' + response.status)
			return response.json()
		}

		async function applyFix(id) {
			const response = await fetch('/dsh-doctor/fix', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id }),
			})
			if (!response.ok) throw new Error('HTTP ' + response.status)
			return response.json()
		}

		/** 侧边栏图标：安静，只有 High（真需要人处理）才亮红点；修完立刻消失。 */
		function SidebarIcon(props) {
			const size = props !== null && props !== undefined && typeof props.size === 'number' ? props.size : 18
			const [highCount, setHighCount] = React.useState(0)
			React.useEffect(() => {
				let cancelled = false
				const load = () => {
					fetchStatus().then((data) => {
						if (cancelled) return
						const list = Array.isArray(data.findings) ? data.findings : []
						setHighCount(list.filter(item => item.severity === 'high').length)
					}, () => { /* 取不到就保持现状 */ })
				}
				load()
				const timer = setInterval(load, 30000)
				// 面板里每次修复/逃生后都会发这个事件，图标立刻重算，不用等轮询。
				const onRefresh = () => load()
				window.addEventListener('dsh-doctor:refresh', onRefresh)
				return () => {
					cancelled = true
					clearInterval(timer)
					window.removeEventListener('dsh-doctor:refresh', onRefresh)
				}
			}, [])
			const showDot = highCount > 0
			return h('svg', {
				width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true,
				role: 'img', 'aria-label': showDot ? ('私人医生：' + highCount + ' 个高危问题') : '私人医生：一切正常',
			},
				showDot ? h('title', null, highCount + ' 个高危问题，点开处理') : h('title', null, '私人医生：一切正常'),
				h('circle', { cx: 12, cy: 11, r: 6.5, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 }),
				h('path', { d: 'M12 11v4.5', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }),
				h('path', { d: 'M12 5.5V4', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
				showDot ? h('circle', { cx: 18.5, cy: 5.5, r: 3.2, fill: 'var(--dsw-alias-state-error-primary)' }) : null,
			)
		}

		class Boundary extends React.Component {
			constructor(props) {
				super(props)
				this.state = { error: null }
			}
			static getDerivedStateFromError(error) {
				return { error }
			}
			componentDidCatch(error) {
				console.error('[dsh-doctor] 面板渲染失败', error)
			}
			render() {
				if (this.state.error !== null && this.state.error !== undefined) {
					return h('div', { className: 'dshdr-root' },
						h('div', { className: 'dshdr-err' }, '医生面板渲染失败：' + String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error)),
					)
				}
				return this.props.children
			}
		}

		/** 主面板。 */
		function Panel() {
			ensureStyle()
			const [status, setStatus] = React.useState(null)
			const [history, setHistory] = React.useState([])
			const [loading, setLoading] = React.useState(false)
			const [rescuing, setRescuing] = React.useState(false)
			const [error, setError] = React.useState(null)
			const [pending, setPending] = React.useState(null)
			const [toast, setToast] = React.useState(null)
			const [rescueArmed, setRescueArmed] = React.useState(false)

			// 每条消息 6 秒后自己消失（"完成后弹个消息"）。
			React.useEffect(() => {
				if (toast === null) return undefined
				// 多行的交接报告多留一会儿，单行结果 6 秒就够。
				const duration = String(toast.text).indexOf('\n') >= 0 ? 15000 : 6000
				const timer = setTimeout(() => setToast(null), duration)
				return () => clearTimeout(timer)
			}, [toast])

			const refresh = React.useCallback(() => {
				setRescueArmed(false)
				setLoading(true)
				fetchStatus().then((data) => {
					setStatus(data)
					setError(null)
					const list = Array.isArray(data.findings) ? data.findings : []
					const high = list.filter(item => item.severity === 'high').length
					const medium = list.filter(item => item.severity === 'medium').length
					setToast({
						ok: high === 0,
						text: high === 0
							? (medium === 0 ? '体检完成：一切正常' : '体检完成：无高危，' + medium + ' 条提醒')
							: '体检完成：' + high + ' 个高危问题等你处理',
					})
				}, (reason) => {
					setError(String(reason && reason.message ? reason.message : reason))
				}).then(() => { setLoading(false) })
				fetchHistory().then((data) => {
					setHistory(Array.isArray(data.entries) ? data.entries : [])
				}, () => { /* 历史读不到不影响体检 */ })
			}, [])

			React.useEffect(() => { refresh() }, [refresh])

			const onRescue = () => {
				// 网页版是最后一招：还有能一键修的问题时，先劝一次，再点才放行。
				const fixable = status !== null && status.summary !== undefined ? (Number(status.summary.fixableHigh) || 0) : 0
				if (!rescueArmed && fixable > 0) {
					setRescueArmed(true)
					const text = '还有 ' + fixable + ' 个可以一键修好的问题，建议先点「一键修复」。确实修不好、要现在开网页版逃生，就再点一次「起网页版」。'
										setToast({ ok: false, text })
					return
				}
				setRescueArmed(false)
				setRescuing(true)
								startRescue().then((result) => {
					const ok = result !== null && result.ok === true
					const text = String(result !== null && result.message ? result.message : '完成')
										setToast({ ok, text })
				}, (reason) => {
					const text = '逃生请求失败：' + String(reason && reason.message ? reason.message : reason)
										setToast({ ok: false, text })
				}).then(() => {
					setRescuing(false)
					notifyStatusChanged()
					refresh()
				})
			}

			const onFix = (fixId, label) => {
				if (typeof fixId !== 'string' || fixId.length === 0) return
				setPending(fixId)
								applyFix(fixId).then((result) => {
					const ok = result !== null && result.ok === true
					const text = String(result !== null && result.message ? result.message : '完成')
										setToast({ ok, text })
				}, (reason) => {
					const text = '修复请求失败：' + String(reason && reason.message ? reason.message : reason)
										setToast({ ok: false, text })
				}).then(() => {
					setPending(null)
					notifyStatusChanged()
					refresh()
				})
			}

			if (status === null && error !== null) {
				return h('div', { className: 'dshdr-root' },
					h('div', { className: 'dshdr-title' }, 'DSH 私人医生'),
					h('div', { className: 'dshdr-err' }, '读不到本机状态：' + error),
					h('div', null, h('button', { type: 'button', className: 'dshdr-btn', onClick: refresh }, '重试')),
				)
			}

			const all = status !== null && Array.isArray(status.findings) ? status.findings : []
			const findings = all.slice().sort((left, right) => severityRank(left.severity) - severityRank(right.severity))
			const high = findings.filter(item => item.severity === 'high').length
			const medium = findings.filter(item => item.severity === 'medium').length
			const env = status !== null && status.environment !== undefined ? status.environment : null

			return h('div', { className: 'dshdr-root' },
				h('div', { className: 'dshdr-head' },
					h('span', { className: 'dshdr-title' }, 'DSH 私人医生'),
					h('span', { className: 'dshdr-sub' },
						status === null ? '正在体检…' : high > 0 ? high + ' 个高危问题' : medium > 0 ? medium + ' 个提醒' : '一切正常'),
					h('div', { className: 'dshdr-actions' },
						h('button', { type: 'button', className: 'dshdr-btn', onClick: onRescue, disabled: rescuing }, rescuing ? '启动中…' : '起网页版'),
						h('button', { type: 'button', className: 'dshdr-btn', onClick: refresh, disabled: loading }, loading ? '检查中…' : '重新体检'),
					),
				),

				toast !== null
					? h('div', { className: 'dshdr-toast' + (toast.ok === true ? '' : ' dshdr-toast-bad') }, String(toast.text))
					: null,

				findings.length === 0 && status !== null
					? h('div', { className: 'dshdr-empty' },
						h('div', { className: 'dshdr-ok' }, '没有发现问题'),
						h('div', null, '桌面 ACL、工作区注册、profile 宿主包、会话、崩溃日志都正常。'))
					: findings.map((item, index) => h('div', {
						key: String(item.id) + '-' + index,
						className: item.severity === 'high' ? 'dshdr-card dshdr-card-high' : 'dshdr-card',
					},
						h('div', { className: 'dshdr-row' },
							h('span', { className: severityClass(item.severity) }, severityText(item.severity)),
							h('span', { className: 'dshdr-name' }, String(item.title)),
						),
						h('div', { className: 'dshdr-detail' }, String(item.detail)),
						item.path !== undefined && item.path !== null && String(item.path).length > 0
							? h('div', { className: 'dshdr-path' }, String(item.path))
							: null,
						item.fixId !== undefined && item.fixId !== null
							? h('div', { className: 'dshdr-row' },
								h('button', {
									type: 'button',
									className: 'dshdr-btn dshdr-btn-primary',
									disabled: pending !== null,
									onClick: () => onFix(item.fixId, item.title),
								}, pending === item.fixId ? '修复中…' : '一键修复'),
							)
							: null,
					)),

				history.length > 0
					? h('div', { className: 'dshdr-card' },
						h('div', { className: 'dshdr-row' },
							h('span', { className: 'dshdr-name' }, '修复录'),
							h('span', { className: 'dshdr-sub' }, '最近 ' + history.length + ' 条'),
						),
						history.slice(0, 8).map((entry, index) => h('div', {
							key: String(entry.at) + String(entry.id) + '-' + index,
							className: 'dshdr-row',
						},
							h('span', { className: entry.ok === true ? 'dshdr-chip dshdr-low' : 'dshdr-chip dshdr-high' }, entry.ok === true ? '成功' : '失败'),
							h('span', { className: 'dshdr-detail' },
								String(entry.id) + ' · ' + new Date(entry.at).toLocaleString() + ' · ' + String(entry.message || '')),
						)),
					)
					: null,

				h('div', { className: 'dshdr-foot' },
					env === null ? '只在本机运行，不上传任何数据。' :
						'DSH 目录：' + String(env.dshHome) + ' · profile：' + (Array.isArray(env.profiles) ? env.profiles.join('、') : '') +
						' · 检查时间：' + String(env.at) + '。只修改这几类已知问题，不动安装目录。'),
			)
		}

		function apply(ctx) {
			ensureStyle()
			ctx.slots.inject('main', () => ctx.slots.register({
				name: 'main',
				key: 'dsh-doctor',
			}, Panel))
			ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
				name: 'sidebar.panellist',
				id: 'dsh-doctor',
				order: 30,
				label: () => '私人医生',
			}, SidebarIcon))
		}

		/** 修复/逃生之后通知侧边栏图标立刻重算状态。 */
		function notifyStatusChanged() {
			try { window.dispatchEvent(new CustomEvent('dsh-doctor:refresh')) } catch (error) { /* ignore */ }
		}

		exports.apply = apply
		exports.inject = ['slots']
		exports.__Panel = Panel
		exports.__SidebarIcon = SidebarIcon
		exports.__Boundary = Boundary
		return module.exports
	},
})
