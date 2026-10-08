# DoL/DoLP Localization Agent Toolkit

[English README](README.en.md) · [English prompts](docs/PROMPTS.en.md) · [中文提示词](docs/PROMPTS.zh-CN.md)

这是一个用于维护 SugarCube / ModI18N 游戏汉化的本地、离线优先工具包。
它可以分析目标游戏文本、导出待翻译内容、检查已有汉化、导入用户译文、
构建汉化包、把旧版本汉化迁移到新版本，并可选地在真实 Android 设备上验证结果。

它的定位是 **汉化工程工具（localization engineering toolkit）**。
它负责保护游戏结构和统计覆盖率；**实际译文由用户自己提供**。

**想了解项目为什么做、主要目标和完整致谢？** 请阅读 [项目介绍、开发初衷与致谢](docs/项目介绍、开发初衷与致谢.md)。其中也包含网页翻译编辑器的说明与相关参考项目链接。

## 可视化翻译编辑器（单文件网页）

**[打开 / 下载翻译编辑器 HTML](dolp-kit-translation-editor.html)** · [中文使用指南](docs/翻译编辑器使用指南.md) · [English guide](docs/KIT-EDITOR-GUIDE.en.md)

不习惯直接编辑 CSV / JSONL？可以下载仓库根目录的 `dolp-kit-translation-editor.html`，用 Chrome 或 Edge **在本地打开**（在 GitHub 文件页点击 *Download raw file*）。它是一个无需服务器、无需安装的独立网页，内置 ZIP 读写库；**不会向网络上传 Kit 或译文**。

- 直接打开 `localization-kit-xxx.zip`，只看到原文、占位符和大尺寸译文框；支持中 / 英界面、搜索、分页、未翻译优先与暗色模式。
- 每条或整包复制原文到译文框；可管理关键词词典并手动替换（独立导入 / 导出 JSON）。
- 支持把其他译者交回的**同一批条目**的 ZIP / `segments.jsonl` 按 `unitId` 合并；默认只填空白，覆盖已有译文需确认。
- 导出新 ZIP 时同步 `segments.jsonl` / `segments.csv`，不覆盖原压缩包；草稿和词典存于浏览器本地，**请定期导出文件备份**。

**注意：** 复制原文不等于已完成翻译；占位符提醒也不是完整结构 QA。正式导入和发布仍需 `kit import → qa → strict build` 检查。Toolkit **不负责生成译文**。

## 从可直接发送的 Agent 提示词开始

如果你使用 Coding Agent，并不需要先记住所有 CLI 命令。选择和自己情况对应的任务，
复制整段提示词发送给 Agent 即可：

