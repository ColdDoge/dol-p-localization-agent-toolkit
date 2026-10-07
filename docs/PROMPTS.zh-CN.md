# 可直接发送的 Agent 提示词

[English prompts](PROMPTS.en.md) · [English README](../README.en.md) · [中文 README](../README.zh-CN.md)

这里的 5 组预设与公开 toolkit 的 5 条主要工作流一一对应。每一节都使用固定锚点，
因此仓库首页可以直接跳到对应提示词的位置。

选择适合你的任务，复制**整个提示词代码块**并发送给 Coding Agent 即可。
这些提示词特意设计成可以从一个完全空的文件夹开始。

<a id="new-localization"></a>
## 从零开始新的汉化

适合：你已经有目标游戏版本，但还没有现成的 toolkit localization state。

```text
你正在帮助我使用下面这个公开 toolkit 从零开始新的汉化：
https://github.com/ColdDoge/dol-p-localization-agent-toolkit

请以公开仓库本身作为工作契约，并优先保证文件与数据安全。

1. 如果当前目录里还没有 toolkit：
   - 当前目录为空时，直接把仓库 clone 到这里；
   - 当前目录里有无关文件时，新建专用子目录后再 clone；
   - 不要覆盖任何无关的用户文件。
   如果 toolkit 已经存在，只允许 fetch + fast-forward 更新。不要重写本地历史，
   也不要丢弃本地修改。

2. 操作前先阅读 README.md、AGENTS.md、docs/TOOLKIT-OVERVIEW.md、
   docs/AGENT-WORKFLOW.md、docs/LOCALIZATION-KIT.md。

3. 先运行离线自测：
   node core/src/selftest.mjs

4. 找到目标版本编译后的 story（通常是 assets/www/index.html）。
   如果我没有提供，或者无法可靠确定路径，只向我索要这个准确文件/路径，不要猜。

5. 用户文件和生成产物不要进入 Git 历史。优先直接使用外部输入路径，
   或放到已被 gitignore 的 _local/、_work/ 中。

6. 对目标版本做 inventory，然后以 scope=all 导出完整 localization kit。
   如果我提供了 glossary 就带上；没有就正常继续。不要生成、改写或猜测任何译文。

7. 如果我还没有提供填写完成的 localization kit，就在安全交接点停下，并告诉我：
   - 检测到的目标 story identity / 版本信息；
   - inventory / unit 数量；
   - 导出的 kit 路径；
   - 我需要填写并重新交回哪个文件。

8. 如果我已经提供了填写完成的 kit，就继续 import、QA，并尝试 strict build。
   不要静默改成 partial build。strict 失败时，报告 coverage 数量和逐项 blocker。

9. 最后清楚报告这些 coverage state：
   translated-valid、untranslated、rejected-structure、superseded、unresolved、
   obsolete，以及最终输出文件路径。

不要 push、publish、创建 Release，也不要 commit 我的汉化数据。
```

<a id="audit-existing"></a>
## 检查或继续已有汉化

适合：你已经有汉化数据，想确认哪些内容缺失、过期、结构不合法，哪些还能继续使用。

```text
你正在帮助我使用下面这个公开 toolkit 检查或继续已有汉化：
https://github.com/ColdDoge/dol-p-localization-agent-toolkit

1. 如果当前目录里还没有 toolkit，就在空目录/专用目录中 clone。
   如果已经存在，只允许 fetch + fast-forward 更新。
   不要覆盖无关文件，也不要丢弃本地修改。

2. 先阅读 README.md、AGENTS.md、docs/TOOLKIT-OVERVIEW.md、
   docs/AGENT-WORKFLOW.md、docs/OPTIONS.md、docs/LOCALIZATION-KIT.md。
   在读取我的汉化数据之前先运行 node core/src/selftest.mjs。

3. 确认当前目标 story（通常是 assets/www/index.html）以及已有汉化输入。

   audit 支持公开文档中明确写出的格式，优先包括 state.jsonl，或者
   localization source JSON/JSONL / ModI18N TypeB fragment。
   如果我只提供了构建好的 .mod.zip 或其他未支持格式，不要自行发明转换器，
   也不要偷偷逆向。明确告诉我还需要哪一种受支持的 source/state 文件。

4. 我的输入文件不要进入 Git 历史；生成物放在 _work/ / _local/ 或外部工作目录。

5. 针对当前目标运行 audit。至少报告：
   translated-valid、untranslated、rejected-structure、superseded、unresolved、
   obsolete，以及 strict 当前是否能通过。

6. 对仍需处理的内容分别导出工作 kit：
   - scope=missing：尚未翻译的单元；
   - scope=changed：源文本已经变化、旧译文失效的单元。
   不要自行生成译文。

7. 如果出现 rejected-structure 或 unresolved，报告具体原因，
   不要只给一个总数。

8. 如果我同时提供了填好的返回 kit，就继续 import、重新 QA，并尝试 strict build。
   除非我明确要求迭代包，否则不要用 partial build 替代 strict。

9. 最后给我一个简洁状态总结：哪些还能复用、哪些仍需翻译、哪些被阻塞，
   以及导出的 report / kit 路径。

不要 push、publish，也不要 commit 我的汉化数据。
```

<a id="version-migration"></a>
## 迁移到新游戏版本

适合：游戏更新了，并且你手里有旧版本由这个 toolkit 产生的 `state.jsonl`。

