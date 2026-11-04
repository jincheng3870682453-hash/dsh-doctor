# 安装

插件是 **profile 级**的：装一次，该 profile 下所有会话都能用，重启后仍然在。

## 方式一：npm 包名直装（最快）

已发布到 npm：**`dsh-doctor-plugin`**。

- **应用内**：侧边栏 → 插件 → 添加，输入框填 `dsh-doctor-plugin`，保持默认安装源，点安装；
- **命令行**：`dsh plugin --profile <name> add dsh-doctor-plugin`；
- **npm 用户**：`npm install dsh-doctor-plugin`。

> 别装 `dsh-doctor`——那是第三方的同名包（astra3294/dsh-doctor 0.4.3），不是本项目。

## 方式二：本地目录 / 离线安装（npm 不通时）

1. 下载 Release 里的 `dsh-doctor-plugin.zip`，**解压到一个固定目录**，例如 `D:\dsh-doctor-plugin`（别放桌面，免得和图标修复互相干扰）；
2. 侧边栏 → 插件 → 添加，把**解压后的绝对目录**粘进去；
3. 「安装源」（中国大陆镜像源）对本地目录没有影响，保持默认；
4. 点安装。装完默认启用，侧边栏出现「私人医生」；没立即生效就重启一次 DSH。

对话框里的黄色提示「插件在本机以你的权限运行」是所有插件的通用警告——医生的代码全在仓库里、默认只读、改动先备份，可以自己审。

> **别直接填本仓库的 GitHub 地址**：bundle 在 `plugin/` 子目录，仓库根不是 package，会被判 `not-a-bundle`。想用 GitHub 地址装，先 `git clone`，再填 `...\dsh-doctor\plugin`。

## 方式三：命令行（web / tui 等非桌面 profile）

```bash
dsh plugin --profile web add "D:\path\to\dsh-doctor\plugin"
```

内部就是 pnpm，接受**包名、本地目录、git 地址、tarball**；装完自动加进 `dsh.profile.bundles` 并启用。

> 桌面端（`desktop` profile）由 Electron 应用独占，命令行会拒绝：`profile "desktop" is managed exclusively by the Electron application`。桌面端请用应用内安装。

## 方式四：在会话里让 AI 装

对 AI 说「把这个目录装成插件：`D:\dsh-doctor-plugin`」，它会用 `plugin_manager` 的 `install_bundle`。

> 插件包根目录的 `package.json` 必须声明 `dsh.bundle.patch`（本仓库有），否则会被判 `not-a-bundle`。
> 开发时可以直接把仓库的 `plugin/` 目录当本地目录装（`link:` 语义，改完代码重启生效；**目录不能移动/删除**）。

## 桌面端已经彻底报废？

DSH 起不来、面板打不开、连网页版都进不去时，插件功能一个也用不上。直接用 EXE（见 README 顶部）：

| 做什么 | 操作 |
|---|---|
| 体检 | `dsh-doctor.exe scan`，或菜单 `1` |
| 修桌面图标 | 菜单 `2` |
| 生成环境差异报告（可提交 issue） | `dsh-doctor.exe diff`，或菜单 `8` |

面板里的「环境差异报告」和 `dsh-doctor.exe diff` 是同一套逻辑、同一份基线。

## 零环境

- Windows 自包含 `dsh-doctor.exe`：不装 Node、不装命令行；
- 连 Node 都没有：`dsh-doctor-env-win-x64.zip`，自带 `node.exe` + `start.cmd`；
- Linux / macOS：`dsh-doctor-unix.tar.gz`（需要 Node ≥18）。

另有 `doctor-sys.exe`：Rust 写的底层原语引擎（ACL / 完整性标签 / 进程 / 端口 / 通知，JSON over stdio），给想直接操作底层或做守护进程的人用，协议见 [doctor-sys/README.md](../doctor-sys/README.md)。
