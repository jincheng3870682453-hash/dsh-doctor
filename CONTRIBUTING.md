# 参与贡献

感谢你愿意帮这个项目。这里不要求你是 DSH 内部开发者——**"踩到坑"本身就是最有价值的贡献**。

## 你可以贡献什么

| 方式 | 适合谁 | 怎么做 |
|---|---|---|
| **Bug 图鉴条目** | 任何用户 | 在 [bugs/](bugs/) 新增一个 MD，写清症状 / 根因 / 修法 / 验证，并在 [bugs/README.md](bugs/README.md) 表格里加一行 |
| **检查包（JSON）** | 会写 JSON 就行 | 按 [docs/protocol.md](docs/protocol.md) 写一个检查包，放进 `examples/checks/` |
| **修复动作 / 代码** | 开发者 | 修改 `plugin/lib/index.js`，跑通测试后提 PR |
| **文档 / 翻译** | 任何人 | README、docs、UPDATES 的表述修正都欢迎 |
| **真机验证** | 有 macOS / Linux 的用户 | 跑一遍 Unix 包，把报错贴回来（我们目前只在 Windows 实机验证过） |

## 非代码贡献也能进图鉴

踩到一个新坑时，请提供：

1. **症状**（你看到的原文，最好带截图）；
2. **复现步骤**（做了什么之后出现的）；
3. **现场证据**——直接生成一份报告就行，里面已自动脱敏：
   - 有面板：点页脚「环境差异报告」，桌面会得到 `dsh-doctor-环境差异-<时间>.md`；
   - 桌面端已经报废：双击 `dsh-doctor.exe diff`（菜单选 `8`），不依赖 DSH / Node / 联网；
   - 命令行：`node dsh-doctor.mjs diff`；
   - 只要完整报错：`node dsh-doctor.mjs report`（给 AI 的求助报告）。
4. 你已经试过什么、结果如何。

这四样齐全，基本就能定位。

> 报告里的用户名、主机名、邮箱、用户主目录会替换成 `user`、`<machine>`、`user@example.com`，
> 但**非用户目录的路径会保留**（比如 `D:\项目名`）——那是定位问题所必需的。提交前自己扫一眼即可。

## 桌面端报废时怎么贡献

DSH 彻底起不来时，插件、面板、网页版都用不上，但 `dsh-doctor.exe` 仍然可用：

```
dsh-doctor.exe scan     # 体检，看它报了什么
dsh-doctor.exe diff     # 生成环境差异报告（可提交）
dsh-doctor.exe          # 双击进入菜单
```

把 `diff` 生成的 MD 贴进 issue，比"我的 DSH 坏了"有用一百倍。

## 写检查包（最简单）

```json
{
  "protocolVersion": 1,
  "id": "my-pack",
  "title": "我踩过的坑",
  "checks": [
    {
      "id": "my-pack:something",
      "title": "现象描述",
      "severity": "high",
      "detect": { "type": "workspace-risky-path" },
      "fix": { "type": "workspace-entry" }
    }
  ]
}
```

放进 `%USERPROFILE%\.dsh\dsh-doctor\checks\` 立刻生效，不需要重启。
**不允许**在检查包里写代码或执行任意命令——那是安全边界，相关 PR 会直接拒。

## 代码纪律（PR 必读）

1. **默认只读**：新增检查不得写盘；`scan` / `report` 永远无副作用。
2. **可回滚**：任何写操作先备份，改完复检，失败自动还原。
3. **失败不抛**：单条检查/修复失败只降级成 finding，不能拖垮整个面板或宿主。
4. **没有 shell 通道**：检查包只能声明「检测原语 + 内置修复 id」。
5. **幂等**：同一修复执行两次结果一致，第二次应返回"不需要修"。
6. **别改 DSH 安装目录**：只能动 `~/.dsh`、工作区 ACL、桌面 ACL 这些本机状态。

## 本地开发

```powershell
node tools/cli.mjs scan            # 只读体检
node tools/cli.mjs fix workspace-entry
node tools/cli.mjs report          # 给 AI 的求助报告
node --check plugin/lib/index.js   # 语法检查
```

构建发行包：

```powershell
powershell -File tools/build.ps1                  # Windows：EXE + Unix 包 + 插件 zip
bash tools/package-unix.sh                        # Linux/macOS 包
```

## 把开发版装进 DSH 调试

插件是 **profile 级**的，装一次对该 profile 下所有会话生效，重启后仍在。

- **桌面端**：侧边栏 → 插件 → 添加，在「添加插件」对话框里粘**本地目录绝对路径**（指到 `plugin/`）。桌面端由 Electron 应用自己管包，**命令行装不了**，会提示 `profile "desktop" is managed exclusively by the Electron application`。
- **非桌面 profile**：`dsh plugin --profile web add "D:\path\to\dsh-doctor\plugin"`。内部就是 pnpm，接受包名 / 本地目录 / git / tarball，装完自动加进 `dsh.profile.bundles` 并启用。
- **会话里**：`plugin_manager` 的 `install_bundle`，`target` 填**绝对目录**。

根 `package.json` 必须声明 `dsh.bundle.patch`，否则会被判为 `not-a-bundle`。本地目录安装是 `link:` 语义，改完 `plugin/lib/*.js` 重启即可生效。

## 测试与 CI

- `ci.yml`：三系统冒烟、PowerShell 冒烟、假 DSH 目录上的集成修复、30 次压力扫描；
- `build.yml`：云端编 EXE / Unix 包 / 环境包 / 插件 zip，并对产物真跑一次 `scan` 和 `dsh-doctor.exe diff`（校验报告结构）；
- 打 `v*` tag 会自动创建 Release，不需要手动上传。

**PR 之前请确认 CI 全绿。** 如果 CI 抓到了你的 bug，那不是坏事——它替用户先踩了。

## 提交信息

```
fix: 一句话说清修了什么（写"为什么"更好）
feat: 新能力
docs: 文档
chore: 杂项
```

## 安全与隐私

- 报告**已自动脱敏**（用户名 / 主机名 / 邮箱 / 用户主目录 → `user` / `<machine>` / `user@example.com`），但非用户目录的路径会保留，**提交前扫一眼**；
- 不要在 issue / PR 里贴 token、密钥、凭据文件；
- 发现的漏洞请先私下联系维护者，不要直接公开利用细节。

## License

本项目使用 **MIT**（见 [LICENSE](LICENSE)）。提交 PR 即表示你同意自己的贡献按 MIT 授权。
DSH 私人医生是非官方项目，与深度求索无关。

## 行为准则

就事论事、对事不对人。这个项目存在的意义是让别人少踩坑，不是证明谁更聪明。