```text
你正在帮助我使用下面这个公开 toolkit，把已有汉化迁移到新的目标版本：
https://github.com/ColdDoge/dol-p-localization-agent-toolkit

1. 从干净/专用目录开始。需要时 clone toolkit；已经存在就只做 fetch + fast-forward。
   不要删除或覆盖无关文件。

2. 先阅读 README.md、AGENTS.md、docs/VERSION-MIGRATION.md、
   docs/AGENT-WORKFLOW.md、docs/OPTIONS.md，并先跑离线 selftest。

3. 这条工作流需要我提供：
   - 新版本编译后的目标 story（通常是 assets/www/index.html）；
   - 旧版本由 toolkit 生成的 localization state.jsonl。
   如果缺少任意一项，只向我索要缺失文件并停下。
   不要从不受支持的输入里自行伪造 state 文件。

4. 用户输入和 migration 输出都不要进入 Git 历史。

5. 先 inventory 新目标，再把旧 state migrate 到新的 state。
   只有 toolkit 的 identity 规则判定为安全时才能重定位记录；
   不允许 fuzzy match，也不要猜译文。

6. 对迁移后的新 state 运行 audit。

7. 分别导出：
   - missing kit：尚未翻译的单元；
   - changed kit：旧译文已经失效的单元。
   不要生成译文。

8. 运行 QA。只有 migration 后没有 blocking coverage state 时才尝试 strict build。
   不要静默把 partial build 当成发布结果。

9. 最后报告 migration 数量（kept / moved / obsolete，以及 changed 项）、
   最终 coverage、导出 kit 路径，以及当前是否已经可以 strict build。

不要 push、publish，也不要 commit 我的汉化数据。
```

<a id="build-and-qa"></a>
## 构建并检查已有汉化

适合：翻译工作基本完成，已经有 toolkit state 或填好的 kit，现在主要想做 QA 和构建。

```text
你正在帮助我使用下面这个公开 toolkit 对已有汉化做 QA 和构建：
https://github.com/ColdDoge/dol-p-localization-agent-toolkit

1. 当前目录没有 toolkit 时，就在空目录/专用目录中 clone。
   如果已经存在，只允许 fetch + fast-forward。保留所有无关文件与本地修改。

2. 先阅读 README.md、AGENTS.md、docs/TOOLKIT-OVERVIEW.md、
   docs/PROTECTION-RULES.md、docs/OPTIONS.md，然后运行：
   node core/src/selftest.mjs

3. 确认目标编译后的 story 和我的 localization state.jsonl。
   如果我提供的是填好的 localization kit，就先按文档 import 成 state。
   如果两者都没有，只向我索要准确缺失的输入，不要猜。

4. 所有用户数据、pack、report 都不要进入 Git 历史。

5. 运行 QA 并输出 report。把结构保护问题、planner/replay 问题明确列出来。

6. 尝试 strict build：
   - strict 成功：报告 pack 路径、entry 数量、coverage、QA 结果；
   - strict 失败：不要生成或展示一个 partial 包并把它当成发布结果，
     而是报告 blocking state 和具体原因。

7. 只有我明确要求用于迭代/测试时，才构建 partial；如果构建，必须明显标记 PARTIAL。

8. 不要为了让构建通过而削弱 placeholder、reversible、V3 structural、
   duplicate/overlap 或 replay 检查。

不要 push、publish、创建 Release，也不要 commit 我的汉化数据。
```

<a id="runtime-validation"></a>
## 进行可选真机验证

只适合：你明确希望 Android runtime harness 连接并操作真实设备。

```text
你正在帮助我使用下面这个公开 toolkit 进行可选 Android 真机验证：
https://github.com/ColdDoge/dol-p-localization-agent-toolkit

我发送这段提示词，表示我明确允许你在我提供的设备上执行下面文档化的 runtime validation。
这不代表允许卸载 App、clear app data、删除存档、恢复出厂设置，
也不允许进行与本次 smoke 无关的设备修改。

1. 安全 clone / 同步 toolkit。接触设备前先阅读 README.md、AGENTS.md、
   docs/RUNTIME-VALIDATION.md、docs/RUNTIME-SMOKE-V1.md、
   docs/RUNTIME-QA-MODES.md。

2. 先运行离线 selftest 和 runtime 单元测试：
   node core/src/selftest.mjs
   node --test runtime/android/test/*.test.mjs

3. 一次真实 smoke 需要：
   - 真实 target story；
   - toolkit state.jsonl 或用户提供的 localization package；
   - 目标 package id 和 ADB 能看到的设备。
   缺少任何一项就向我索要。仓库内 synthetic fixture 只能离线使用，
   不允许把它冒充真实目标。

4. package id、device serial、本机工具路径只能放到文档规定的、gitignore 的
   _local/android-config.local.json 或环境变量中，绝不能 commit。
   最终报告里不要打印未遮罩的设备 serial。

5. 先运行 doctor。真机运行把 adb 视为必需项；
   Android CLI 和 Paisley Park 只有在所选 inspect / 证据步骤需要时才是可选依赖。

6. smoke 子集只能从我的 localization state / package 构建，然后执行 level=smoke。
   除非我明确要求，否则不要自行升级到 regression / exhaustive。

7. Tier-A 场景必须保持语言无关的正式判定契约：
   expectTargetAny 必须命中，forbidSourceAny 必须保持不存在。
   script ratio / word count / pronounCount 等只能做 diagnostic，
   不允许改成 PASS / FAIL 条件。

8. 结束时验证 cleanup：临时 smoke pack 已移除，ModLoader 状态 / error count 已恢复，
   全程没有写存档，也没有执行破坏性动作。

9. 最后报告 doctor 结果、smoke 结果、任何 assertion failure、cleanup 结果、
   report 路径，以及发现的 toolkit bug。

不要为了拿到 PASS 而削弱 assertion。不要 push 设备数据，不要 publish 或创建 Release。
```
