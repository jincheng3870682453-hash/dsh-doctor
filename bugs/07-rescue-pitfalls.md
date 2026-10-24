# 07 · 网页版逃生踩的坑

## 症状

用户反馈："双击了，在运行，但看不到页面"；或逃生页设置全部报 `Failed to fetch`。

## 根因（三个叠加）

1. **没有 Node/CLI**：逃生依赖本机 `dsh` 或 `npx`，只有桌面端的用户会卡在 npx 下载，进程在跑但页面不来；
2. **裸地址没有 token**：`http://127.0.0.1:<port>/` 能加载页面，但所有 API 无授权 → 设置/插件全部 `Failed to fetch`；
3. **旧标签页指向已死端口**：每次点都新开一个实例，旧标签页的 host 早已退出，同样报 `Failed to fetch`。

## 修法

1. 复用已运行的实例（端口登记在 `~/.dsh/dsh-doctor/rescue.json`）；
2. 从启动日志里抠出 `?token=` 地址再打开浏览器；
3. 把地址写到桌面 `dsh-doctor-网页版地址.txt`，浏览器没弹出来也能手动复制；
4. npx 时等 3 分钟，失败明确提示"没有 Node 环境，请用环境包"；
5. 桌面生成**交接报告**：问题清单已排好序，直接丢给网页版 DSH，减少无意义 token 消耗。

## 验证

`rescue.json` 里端口存活；`/status` 接口 200；旧标签页问题会以 `rescue-instance-dead` 报出来。

## 对应

- 检测：`rescue-instance-dead`
- 修复/功能：`rescueWeb`、交接报告
- 版本：v0.4.3 起，v0.6.1 补环境包提示
