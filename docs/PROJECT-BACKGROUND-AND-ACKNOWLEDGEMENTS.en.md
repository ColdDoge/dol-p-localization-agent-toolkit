# DoL / DoLP Localization Agent Toolkit: Project Background, Motivation & Acknowledgements

[Repository home](../README.md) · [English README](../README.en.md) · [中文版 / Chinese version](项目介绍、开发初衷与致谢.md) · [Translation editor guide](KIT-EDITOR-GUIDE.en.md)

Project repository: https://github.com/ColdDoge/dol-p-localization-agent-toolkit

> **Note:** This is an independent third-party localization toolkit and automation experiment. It is **not affiliated with existing DoL / DoLP translation teams**. This repository **does not provide ready-made localization packs, game APKs, or translated game text**. If a localization pack generated with this toolkit has problems, please report them to this project rather than to an existing translation team.

## What this project provides

This is a local, offline-first localization engineering toolkit for DoL / DoLP and other compatible SugarCube / ModI18N workflows. Its main capabilities include:

- Extracting and categorizing translatable text from target game files;
- Auditing the coverage of an existing localization and identifying untranslated, changed, or otherwise actionable text;
- Exporting translation kits and importing translations completed by people or external translation workflows;
- Protecting game structures such as placeholders, macros, variables, and HTML as far as possible, with structural checks and QA;
- Building localization Mods from validated data and reporting build blockers;
- Checking whether older translations can be safely carried forward after a game update, and distinguishing reusable text from work that needs attention;
- Optionally running automated validation on a real Android device to check how localized text is displayed in-game.

**The toolkit does not translate text itself.** Translations can be written by people or produced using any external translation tools or coding agents chosen by the user. The toolkit handles the engineering around extraction, structure protection, import, building, migration, and debugging.

## Included browser-based translation editor

**[Download the standalone HTML editor](../dolp-kit-translation-editor.html)** · [English guide](KIT-EDITOR-GUIDE.en.md) · [中文指南](翻译编辑器使用指南.md)

Editing CSV or JSONL by hand can be inconvenient, especially for people who are unfamiliar with those formats. The project therefore includes a standalone browser-based editor: `dolp-kit-translation-editor.html`.

On the GitHub file page, choose **Download raw file**, save the HTML file, and open it locally in Chrome or Edge. No installation, web server, or Node.js is required. The page reads, processes, and exports files locally in your browser; it does not upload translation kits or translated text to a remote translation service.

Main features:

- Import Kit ZIP files exported by the toolkit, read protected source text, and fill in translations entry by entry;
- Chinese and English interfaces, search, filters, pagination, original/untranslated-first ordering, font-size controls, and light/dark themes;
- Copy protected source text into the corresponding translation field, either one entry at a time or for the entire kit, for test translations or to preserve source structure while editing;
- Manage a personal keyword glossary and explicitly apply replacements to individual translation entries, with separate JSON import/export;
- Merge a translated ZIP or `segments.jsonl` handed back by another translator **for the same set of entries**, after identity checks. By default only empty translations are filled; overwriting differing existing translations requires confirmation;
- Export an updated ZIP or `segments.jsonl`. Relevant translation fields in the ZIP are kept in sync, and the original archive is not overwritten;
- Store translation drafts and glossary data locally when the browser permits it.

**Important:** A browser draft should never be your only backup: export translation ZIPs and glossary JSON files regularly. Copying source text does not mean a translation is complete, and the editor's placeholder hints are not a substitute for the toolkit's complete structural QA. Before formal import, building, and publication, the regular import, QA, and build steps are still required. The editor has no built-in AI translation feature.

## Why I started this project

I used AI assistance and automation tools extensively while developing this project, including ChatGPT, Codex, and other agents, mainly for source-code investigation, tool development, text processing, static QA, and automated debugging. But **AI translation itself is not the main goal of this project**.

In terms of translation quality, I still see a considerable gap between today's AI translations and mature human-made localizations. AI output can sound stiff or formulaic, with a recognizable "AI-written" tone, and often struggles with individual character voices, a work's writing style, and particularly forceful or expressive language.

What I would rather build is an automation-oriented localization toolchain that is reasonably approachable for ordinary users. For example:

1. Give an agent a target game file, APK, or extracted `index.html`, and have it handle target identification, text extraction, categorization, structure protection, and preparation of translation kits as automatically as possible;
2. Once a person or external tool has completed the translation, import it again and let the toolkit check structure, coverage, and conflicts before building the localization pack;
3. After a game update, identify which existing translations can safely be reused and which need attention, reducing repetitive work;
4. Once a build is ready, optionally perform automated checks on a real device, collecting failures for further inspection and fixes.

These are the aims and direction of the workflow. They do **not** mean that every game version, every string, or every runtime issue can be handled completely automatically. This is still an experimental project under development.

Another reason I began thinking about this was seeing some non-Chinese DoL localizations fall far behind game updates. Even when people are willing to translate and maintain a version, learning ModI18N, the source structure, variables and macros, patch building, version migration, and Android debugging can be a very high technical barrier.

