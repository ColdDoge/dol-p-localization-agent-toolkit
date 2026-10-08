# DoL/DoLP Localization Agent Toolkit

Local, offline-first localization engineering toolkit for DoL / DoLP and other
SugarCube / ModI18N targets. It exports, audits, imports, builds, migrates, and
optionally validates localization data; **it does not generate translations**.

面向 DoL / DoLP 及其他 SugarCube / ModI18N 目标的本地、离线优先汉化工程工具。
它负责导出、检查、导入、构建、版本迁移与可选真机验证；**工具本身不生成译文**。

**[项目介绍、开发初衷与致谢（中文全文） / Project background & acknowledgements](docs/项目介绍、开发初衷与致谢.md)** — 包括项目动机、完整功能概览、网页翻译工具、使用前提、参考项目与感谢名单。

## 📝 Translation editor / 可视化翻译编辑器

**[Download the offline HTML editor / 下载离线翻译网页](dolp-kit-translation-editor.html)** · [中文使用指南](docs/翻译编辑器使用指南.md) · [English user guide](docs/KIT-EDITOR-GUIDE.en.md)

**EN:** No spreadsheet required. Download the single HTML file from GitHub (**Download raw file**) and open it locally in Chrome / Edge. Import a Kit ZIP, edit source/translation pairs, copy source text, apply a keyword glossary, merge another translator's matching ZIP/JSONL, and export a filled Kit ZIP. Files stay in your browser; run the toolkit's import and QA afterward.

**中文：** 不用面对拥挤的 CSV。下载根目录的单文件 HTML（在 GitHub 页面选“下载原始文件”），用 Chrome / Edge 本地打开即可导入 Kit ZIP、逐条翻译、复制原文、管理关键词及合并别人交接的同源 ZIP/JSONL，最后导出填好的 ZIP。所有文件在浏览器本地处理；**最终仍须经过 Toolkit 导入与 QA**。草稿与词典请定期备份。

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
