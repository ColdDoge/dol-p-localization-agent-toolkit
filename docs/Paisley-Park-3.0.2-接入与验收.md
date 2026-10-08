# Paisley Park 3.0.2 接入与验收

面向本工具链的验收记录：**DoL Dev Tools: Paisley Park 3.0.2 "Gold Experience Requiem"**
（上游：<https://github.com/102326/DoL-Dev-Tools-Paisley-Park/releases/tag/v3.0.2>）。

本文只记录**本工具链侧**的接入方式与实测结论。上游用法请看它自己的
`README.md` / `docs/DIAGNOSTICS.md` / `docs/SKILL_INSTALL.md`，本文不复制。

---

## 1. 安装位置与校验

| 项 | 值 |
| --- | --- |
| 版本 | **3.0.2**（`package.json` → `version`、`releaseName: Gold Experience Requiem`） |
| 安装目录 | `%REPO%/_local/devtools/DoL-Dev-Tools-Paisley-Park-3.0.2/`（`_local/` 已被 gitignore） |
| 旧版保留 | `%REPO%/_local/devtools/DoL-Dev-Tools-Paisley-Park/`（2.0.0），**未覆盖** |
| 下载物 | `_local/devtools/_downloads/DoL-Dev-Tools-Paisley-Park-3.0.2.zip`（780,452 B） |
| sha256 | `0c799eff6abf862289b75bc65cd33883bfb6f69352fb8943e455442fb2158f77` |
| 校验结果 | Release 的 `SHA256SUMS.txt`、GitHub API 的 asset `digest`、本地 `Get-FileHash` **三者一致** |

安装要点（踩过的坑）：**Release 压缩包里没有顶层目录**，直接解压会把内容散落到目标目录。
请先建一个专用空目录再解压，或解压后立刻把内容移进去。上游要求目录名使用
`DoL-Dev-Tools-Paisley-Park`（不要带产品名里的冒号）；本机为了与 2.0.0 并存使用了
`DoL-Dev-Tools-Paisley-Park-3.0.2`，功能不受影响（Skill 安装时会记录真实路径）。

## 2. 依赖

按上游 README 的"最快开始"执行，未额外安装任何全局组件：

```powershell
# 在 3.0.2 目录里（Gameplay 需要锁定的 XState）
npm ci --ignore-scripts --no-audit --no-fund
```

本机 `doctor` 结果（`artifacts/doctor.json`）：

| 检查 | 结果 |
| --- | --- |
| node（必需） | 22.20.0，`supported: true`（要求 ≥ 22.12） |
| adb（必需） | 1.0.41 |
| devices（必需） | `connected: 1` |
| python（可选） | 3.13.7 |
| android-cli（可选） | 1.0.16486076 |
| scrcpy（可选） | 不可用（ENOENT），不影响本轮只读采集 |
| output-parent（必需） | 可写 |

整体 **status = complete**；`node:sqlite` 在 Node 22 下需要 `--experimental-sqlite`，
Windows 启动器已自带该参数。

## 3. Skill 安装

宿主为 Codex（skill 目录 `~/.codex/skills`）。安装前确认**目标目录不存在**（不会覆盖已有 Skill）：

```powershell
node scripts/dol-dev.cjs install-skill --out "$env:USERPROFILE/.codex/skills/dol-dev-tools-paisley-park"
node "$env:USERPROFILE/.codex/skills/dol-dev-tools-paisley-park/scripts/resolve.cjs"
```

解析器输出（本机实测）：`version: 3.0.2`、`cli` 与 `docs` 指向 3.0.2 安装目录，
并自述 `location only; not a code trust guarantee`。工具包必须留在原位置；
移动后请设置 `DOL_DEV_TOOLS_HOME` 并用解析器重新核对。

> 本轮只做"安装 + 解析器验证"。宿主是否在自然语言提示下自动触发该 Skill，
> 需要**下一个回合**才能观察（安装器明确说明"available on the next turn"）。

## 4. 真机只读验收（已完成）

设备：一台 Samsung Galaxy A34（Android 16）；目标包：用户自备的 DoLP 重打包（debug）包
（真实 serial 与包名只写在 gitignore 的本地配置与报告中，不进入仓库）。
全部步骤**只读**：未安装辅助 APK、未写游戏状态、未改动存档。

| 步骤 | 命令 | 结果 |
| --- | --- | --- |
| 环境 | `doctor --out artifacts/doctor.json` | complete，必需项全部可用 |
| CDP 目标 | `inspect --endpoint http://127.0.0.1:50806 --out artifacts/targets.json` | 1 个 target，`debuggerAvailable: true` |
| 环境采集 | `environment --serial … --package … --target-id <ID> --out artifacts/env-001` | complete |
| 截图 | `capture --serial … --package … --out artifacts/capture-001` | complete，得到 screenshot.png |
| 现场证据 | `evidence --serial … --package … --target-id <ID> --scope '#passages' --out artifacts/evidence-001` | complete，见下 |

证据目录：`%TOOLS%/artifacts/evidence-001/`（app / cdp / console / device / dom-contract /
gfxinfo / meminfo / network / screenshot / transport / transport-cleanup / versions / webview）。

实测到的能力：

