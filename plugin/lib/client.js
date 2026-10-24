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
.dshdr-root{display:flex;flex-direction:column;gap:16px;padding:24px 28px 28px;height:100%;box-sizing:border-box;
  overflow:auto;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;
  background:var(--dsw-alias-bg-base)}
.dshdr-hero{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.dshdr-mark{flex:0 0 auto;width:34px;height:34px;border-radius:11px;display:grid;place-items:center;
  background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4D6BFE) 15%,transparent);
  color:var(--dsw-alias-brand-primary,#4D6BFE)}
.dshdr-hero-text{display:flex;flex-direction:column;gap:1px;min-width:0}
.dshdr-title{font-size:17px;line-height:22px;font-weight:650;letter-spacing:.01em}
.dshdr-slogan{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px}
.dshdr-actions{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
.dshdr-btn{height:30px;padding:0 12px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);
  background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;
  transition:background 120ms ease,border-color 120ms ease,color 120ms ease}
.dshdr-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshdr-btn:disabled{opacity:.45;cursor:default}
.dshdr-btn-primary{border-color:transparent;background:var(--dsw-alias-label-primary);
  color:var(--dsw-alias-label-primary-foreground);font-weight:600}
.dshdr-summary{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.dshdr-stat{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:999px;
  border:1px solid var(--dsw-alias-border-l1);font-size:12px;color:var(--dsw-alias-label-secondary)}
.dshdr-stat b{font-weight:650}
.dshdr-stat-high{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent);
  color:var(--dsw-alias-state-error-primary)}
.dshdr-stat-medium{border-color:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#d97706) 45%,transparent);
  color:var(--dsw-alias-state-warning-primary,#d97706)}
.dshdr-stat-ok{color:var(--dsw-alias-state-success-primary,#15803d)}
.dshdr-card{position:relative;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;
  padding:16px 18px 14px 22px;display:flex;flex-direction:column;gap:8px;
  background:var(--dsw-alias-bg-base);transition:border-color 120ms ease}
.dshdr-card::before{content:'';position:absolute;left:8px;top:15px;bottom:15px;width:3px;border-radius:999px;
  background:var(--dsw-alias-border-l2)}
.dshdr-card-high::before{background:var(--dsw-alias-state-error-primary)}
.dshdr-card-medium::before{background:var(--dsw-alias-state-warning-primary,#d97706)}
.dshdr-card:hover{border-color:var(--dsw-alias-border-l2)}
.dshdr-card-head{display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap}
.dshdr-chip{flex:0 0 auto;font-size:11px;line-height:16px;font-weight:600;padding:1px 8px;border-radius:999px;
  border:1px solid currentColor}
.dshdr-high{color:var(--dsw-alias-state-error-primary)}
.dshdr-medium{color:var(--dsw-alias-state-warning-primary,#d97706)}
.dshdr-low{color:var(--dsw-alias-label-tertiary)}
.dshdr-name{font-weight:600;font-size:14px;line-height:22px;min-width:0}
.dshdr-detail{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:19px}
.dshdr-path{font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:17px;
  color:var(--dsw-alias-label-tertiary);word-break:break-all;
  background:var(--dsw-alias-interactive-bg-hover);border-radius:8px;padding:6px 9px}
.dshdr-pre{margin:0;max-height:320px;overflow:auto;white-space:pre-wrap;word-break:break-word;
  font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:17px;
  background:var(--dsw-alias-interactive-bg-hover);border-radius:10px;padding:10px 12px;
  color:var(--dsw-alias-label-secondary)}
.dshdr-fixrow{display:flex;justify-content:flex-end;margin-top:2px}
.dshdr-ok{color:var(--dsw-alias-state-success-primary,#15803d);font-weight:650;font-size:14px}
.dshdr-empty{padding:44px 24px;text-align:center;color:var(--dsw-alias-label-tertiary);
  border:1px dashed var(--dsw-alias-border-l2);border-radius:14px;
  display:flex;flex-direction:column;gap:6px;align-items:center}
.dshdr-hr{display:flex;align-items:center;gap:10px;color:var(--dsw-alias-label-tertiary);font-size:11px;
  letter-spacing:.02em}
.dshdr-hr::after{content:'';flex:1;height:1px;background:var(--dsw-alias-border-l1)}
.dshdr-foot{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px;
  border-top:1px solid var(--dsw-alias-border-l1);padding-top:12px;display:flex;flex-direction:column;gap:3px}
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

		async function fetchReport() {
			const response = await fetch('/dsh-doctor/report', { headers: { accept: 'application/json' } })
			if (!response.ok) throw new Error('HTTP ' + response.status)
			return response.json()
		}

		async function fetchUpdate() {
			const response = await fetch('/dsh-doctor/update', { headers: { accept: 'application/json' } })
			if (!response.ok) throw new Error('HTTP ' + response.status)
			return response.json()
		}

		async function openReleasePage(url) {
			const response = await fetch('/dsh-doctor/update/open', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ url }),
			})
			if (!response.ok) throw new Error('HTTP ' + response.status)
			return response.json()
		}

		async function saveReportFile() {
			const response = await fetch('/dsh-doctor/report/save', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{}',
			})
			if (!response.ok) throw new Error('HTTP ' + response.status)
			return response.json()
		}

		async function saveDiffReport() {
			const response = await fetch('/dsh-doctor/diff/save', {
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

		function systemNotify(title, body) {
			try {
				if (typeof Notification !== 'function') return
				const show = () => {
					try { new Notification(String(title), { body: String(body) }) } catch (error) { /* ignore */ }
				}
				if (Notification.permission === 'granted') { show(); return }
				if (Notification.permission !== 'denied' && typeof Notification.requestPermission === 'function') {
					Notification.requestPermission().then((permission) => {
						if (permission === 'granted') show()
					}, () => { /* 拒绝就只留面板横幅 */ })
				}
			} catch (error) { /* ignore */ }
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

		/** 面板标题里的小图标（静态，不联网）。 */
		function DoctorMark(props) {
			const size = props !== null && props !== undefined && typeof props.size === 'number' ? props.size : 20
			return h('svg', { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true },
				h('circle', { cx: 12, cy: 10.4, r: 6.2, fill: 'none', stroke: 'currentColor', strokeWidth: 1.9 }),
				h('path', { d: 'M12 10.4v4.3', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' }),
				h('path', { d: 'M8.3 18.6h7.4', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' }),
			)
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
			const [report, setReport] = React.useState(null)
			const [reportBusy, setReportBusy] = React.useState(false)
			const [updateInfo, setUpdateInfo] = React.useState(null)
			const [updateBusy, setUpdateBusy] = React.useState(false)

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

			const onCheckUpdate = () => {
				setUpdateBusy(true)
				fetchUpdate().then((data) => {
					setUpdateInfo(data)
					if (data !== null && data.ok === true && data.newer === true) {
						setToast({ ok: true, text: '发现新版本 ' + data.latest + '（当前 ' + data.current + '），点「打开下载页」去更新。' })
					} else if (data !== null && data.ok === true) {
						setToast({ ok: true, text: '已是最新版本 ' + data.current + '。' })
					} else {
						setToast({ ok: false, text: String(data !== null && data.message ? data.message : '检查更新失败') })
					}
				}, (reason) => {
					setToast({ ok: false, text: '检查更新失败：' + String(reason && reason.message ? reason.message : reason) })
				}).then(() => { setUpdateBusy(false) })
			}

			const onOpenRelease = () => {
				const url = updateInfo !== null && typeof updateInfo.url === 'string' ? updateInfo.url : ''
				openReleasePage(url).then((data) => {
					setToast({ ok: data !== null && data.ok === true, text: String(data !== null && data.message ? data.message : '完成') })
				}, (reason) => {
					setToast({ ok: false, text: '打开下载页失败：' + String(reason && reason.message ? reason.message : reason) })
				})
			}

			const onReport = () => {
				setReportBusy(true)
				fetchReport().then((data) => {
					setReport({ markdown: String(data.markdown || '') })
					setToast({ ok: true, text: '报告已生成：点「复制」直接发给 DSH，或「保存到桌面」留档；不保存也行。' })
				}, (reason) => {
					setToast({ ok: false, text: '生成报告失败：' + String(reason && reason.message ? reason.message : reason) })
				}).then(() => { setReportBusy(false) })
			}

			const onCopyReport = () => {
				const text = report !== null ? String(report.markdown) : ''
				try {
					navigator.clipboard.writeText(text).then(() => {
						setToast({ ok: true, text: '报告已复制到剪贴板，直接粘贴给 DSH 就行。' })
					}, () => {
						setToast({ ok: false, text: '复制失败：请手动选中报告文本复制。' })
					})
				} catch (error) {
					setToast({ ok: false, text: '复制失败：' + String(error && error.message ? error.message : error) })
				}
			}

			const onSaveReport = () => {
				saveReportFile().then((data) => {
					setToast({ ok: data !== null && data.ok === true, text: String(data !== null && data.message ? data.message : '完成') })
				}, (reason) => {
					setToast({ ok: false, text: '保存失败：' + String(reason && reason.message ? reason.message : reason) })
				})
			}

			const onDiffReport = () => {
				saveDiffReport().then((data) => {
					setToast({ ok: data !== null && data.ok === true, text: String(data !== null && data.message ? data.message : '完成') })
				}, (reason) => {
					setToast({ ok: false, text: '生成差异报告失败：' + String(reason && reason.message ? reason.message : reason) })
				})
			}

			const onTestNotify = () => {
				try {
					if (typeof Notification !== 'function') {
						setToast({ ok: false, text: '当前环境不支持系统通知（页面里没有 Notification）。' })
						return
					}
					const state = String(Notification.permission)
					systemNotify('DSH 私人医生', '这是一条测试通知：它应该显示来自 DeepSeek Harness，而不是 Windows PowerShell。')
					setToast({ ok: true, text: '已尝试发送系统通知（当前权限：' + state + '）。如果没出现，去系统「通知」设置里允许 DeepSeek Harness。' })
				} catch (error) {
					setToast({ ok: false, text: '测试失败：' + String(error && error.message ? error.message : error) })
				}
			}

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
					systemNotify(ok ? '网页版已启动 · DSH 私人医生' : '逃生失败 · DSH 私人医生', text)
				}, (reason) => {
					const text = '逃生请求失败：' + String(reason && reason.message ? reason.message : reason)
					setToast({ ok: false, text })
					systemNotify('逃生失败 · DSH 私人医生', text)
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
					systemNotify(ok ? '修复完成 · DSH 私人医生' : '修复失败 · DSH 私人医生', text)
				}, (reason) => {
					const text = '修复请求失败：' + String(reason && reason.message ? reason.message : reason)
					setToast({ ok: false, text })
					systemNotify('修复失败 · DSH 私人医生', text)
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
			if (status === null) {
				return h('div', { className: 'dshdr-root' },
					h('div', { className: 'dshdr-hero' },
						h('div', { className: 'dshdr-mark' }, h(DoctorMark, { size: 20 })),
						h('div', { className: 'dshdr-hero-text' },
							h('div', { className: 'dshdr-title' }, 'DSH 私人医生'),
							h('div', { className: 'dshdr-slogan' }, '点一下修复。'),
						),
					),
					h('div', { className: 'dshdr-empty' }, '正在体检…'),
				)
			}

			const all = status !== null && Array.isArray(status.findings) ? status.findings : []
			const findings = all.slice().sort((left, right) => severityRank(left.severity) - severityRank(right.severity))
			const high = findings.filter(item => item.severity === 'high').length
			const medium = findings.filter(item => item.severity === 'medium').length
			const env = status !== null && status.environment !== undefined ? status.environment : null

			const stats = []
			if (high > 0) stats.push(h('span', { key: 'stat-high', className: 'dshdr-stat dshdr-stat-high' },
				h('b', null, String(high)), ' 个高危'))
			if (medium > 0) stats.push(h('span', { key: 'stat-medium', className: 'dshdr-stat dshdr-stat-medium' },
				h('b', null, String(medium)), ' 条提醒'))
			if (high === 0 && medium === 0) stats.push(h('span', { key: 'stat-ok', className: 'dshdr-stat dshdr-stat-ok' }, '一切正常'))

			const cards = findings.map((item, index) => h('div', {
				key: String(item.id) + '-' + index,
				className: 'dshdr-card'
					+ (item.severity === 'high' ? ' dshdr-card-high' : '')
					+ (item.severity === 'medium' ? ' dshdr-card-medium' : ''),
			},
				h('div', { className: 'dshdr-card-head' },
					h('span', { className: severityClass(item.severity) }, severityText(item.severity)),
					h('span', { className: 'dshdr-name' }, String(item.title)),
				),
				item.detail !== undefined && item.detail !== null && String(item.detail).length > 0
					? h('div', { className: 'dshdr-detail' }, String(item.detail))
					: null,
				item.path !== undefined && item.path !== null && String(item.path).length > 0
					? h('div', { className: 'dshdr-path' }, String(item.path))
					: null,
				item.fixId !== undefined && item.fixId !== null
					? h('div', { className: 'dshdr-fixrow' },
						h('button', {
							type: 'button',
							className: 'dshdr-btn dshdr-btn-primary',
							disabled: pending !== null,
							onClick: () => onFix(item.fixId, item.title),
						}, pending === item.fixId ? '修复中…' : '一键修复'),
					)
					: null,
			))

			return h('div', { className: 'dshdr-root' },
				h('div', { className: 'dshdr-hero' },
					h('div', { className: 'dshdr-mark' }, h(DoctorMark, { size: 20 })),
					h('div', { className: 'dshdr-hero-text' },
						h('div', { className: 'dshdr-title' }, 'DSH 私人医生'),
						h('div', { className: 'dshdr-slogan' }, '点一下修复。'),
					),
					h('div', { className: 'dshdr-actions' },
						h('button', { type: 'button', className: 'dshdr-btn', onClick: onCheckUpdate, disabled: updateBusy }, updateBusy ? '检查中…' : '检查更新'),
						h('button', { type: 'button', className: 'dshdr-btn', onClick: onReport, disabled: reportBusy }, reportBusy ? '生成中…' : '生成报告'),
						h('button', { type: 'button', className: 'dshdr-btn', onClick: onRescue, disabled: rescuing }, rescuing ? '启动中…' : '起网页版'),
						h('button', { type: 'button', className: 'dshdr-btn', onClick: refresh, disabled: loading }, loading ? '检查中…' : '重新体检'),
					),
				),

				h('div', { className: 'dshdr-summary' }, stats),

				toast !== null
					? h('div', { className: 'dshdr-toast' + (toast.ok === true ? '' : ' dshdr-toast-bad') }, String(toast.text))
					: null,

				updateInfo !== null && updateInfo.ok === true && updateInfo.newer === true
					? h('div', { className: 'dshdr-card dshdr-card-medium' },
						h('div', { className: 'dshdr-card-head' },
							h('span', { className: 'dshdr-chip dshdr-medium' }, '更新'),
							h('span', { className: 'dshdr-name' }, '发现新版本 ' + String(updateInfo.latest)),
							h('div', { className: 'dshdr-actions' },
								h('button', { type: 'button', className: 'dshdr-btn dshdr-btn-primary', onClick: onOpenRelease }, '打开下载页'),
								h('button', { type: 'button', className: 'dshdr-btn', onClick: () => setUpdateInfo(null) }, '忽略'),
							),
						),
						h('div', { className: 'dshdr-detail' },
							'当前版本 ' + String(updateInfo.current)
								+ (updateInfo.publishedAt ? ' · 新版发布于 ' + new Date(updateInfo.publishedAt).toLocaleString() : '')),
					)
					: null,

				report !== null
					? h('div', { className: 'dshdr-card' },
						h('div', { className: 'dshdr-card-head' },
							h('span', { className: 'dshdr-chip dshdr-low' }, '给 AI'),
							h('span', { className: 'dshdr-name' }, '求助报告'),
							h('div', { className: 'dshdr-actions' },
								h('button', { type: 'button', className: 'dshdr-btn', onClick: onCopyReport }, '复制'),
								h('button', { type: 'button', className: 'dshdr-btn', onClick: onSaveReport }, '保存到桌面'),
								h('button', { type: 'button', className: 'dshdr-btn', onClick: () => setReport(null) }, '收起'),
							),
						),
						h('div', { className: 'dshdr-detail' }, '里面带提示词约束，直接发给任何 AI 都行；不想留档就不用保存。'),
						h('pre', { className: 'dshdr-pre' }, String(report.markdown)),
					)
					: null,

				findings.length === 0 && status !== null
					? h('div', { className: 'dshdr-empty' },
						h('div', { className: 'dshdr-ok' }, '没有发现问题'),
						h('div', null, '桌面 ACL、工作区注册、profile 宿主包、会话、崩溃日志都正常。'),
						h('div', null, '点一下修复 —— 平时它不会打扰你。'))
					: cards,

				history.length > 0
					? h('div', { className: 'dshdr-card' },
						h('div', { className: 'dshdr-card-head' },
							h('span', { className: 'dshdr-name' }, '修复录'),
							h('span', { className: 'dshdr-detail' }, '最近 ' + history.length + ' 条'),
						),
						history.slice(0, 8).map((entry, index) => h('div', {
							key: String(entry.at) + String(entry.id) + '-' + index,
							style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
						},
							h('span', { className: entry.ok === true ? 'dshdr-chip dshdr-low' : 'dshdr-chip dshdr-high' }, entry.ok === true ? '成功' : '失败'),
							h('span', { className: 'dshdr-detail' },
								String(entry.id) + ' · ' + new Date(entry.at).toLocaleString() + ' · ' + String(entry.message || '')),
						)),
					)
					: null,

				h('div', { className: 'dshdr-foot' },
					h('div', null, env === null
						? '只在本机运行，不上传任何数据。'
						: 'DSH 目录：' + String(env.dshHome) + ' · 平台：' + String(env.platform || '') + ' · profile：'
							+ (Array.isArray(env.profiles) ? env.profiles.join('、') : '')),
					h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
						h('span', null, '只修改这几类已知问题；每次修复先备份、改完复检，不动安装目录。'),
						h('button', {
							type: 'button',
							className: 'dshdr-btn',
							style: { height: '22px', padding: '0 8px', fontSize: '11px' },
							onClick: onDiffReport,
						}, '环境差异报告'),
						h('button', {
							type: 'button',
							className: 'dshdr-btn',
							style: { height: '22px', padding: '0 8px', fontSize: '11px' },
							onClick: onTestNotify,
						}, '测试通知'),
					),
				),
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
