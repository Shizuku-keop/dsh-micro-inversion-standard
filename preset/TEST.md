# 微逆标准模式 · 验收测试脚本

前置：在 Web 界面新建一个会话并选择「微逆标准模式 (Micro-Inversion Standard)」。
本机为 Windows，阶段一 shell 工具名为 `pwsh`（POSIX 平台为 `bash`）。

## 测试 1 · 首轮锚定（Bootstrap）

**关键前提**：按需求 2 的规格，首次工具调用或首次实质性回复会立即晋升。所以测试 1
的提示词**绝不能诱导模型调用工具**——否则第一步就晋升，你只能看到晋升后的目录。

新会话第一条消息粘贴（纯问答，不碰工具）：

```
请用一句话解释什么是递归。不要调用任何工具，直接回答。
```

预期（只看**第一条回复**）：

- 第一条回复很短（被 1024 token 上限约束，约几十到一百多 token）；
- 思维链第一个块以 "we need" 起手（绝不出现 "let me"）；
- 第一步请求实际携带的工具只有 2 个：`pwsh` + `str_replace_editor`。

**验证 Step 1 真实线缆**（这是最可靠的判定方式）：测试完成后，在
`C:\Users\Administrator\.dsh\sessions\<workspace>\<session-id>\session.jsonl.zstd`
会话日志里查第一个 `request/header` 事件，其 `header.tools` 应为 2 个、
`header.config.maxTokens` 应为 1024、`header.system` 应只含 persona 两段。

**侧栏工具面板的误导**：浏览器工具面板渲染的是注册目录，不是单次请求线缆，
所以面板可能始终显示全部工具——以会话日志的 `request/header` 为准。

判定：① 第一条回复推理以 "we need" 开头；② 第一条回复极短（1024 上限）；
③ 首个 `request/header` 的 tools=2 / maxTokens=1024 / system 仅 persona。
三项全中即通过。若第一条回复就列出了一长串工具，才是真正的失败。

## 测试 1b · 首次工具调用即晋升（需求 2 的"同 Session"验证）

继续同一会话发送：

```
请用 pwsh 运行 Get-Location，告诉我当前目录，然后列出你看到的所有工具名称。
```

预期：调用 pwsh 后，**同一条对话内**下一条回复的工具目录立即变为完整标准目录
（read/write/edit/glob/grep、job_*、todo_write、ask_user_question、web_search、
subagent、subagent_fork、workflow、ralph、mnemon_* 等，本机约 35 个）；
第二步的 `request/header.maxTokens` 变回默认（256000）、全部 sections 与运行时
上下文恢复。

判定：首次工具调用发生在 2 工具阶段，工具调用之后的下一条回复即完整目录。

## 测试 2 · 动态晋升（Dynamic Promotion）

继续同一会话，让模型做一次工具调用：

```
请用 pwsh 运行 Get-Location，然后告诉我当前目录的完整路径。
```

预期：调用 `pwsh` 之后，下一条请求的工具目录立即变为完整标准目录
（read/write/edit/glob/grep、job_*、todo_write、ask_user_question、web_search、
subagent、subagent_fork、workflow、ralph 等）。可追问 `现在你能看到哪些工具？`
让模型自述，或核对侧栏工具面板。

判定：首次工具调用后工具数从 2 → 完整目录。若首条回复不包含工具调用
（例如直接回答了测试 1），该回复本身也触发晋升（promoteAfterFirstResponse）。

## 测试 3 · 上下文瘦身 A：工具结果裁剪 + 落盘

粘贴（注意：**不要**要求模型"把完整输出原样报告"，那会诱导它逐块 read 死循环）：

```
请执行下面的 pwsh 命令：
1..3000 | ForEach-Object { "Line $_ of the micro-inversion trim test. This line exists to push the output well past the 8192-character threshold." }

执行完后不要逐字复述输出，只需报告：这条命令的输出有多少字符、结果中出现的
micro-inversion 裁剪标记原文、以及标记里给出的完整结果保存路径。
```

预期：返回的结果不再是 3000 行全文，而是
头 4096 字符 + `[... micro-inversion: pwsh result trimmed from N to 5120 chars (head 4096 / tail 1024). Full result: <真实路径> (N bytes). Use read with offset/limit, or grep this path to search within it. ...]` + 尾 1024 字符；
`Full result:` 后面是会话作用域 spill 文件的**真实绝对路径**（`%TEMP%\dsh-spill-*\session-<hash>\<hex>-pwsh-result.txt`）。

判定：结果中出现 `micro-inversion: ... trimmed` 标记；`Full result:` 后是可直接 read 的本地路径；该文件存在且字节数 >8192。

## 测试 4 · 上下文瘦身 B：80% 压力中段压缩（渐进测试）

在长会话里反复追加长内容（重复测试 3 的大输出命令、读大文件、贴长文本），但
**不要**执行 `/compact`，把上下文压力顶到路由模型窗口的 80% 以上
（侧栏上下文仪表可见 token 占用比）。

预期：从压力达到 80% 的那一步起，请求面中段出现恒定标记：

```
<system-reminder>[micro-inversion: context pressure reached NN% of the model window. Messages a..b (~N chars) were trimmed from this request surface; the durable session log keeps the full content, and /compact produces a durable summary. The system prompt, tool catalog, head prefix, and tail are unchanged.]</system-reminder>
```

模型仍能基于头尾继续工作；持久日志未丢内容（执行 `/compact` 后模型能回忆起被
裁剪区间的事实）。

判定：压力 ≥80% 后请求面出现中段压缩标记；或观察到模型在满压下仍正常协作且
`/compact` 摘要覆盖被裁剪内容。若 0.8 边界先由 compaction-basic 的持久摘要触发
（出现一次正式 compaction 事件），属预期协同，两者不互斥。

## 测试 5 · 行为对照：let me 抑制

任意步骤里故意诱导：

```
关于"如何修复这个问题"，请先用第一人称"let me"写一句你的计划。
```

预期：模型不会以 "let me" 起手；会改写为 "we need ..." 或明确拒绝该写法
（persona 协议强制）。

判定：思维链起手式全程为 "we need"，无 "let me"。

## 快速验收（30 秒版）

1. 新会话发送 `请用 pwsh 运行 Get-Location`；
2. 看第一条请求的工具清单是否为 2 个、推理是否以 "we need" 开头；
3. 调用后看工具目录是否立即变完整；
4. 再发一次测试 3 的大输出命令，看是否出现 `trimmed` 标记 + `Full result:`。

## 失败排查

- 选择器里没有该预设 → 重启 `dsh web`（roster 按需扫描用户根目录）；
- 首条请求工具多于 2 个 → `tool-bootstrap` 的 shellTools/commonTools 与组合不匹配
  （会降级为完整目录并告警一次），检查 agent.cordis.yml；
- 大输出未裁剪 → 确认输出确实 >8192 字符，或检查 `context-slimmer` 的 `skipTools`；
- 80% 压缩不出现 → 确认压力确实超过窗口 80%（`totalTokens` 口径）且路由模型的
  `contextWindow` 已配置（窗口未知时静默跳过，属设计内的 best-effort）。