| 任务 | 提示词 |
| --- | --- |
| 从零开始新的汉化 | [打开提示词](docs/PROMPTS.zh-CN.md#new-localization) |
| 检查或继续已有汉化 | [打开提示词](docs/PROMPTS.zh-CN.md#audit-existing) |
| 迁移到新游戏版本 | [打开提示词](docs/PROMPTS.zh-CN.md#version-migration) |
| 构建并检查已有汉化 | [打开提示词](docs/PROMPTS.zh-CN.md#build-and-qa) |
| 进行可选真机验证 | [打开提示词](docs/PROMPTS.zh-CN.md#runtime-validation) |

这些提示词允许 Agent 从一个完全空的文件夹开始：它会自行克隆本仓库、读取公开工作流，
并只在确实需要时向你索要目标游戏或汉化文件。

## 它不是什么

- 它**不会生成译文**。仓库内没有机器翻译、AI 翻译后端，也没有自动翻译提示词流水线。
- 它**不会附带游戏正文、用户译文、翻译记忆库（TM）或 verified translation cache**。
- 导入的用户译文仍然只是用户自己的本地数据。工具不会跨项目自动复用，也不会把它们
  变成跨项目翻译记忆库。

## 运行要求

- Node.js >= 22。离线工具本身没有 npm 依赖。
- toolkit 真正读取的目标文件是游戏编译后的
  `assets/www/index.html`。本文档把这个文件简称为 **目标 story**。
  它里面包含已经编译进 SugarCube 的 story / passage，也是 inventory、
  导出、QA、构建和迁移时用来判断“当前游戏版本内容”的基准。
  - 如果你已经有解包后的游戏目录，直接把 `--story` 指向其中的
    `assets/www/index.html` 即可。
  - 如果手里只有 APK，Coding Agent 可以用普通压缩/归档工具只提取
    `assets/www/index.html` 到 `_work/` 后再交给 toolkit。
    这只是准备输入文件，不是 toolkit 自己提供的 APK 提取命令。
  - 仓库中的 `examples/story/index.html` 是 synthetic 测试文件，
    只用于离线演示，不能代替真实 DoL / DoLP 目标版本的 story。
- 可选真机验证：真实设备运行需要 `adb`。
  Google Android CLI 和
  [Paisley Park](https://github.com/102326/DoL-Dev-Tools-Paisley-Park)
  只是 inspect / 截图 / 备份证据等附加功能需要，并非普通真机 smoke 的硬性依赖。

## 五种主要工作流

| 模式 | 主要命令 | 用途 |
| --- | --- | --- |
| 导出全部文本 | `kit export --scope all` | 导出当前目标版本中的全部可翻译单元 |
| 检查已有汉化 | `audit`，再配合 `kit export --scope missing` / `changed` | 找出缺失或已经过期的文本 |
| 导入并构建 | `kit import`，再运行 `qa` 和 `build` | 重新验证用户译文并构建汉化包 |
| 版本迁移 | `migrate` | 在结构仍然安全匹配时，把旧版本汉化状态迁移到新目标 |
| 真机验证 | `runtime/` 下的脚本 | 可选地把 smoke 子集安装到真实设备并验证显示结果 |

辅助能力还包括目标/版本识别、canonical inventory、文本分类、确定性的 structure cache、
结构保护、ReplacePatcher planner/replay 检查，以及覆盖率统计。

## 快速开始（离线 CLI）

v1 的 CLI 入口是：

```bash
node core/src/run.mjs ...
```

本节中的命令全部是离线操作，不会探测 ADB，也不会连接设备。

```bash
node core/src/run.mjs selftest
node core/src/run.mjs --help

node core/src/run.mjs inventory \
  --story <target>/assets/www/index.html \
  --out _work/inventory.json

node core/src/run.mjs kit export \
  --story <target>/assets/www/index.html \
  --output _work/kit.zip \
  --scope all

# 在导出的 kit 中填写 translation 字段，然后：
node core/src/run.mjs kit import _work/kit-filled.zip \
  --story <target>/assets/www/index.html \
  --out _work/state.jsonl

node core/src/run.mjs qa \
  --story <target>/assets/www/index.html \
  --state _work/state.jsonl \
  --report _work/qa.json

node core/src/run.mjs build \
  --story <target>/assets/www/index.html \
  --state _work/state.jsonl \
  --output _work/pack.mod.zip \
  --mode strict
```

### 大规模汉化

真实目标可能超过 100,000 个 segment。下面两个便利功能让大规模人工翻译更可行，
同时完全不改变任何检查：

```bash
# 一次性分片导出：一次运行产出多个相互独立的 kit 和 index.json。
node core/src/run.mjs kit export \
  --story <target>/assets/www/index.html \
  --scope all \
  --chunk-size 5000 \
  --output-dir _work/kits

# import 始终完整扫描整个 kit，并把所有问题集中成一个 repair kit。
node core/src/run.mjs kit import _work/kit-filled.zip \
  --story <target>/assets/www/index.html \
  --out _work/state.jsonl \
  --require-complete \
  --report _work/import-report.json \
  --repair-output _work/repair-kit.zip
```

分片导出是可选项：不传 `--chunk-size` 时，导出行为与之前完全一致（单个
`--output <kit.zip>`）。repair kit 只包含 rejected / deferred / conflict 的单元，
并附带 `issues.jsonl`；修好后直接把这一小包重新 import 到同一个 `state.jsonl`。
两种模式都不会削弱 placeholder、reversible、V3 结构、planner 或 replay 检查，
`--require-complete` 在仍有 blocker 时依然失败。

如果只想在没有真实游戏和译文的情况下跑通演示：

```bash
node examples/run-example.mjs
```

仓库内示例使用的是 synthetic、非中文伪语言，只用于证明离线流水线能跑通；
它并不是 DoL / DoLP 的真实汉化包。其中的 `examples/story/index.html`
也只是测试用 story，真实汉化时不能把它当作 `--story` 输入。

## 覆盖率与构建模式

当前目标中的每一个单元都会被归入下面某一种状态：

| 状态 | 含义 | strict 构建 |
| --- | --- | --- |
| `translated-valid` | 用户译文已经通过当前结构 QA | PASS |
| `untranslated` | 当前目标中存在该单元，但没有有效译文 | FAIL |
| `rejected-structure` | 译文没有通过 placeholder / reversible / 结构检查 | FAIL |
| `superseded` | 源文本已经变化，旧译文失效 | FAIL |
| `unresolved` | 译文本身有效，但 patch planner 无法安全放置 | FAIL |
| `obsolete` | 记录属于当前目标中已经不存在的内容 | 不阻塞 |

`strict` 只要存在任何阻塞状态，就不会生成可误认为完整包的成功结果，并返回非零退出码。
`partial` 只构建 `translated-valid` 单元，报告会明确标记为 partial，适合迭代，不适合作为发布包。

导出时，`missing` 是 `untranslated` 的导出侧名称，`changed` 是 `superseded` 的导出侧名称。

## 主要概念

- **Structure cache** — 针对某个目标 story 的确定性结构缓存，只保存机器推导出的结构信息。
  它不包含译文，并且只有在目标 story identity 一致时才能复用。
- **Localization kit** (`kit.zip`) — 用于交给外部翻译流程的文件，包含受保护的源文本、
  placeholders、可选用户术语表和空的 translation 字段。
- **Localization state** (`state.jsonl`) — 已接受的用户译文及其 provenance。
  它是用户本地数据，不是翻译记忆库。
- **Pack** (`*.mod.zip`) — 根据验证通过的汉化数据生成的 ReplacePatcher addon。

## 真机验证（可选）

真机验证是一条独立、需要用户明确要求才会执行的流程：

```bash
node runtime/localization_smoke_build.mjs --story <index.html> --state <state.jsonl>
node runtime/android/doctor.mjs
node runtime/android/test-localization-runtime.mjs --level smoke
```

真实设备 smoke 需要**真实目标 story**和用户自己的汉化数据（`state.jsonl` 或用户提供的汉化包）。
仓库内 synthetic 示例只能用于离线 E2E，不能直接拿去给任意真实目标做真机验证。

Tier-A runtime 断言与具体语言无关：

- `expectTargetAny` — 至少一个预期目标语言字符串必须实际显示出来。
- `forbidSourceAny` — 被禁止残留的源语言字符串不得继续显示。

script ratio、词数、pronoun count 等只作为 diagnostic，不参与 PASS / FAIL。
详见 [Runtime Validation](docs/RUNTIME-VALIDATION.md)。

## 目标与参数化

工具不会把 package id、device serial、游戏安装路径、ModLoader 版本或目标 identity 写死。
和具体目标有关的值都由用户通过 CLI、本地配置或环境变量提供。

## 测试

```bash
node core/src/selftest.mjs
node --test core/test/*.test.mjs
node --test runtime/android/test/*.test.mjs
node examples/run-example.mjs
```

## 当前状态与限制

- v1 是源码分发形式，直接用 Node 运行，目前没有 npm release。
- 标准离线流程的核心对象是 passage text。完全由 widget / JavaScript 动态生成的内容，
  可能仍然需要单独做 runtime 检查。
- 真机验证目前面向 Android + ModLoader；离线 core 本身不依赖平台。

## 目录结构

```text
core/src/lib/     结构核心 + 汉化工作流
core/src/run.mjs  离线 CLI 入口
runtime/          可选真机汉化验证
schemas/          公开 artifact 的 JSON schema
examples/         synthetic 非中文伪语言示例
docs/             工作流与技术参考文档
```

常用参考文档：

- [Toolkit overview](docs/TOOLKIT-OVERVIEW.md)
- [Agent workflow](docs/AGENT-WORKFLOW.md)
- [CLI options](docs/OPTIONS.md)
- [Localization kit](docs/LOCALIZATION-KIT.md)
- [Version migration](docs/VERSION-MIGRATION.md)
- [Protection rules](docs/PROTECTION-RULES.md)
- [Runtime validation](docs/RUNTIME-VALIDATION.md)
- [新工作区从零验收指南](docs/新工作区从零验收指南.md) — 给没有历史上下文的 Agent 的端到端流程
- [Paisley Park 3.0.2 接入与验收](docs/Paisley-Park-3.0.2-接入与验收.md) — 外部真机工具的可选接入

## 许可证

MIT。详见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。