I hope to reduce the amount of time that individual translators, maintainers of smaller language communities, and people who simply want to practice translation must spend on this engineering work. The toolkit is not limited to Simplified Chinese; where the workflow applies, it can support localization into other languages too.

**The goal is to let people who want to translate spend more of their time on translation itself, rather than having to learn a large localization engineering and debugging workflow first.**

If you dislike AI-generated translations, you can still use text extraction, categorization, import, QA, building, version migration, and debugging independently. And if an existing, mature human translation already meets your needs, there is no reason to switch to an AI-generated one just to use this tool.

## Getting started

The repository provides [English agent prompts](PROMPTS.en.md) and [Chinese agent prompts](PROMPTS.zh-CN.md) grouped by task: starting a localization from scratch, auditing an existing one, migrating to a new game version, building and running QA, and optionally validating on a device.

If you use a coding agent, you can start from an **empty working directory** and send it the complete prompt for your task. An agent capable of reading/writing files and running commands can retrieve the toolkit, follow its public workflow documentation, and request target files only when needed. You can also work entirely without an agent by following the [English README](../README.en.md) and CLI documentation.

Depending on the task, you may need:

- **Node.js 22 or newer** to run the offline toolkit;
- **Target game files**: the actual input is usually the compiled `assets/www/index.html`. If you only have an APK, that file can be extracted first;
- **A ModLoader compatible with the target version** to actually load generated Mods and perform relevant runtime checks;
- **ADB and an Android device with USB debugging enabled**, only if you choose to perform on-device debugging;
- **An agent environment that can read/write local files and run commands**, only if you want an agent to execute the workflow.

**Offline extraction, auditing, importing, migration, and building do not require a connected phone or ADB.** The repository does not provide game APK downloads or general APK installation support. Users must obtain their own game files and a compatible ModLoader.

For complete options, workflows, and limitations, see the [English README](../README.en.md), [Agent workflow](AGENT-WORKFLOW.md), and [Toolkit overview](TOOLKIT-OVERVIEW.md).

## Limits of automated QA

Automated checks mainly cover text coverage, structures such as placeholders/macros/variables/HTML, patch conflicts, migration status, and some runtime issues.

**Passing these checks cannot guarantee that translations are accurate, natural, or appropriate for a character's voice and writing style.** A complete localization still benefits from human review, editing, and in-game verification. Some text generated dynamically by widgets or JavaScript may also require additional handling.

## Tools used during development and testing

Development and testing have used environments such as **ChatGPT Chat / Codex + DeepSeek V4.1 Flash**. These are examples of tools used while building this project, not required dependencies or endorsed choices for everyone. Users can choose other agents or carry out the workflow manually.

## References and acknowledgements

I would like to preserve the names of contributors, related projects, and the links to their original posts. Many thanks to these tool developers, localization authors, and everyone who has continued working on DoL / DoLP localizations.

### Automated debugging tools

Special thanks to **寄寄子102326**:

- [DoL-Dev-Tools-Paisley-Park](https://github.com/102326/DoL-Dev-Tools-Paisley-Park)
- [Original Discord post](https://discord.com/channels/1103864219620884560/1555201606360895548)

This independent third-party tooling was helpful as a reference for optional Android device automation, inspection, and runtime validation. The normal offline localization workflow does not depend on it.

### Localization engineering references

Thanks to **NumberSir, Marisa0v0, ZerxZ, and cphxj123**!

- [vrelnir_localization](https://github.com/NumberSir/vrelnir_localization)
- [Sugarcube2-Localization](https://github.com/NumberSir/Sugarcube2-Localization)

These projects provided valuable references for ModI18N, localization structure, and related rules.

### DoLP localization packs: technical and translation references

I am also grateful for the work of the following DoLP translation authors and projects. Their existing work was a valuable source of learning about localization structure and approaches:

- **丧心**: [Discord post](https://discord.com/channels/1103864219620884560/1547122682653315082)
- **Makinohara24**: [Discord post](https://discord.com/channels/1103864219620884560/1539582441759440987)
- **Angela**: [Discord post](https://discord.com/channels/1103864219620884560/1544762899137040425)

And thank you to everyone who has worked on original DoL, DoLP, and other-language localizations over the years. I appreciate the time and effort you have put in.

These acknowledgements and links **do not imply** that the people or projects named here developed, endorsed, or support this toolkit. Referring to their work does not mean their translations are bundled or redistributed by this repository. See [NOTICE](../NOTICE) for licensing information about third-party software and code.

## Feedback, affiliation, and permissions

- This is an **independent third-party toolkit**, not an official project of any existing translation team. Translations created with this toolkit and external translation services should not be treated as replacements for mature human localizations.
- This repository does not contain the game itself, user translations, or ready-to-install localization packs. Users are responsible for game source files and localization data that they provide.
- Reports of missed text extraction, structural false positives, build conflicts, migration problems, browser editor issues, or actual runtime problems are welcome. Please avoid posting copyrighted game passages or private data in public issue reports.
- If the acknowledgements, references, names, links, or usage described here raise attribution, authorization, or infringement concerns, please contact me so I can review, adjust, or remove the relevant material.

Once again, thank you to everyone whose tools, technical references, and localization work helped make this project possible.
