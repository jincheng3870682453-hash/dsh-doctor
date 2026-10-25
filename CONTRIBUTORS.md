# 贡献者

这个项目能修到今天这些坑，靠的是踩过坑的人愿意回来说一句。

## 想改代码？先读这个

**[给贡献者的架构速览（docs/for-contributors.md）](./docs/for-contributors.md)** —— 架构图、一次体检/修复怎么走、插件/EXE/Rust 三套运行时、加检查的步骤、工程约定，10 分钟能看懂项目骨架。

## 项目作者

学生。工作日要上课，**issue / PR 一般集中在周末处理**；消息看到了都会记下，不用急。

## 贡献者

### Relax

- 身份：社区用户（截图里的显示名是 "Relax"；如果不想公开这个名字，提 issue 说一声即可改成化名或匿名）；
- 贡献：报告 **"给了 DSH 太多权限，结果把自己的一部分文件删了"**；
- 影响：
  - v0.13.5 新增 [`permission-too-broad`](docs/catalog.md) 检查，扫描所有 `danger-full-access` 的会话；
  - 新增 [docs/recovery.md](docs/recovery.md)：文件被删后的恢复顺序（Git → 卷影 / 文件历史 / 网盘 → 回收站 → 恢复软件）；
  - `bugs/unverified.md` 增加 U13 条目。

### yuki

- 身份：社区用户（名字按本人要求写作小写 **yuki**）；
- 贡献：提交了完整的启动崩溃排障报告，定位到根因是 **profile 注册的 stdio MCP server 加载失败会让 host 直接退出**（`mcp-media.js` 作用域 bug），并顺带发现 **DSH 重启换端口、外部桥接仍连旧端口**的静默故障；
- 影响：
  - v0.13.9 新增 [`mcp-entry-broken`](docs/catalog.md) 检查（JS + PS 双端）；
  - `docs/traps.md` 加 #19（MCP 加载失败 / 作用域 bug 示例）；
  - 记录"端口漂移"类问题：外部桥接要自己轮询 `baseUrl`，医生不自动改外部配置。

## 贡献者徽章

被采纳的贡献者可以把这个徽章放到自己的主页 / 仓库 / 文章里：

[![DSH 私人医生 · 贡献者](https://raw.githubusercontent.com/jincheng3870682453-hash/dsh-doctor/main/assets/contributor-badge.svg)](https://github.com/jincheng3870682453-hash/dsh-doctor/blob/main/CONTRIBUTORS.md)

Markdown 复制：

```markdown
[![DSH 私人医生 · 贡献者](https://raw.githubusercontent.com/jincheng3870682453-hash/dsh-doctor/main/assets/contributor-badge.svg)](https://github.com/jincheng3870682453-hash/dsh-doctor/blob/main/CONTRIBUTORS.md)
```

## 怎么上榜

不用写代码也能上：

- 提一个能复现的 issue（症状 + 版本 + 系统 + 完整报错 + 已脱敏报告）；
- 补一条踩雷记录 / 一段恢复步骤；
- 写一个 JSON 检查包，或者 PR 一条检查/修复；
- 帮别人确认"我也遇到了"。

确认有效后会加进这里，并注明贡献内容。