* **连上 DoLP 的 WebView**：`webview.json` → Chrome/154.0.8037.106、protocol 1.3、viewport **384×790**；
* **读到可信场景结构**：`dom-contract.json` 的根节点是 `div#passages`，其下
  `div#passage-start2.passage.nosave.exitcheckbypass`，再下层是 `br` 与
  `a.link-internal.macro-link` —— 与本工具链 harness 当时看到的 passage（`Start2`）一致；
* **版本来源分列**：`versions.json` → `loaderVersion: 2.101.1`（正确），
  `gameVersion: null`；CLI 明确写"Game version: unknown (CDP GameVersion);
  wrapper App version: 0.5.12.8 (ADB package versionName)"，即**没有把打包版本冒充游戏版本**；
* **隐私与清理**：`device.json` 的 `serial` 为 `[omitted]`；`network.json` 不存 URL/正文、
  主机名做哈希；`transport.json` 显示临时转发，`transport-cleanup.json` = `{"removed": true}`；
* **不夸大成功**：CLI 每次都提示"status describes requested collection steps，不是内容全覆盖也不是功能验收"，
  DOM 因 `maxNodes: 500` 截断时明确写 `truncationReasons: ["max-nodes"]`。

### 4.1 发现的上游限制（不是设备问题，也不是调用方式问题）

| 现象 | 含义 | 处置 |
| --- | --- | --- |
| `inspect` 报 `standardDoLTitle: false` | 上游按"页面标题恰好是 `Degrees of Lewdity`"挑选 CDP 页面；DoLP 的标题是 `Degrees of Lewdity Plus` | **必须显式传 `--target-id`**（用 `inspect` 拿到的 ID）。上游 `docs/DIAGNOSTICS.md` 已把"不同页面标题"列为支持限制 |
| `versions.json` 的 `gameVersion: null` | 上游从 CDP 读不到 DoLP 的游戏版本常量 | 仅影响"游戏版本"一栏；`loaderVersion` 与 ADB 包版本正常。本工具链的版本身份仍以 story sha256 为准（见下） |

### 4.2 失败时是否干净退出

负面测试：把 `--package` 换成一个不存在的包 →
输出 `Evidence partial`，**exit code 1**（不伪装成功），仍写出 manifest 说明是部分采集；
随后 `adb forward --list` 只剩本工具链自己的那条转发，未留残余。符合"失败可正常退出并释放资源"。

### 4.3 与现有 harness 是否冲突

互不干扰，实测：

* Paisley Park 用**自己的临时转发**，采集完即删除；本工具链的
  `adb forward tcp:50806 → localabstract:webview_devtools_remote_<pid>` 全程保留；
* Paisley Park 运行结束后，本工具链 harness 的 `game-status` / `modloader-status` 探针
  仍返回 `passage=Start2`、`title=Degrees of Lewdity Plus`、`bodyErrors=0`、`modUtilsVersion=2.101.1`；
* 两者的诊断口径不同，**不可互相替代**：harness 统计 DOM 里的 `.error` 节点；
  Paisley Park 的 `console.json` 是 Console 事件窗口（本轮含 1 条 `error` 级事件，正文按策略省略）。

### 4.4 本轮未做

* **Action / Journey / Gameplay**（含 `game-goal-*`、`game-open-wardrobe` 等）：按上游要求
  需要"受支持的测试环境 + 明确授权"。本轮**只评估、未执行**，也不安装任何辅助 APK。
* CSS / storage / timeline / perf 等可选采集：未做，需要时按上游 `--css yes` 等开关单独跑。

## 5. 接入方式：只用配置，不写适配层

结论：**不需要适配代码**。两种用法各自独立：

1. **Paisley Park 自己**：命令行直接使用；在 DoLP 上记得 `--target-id`。
   输出写到工具目录下的 `artifacts/`（在 `_local/` 里，已被 gitignore）。
2. **本工具链的 harness**：`_local/android-config.local.json` 的 `devToolsPath`
   指向 3.0.2 安装目录即可复用其备份脚本：

   ```jsonc
   { "devToolsPath": "…\\_local\\devtools\\DoL-Dev-Tools-Paisley-Park-3.0.2" }
   ```

   实测 `node runtime/android/backup.mjs --label …` 用 3.0.2 的
   `scripts/adb-backup-app-data.py` 成功产出备份（30,768,640 B / 362 members）。

**不要**把 Paisley Park 源码复制进本仓库；它是外部工具，靠配置与 Skill 引用。
离线汉化（inventory / kit / import / qa / build）**不依赖** Paisley Park。

## 6. 复现清单（最小）

```powershell
# 1) 解压到专用空目录（压缩包无顶层目录）
Expand-Archive -LiteralPath DoL-Dev-Tools-Paisley-Park-3.0.2.zip -DestinationPath <空目录>
# 2) 校验
Get-FileHash DoL-Dev-Tools-Paisley-Park-3.0.2.zip -Algorithm SHA256   # 对比 SHA256SUMS.txt
# 3) 依赖与自检
npm ci --ignore-scripts --no-audit --no-fund
.\Paisley-Park.cmd --version
.\Paisley-Park.cmd doctor --out artifacts/doctor.json
# 4) 只读现场（DoLP 必须显式 target id）
adb forward tcp:50806 localabstract:webview_devtools_remote_<PID>
.\Paisley-Park.cmd inspect --endpoint http://127.0.0.1:50806 --out artifacts/targets.json
.\Paisley-Park.cmd evidence --serial <SERIAL> --package <PKG> --target-id <ID> --scope '#passages' --out artifacts/evidence-001
```
