# DoL/DoLP Localization Agent Toolkit

Local, offline-first localization engineering toolkit for DoL / DoLP and other
SugarCube / ModI18N targets. It exports, audits, imports, builds, migrates, and
optionally validates localization data; **it does not generate translations**.

面向 DoL / DoLP 及其他 SugarCube / ModI18N 目标的本地、离线优先汉化工程工具。
它负责导出、检查、导入、构建、版本迁移与可选真机验证；**工具本身不生成译文**。

**Project background, motivation & acknowledgements / 项目介绍、开发初衷与致谢**

[English full text](docs/PROJECT-BACKGROUND-AND-ACKNOWLEDGEMENTS.en.md) · [中文全文](docs/项目介绍、开发初衷与致谢.md)

功能与开发动机、网页翻译编辑器、使用前提、参考项目和完整致谢 / Features, project motivation, browser-based translation editor, requirements, references, and acknowledgements.

## 📝 Translation editor / 可视化翻译编辑器

**[Download the offline HTML editor / 下载离线翻译网页](dolp-kit-translation-editor.html)** · [中文使用指南](docs/翻译编辑器使用指南.md) · [中文完整功能说明](docs/网页翻译工具使用指南.md) · [English user guide](docs/KIT-EDITOR-GUIDE.en.md)

**EN:** No spreadsheet required. Download the single HTML file from GitHub (**Download raw file**) and open it locally in Chrome / Edge — everything stays in your browser. Beyond the basics (import a Kit ZIP, edit source/translation pairs, keyword glossary, hand off another translator's matching ZIP/JSONL, export a filled ZIP) the editor now includes: draft autosave with recovery points and a restore / use-imported / export-backup choice; undo / redo for every edit (single edit, copy source, keyword replace, batch import, status marks); a safety check (placeholder count / order / match, stray macros, variables and tags) that only reports and locates; search plus advanced filters (untranslated / translated / needs proofreading / proofread / flagged / has safety issues / contains a term / translation conflict / duplicate source); project-wide progress statistics and per-entry status marks + notes; terminology consistency checking; duplicate-source detection with a fill-blanks-only action; safe hand-off merge (fill blanks / keep current and skip conflicts / preview each conflict / overwrite after confirmation); and new-version translation migration. Pagination shows up to nine centred page numbers with previous / next and a numeric jump box (Enter supported) in both a top and a bottom bar that share one page state. New-version migration matches by stable ID + protected source and only fills blanks. Status marks, notes and ignored terms live in a separate `*.dolpkit.json` project file and the browser draft, never in the game pack. Run the toolkit's `kit import` → `qa` → `strict build` afterward.

**中文：** 不用面对拥挤的 CSV。下载根目录的单文件 HTML（在 GitHub 页面选“下载原始文件”），用 Chrome / Edge 本地打开，所有文件只在本地处理。除基础知识（导入 Kit ZIP、逐条翻译、关键词词典、合并同源 ZIP/JSONL、导出填好的 ZIP）外，编辑器现已包含：草稿自动保存与多个恢复点（可选择恢复草稿 / 使用导入文件 / 先导出草稿备份）；覆盖所有编辑的撤销 / 重做（单条编辑、复制原文、术语替换、批量导入、状态标记）；安全检查（占位符数量 / 顺序 / 匹配，以及译文里意外的宏 / 变量 / HTML 标签，只提示并定位）；搜索与高级筛选（未翻译 / 已翻译 / 待校对 / 已校对 / 存疑 / 存在安全问题 / 包含指定术语 / 存在翻译冲突 / 存在重复原文）；整包进度统计与逐条状态标记 + 备注；术语一致性检查；重复原文识别（仅填空白）；安全合并（只填空白 / 保留当前跳过冲突 / 预览冲突逐条选择 / 确认后覆盖）；新版本翻译迁移。分页在顶部与底部各有一套同步导航，最多 9 个居中页码，保留上一页 / 下一页并支持数字跳页（可回车），共享同一页码状态。状态、备注与忽略项只保存在独立的 `*.dolpkit.json` 工程文件和浏览器草稿里，绝不写入游戏翻译包。最后仍须经过 Toolkit 的 `kit import` → `qa` → `strict build` 检查。

更多说明 / More: [翻译数据安全与恢复说明](docs/翻译数据安全与恢复说明.md) · [多人合并与版本迁移指南](docs/多人合并与版本迁移指南.md) · [功能增强测试报告](docs/功能增强测试报告.md)

## Quick start / 快速开始

Choose what you want to do, open the prompt in your language, copy the whole
prompt, and send it to your coding agent.

选择你要做的事情，打开对应语言的提示词，复制整段并发送给你的 Coding Agent。

| Task / 任务 | English | 中文 |
| --- | --- | --- |
| Start a localization from scratch / 从零开始新的汉化 | [Open prompt](docs/PROMPTS.en.md#new-localization) | [打开提示词](docs/PROMPTS.zh-CN.md#new-localization) |
| Audit or continue an existing localization / 检查或继续已有汉化 | [Open prompt](docs/PROMPTS.en.md#audit-existing) | [打开提示词](docs/PROMPTS.zh-CN.md#audit-existing) |
| Migrate to a new game version / 迁移到新游戏版本 | [Open prompt](docs/PROMPTS.en.md#version-migration) | [打开提示词](docs/PROMPTS.zh-CN.md#version-migration) |
| Build and QA an existing localization / 构建并检查已有汉化 | [Open prompt](docs/PROMPTS.en.md#build-and-qa) | [打开提示词](docs/PROMPTS.zh-CN.md#build-and-qa) |
| Run optional on-device validation / 进行可选真机验证 | [Open prompt](docs/PROMPTS.en.md#runtime-validation) | [打开提示词](docs/PROMPTS.zh-CN.md#runtime-validation) |

> The prompt workflows can start from an empty folder: the agent is instructed
> to clone this repository, read the public contract, and keep user data out of
> Git history.
>
> 这些提示词可以从空文件夹开始：Agent 会自行克隆仓库、读取公开工作流，并避免把
> 用户汉化数据提交进 Git 历史。

## Full documentation / 完整说明

- [English README](README.en.md)
- [中文 README](README.zh-CN.md)

Technical reference lives under [`docs/`](docs/). Runtime validation is optional
and only runs when explicitly requested.

详细技术文档位于 [`docs/`](docs/)。真机验证为可选功能，只会在用户明确要求时运行。
