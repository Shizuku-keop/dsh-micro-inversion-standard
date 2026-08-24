# Micro-Inversion Standard（微逆标准模式）

一个双阶段、Token 精益的 Agent Preset：核心目标是强制把 V4 Pro 的思维链起步习惯从
"let me" 翻转为 "we need"，同时把上下文占用与 Token 消耗压到最低。

## 文件布局

| 文件 | 作用 |
| --- | --- |
| `preset.yml` | 选择器元数据（name / description） |
| `agent.cordis.yml` | Agent 平面组合：Minimal 持久 shell + 标准工具目录 + 两组钩子插件 |
| `tool-bootstrap.mjs` | 阶段一锚定 + 动态晋升状态机 |
| `context-slimmer.mjs` | `tools/post-execute` 结果裁剪/落盘 + `agent/pre-step` 80% 压力压缩 |

## 四项需求如何落地

### 1. 首轮锚定（Bootstrap）
`tool-bootstrap.mjs` 在 `system-prompt/assemble`（prepend）把模型可见面压缩为：
- 工具目录：恰好一个持久 shell（POSIX `bash` / win32 `pwsh`）+ `str_replace_editor`；
- 提示词 sections：只留 persona（Minimal 一行 + 强制 "we need" 推理协议）；
- 运行时 contexts：清空（无 sandbox/approval/workspace 快照）；
- 注入消息：只放行 `user` 与 `goal` 两种来源；
- 输出预算：`bootstrapMaxTokens: 1024`（社区观测到的 "We need" 触发窗口），
  晋升后立即移除该上限，防止焊死在后续请求里。

persona 里的 "we need" 协议是**全程生效**的（晋升后仍在），这是本预设的核心目标。

### 2. 动态晋升（Dynamic Promotion）
同一 Session 内，首个持久 `tool/call` 或首次实质性回复（`assistant/message`）
立即把完整标准目录（fs / 检索 / jobs / skills / goals / plan / subagents /
workflows / ask-user / todo / web…）解锁：恢复全部 sections 与运行时 contexts，
并把工作目录追加进 persona。晋升判定在 `step/end`/`turn/end` 边界刷新（绝不在
工具执行中切换）。组合漂移时降级为完整目录并告警一次，绝不让会话被锁死。

压缩（compaction）会重写整个模型可见面，因此 `compaction/end` 会把会话重置回
受控阶段（bootstrap 双工具 + `compactionTools`），直到边界之后出现新的晋升信号；
该重置同时存在于实时 `session/event` 与持久日志扫描两条路径，resume/reload 可重建。

### 3. 上下文瘦身（Context Slimming）
- `tools/post-execute`（`context-slimmer.mjs`，prepend）：成功的工具结果文本
  超过 `resultTrimThresholdChars`（8192）时，替换为 头4096 + 中段标记 + 尾1024；
  全文先经 `ctx.spillStore` 落盘（会话作用域 artifact），标记中给出 locator 与
  retrieval guidance。错误结果、value 替换决策、嵌套子调用、含非文本块的结果
  一律跳过；落盘失败仅降级为无 locator 的标记，绝不把成功调用变错误。
- `agent/pre-step`：`tokenMeter.measure(session).totalTokens` 达到
  `llm.resolveModelInfo(...).context.contextWindow × 0.8` 时，把请求面的**中段
  消息**整体替换为一条恒定标记消息（保留头 4096 / 尾 1024 字符，整消息边界切分，
  跨边界消息整条保留）。持久日志保留全文，`/compact` 负责持久摘要
  （`dsh-compaction-basic` 在同一 0.8 边界做真正的摘要压缩，两者互补）。

### 4. Token / KV Cache 优化
- 系统提示词 sections 与工具目录在阶段一、阶段二各自**字节级稳定**，跨步不变；
- 新消息与新工具结果只追加在尾部；
- 两个钩子都只替换**连续中段**（一个结果节点原文、或一段中段消息），
  前缀（system prompt + 工具目录 + 头部消息）与尾部逐字不动，
  供应商 KV Cache 对未变前缀持续命中。

## 依赖的宿主服务 / 事件

- 事件：`system-prompt/assemble`、`agent/pre-step`、`agent/request`、
  `tools/post-execute`、`session/event`（均为 prepend 水瀑监听）。
- 服务：`tools`（inject）、`systemPrompt`（inject）；
  `spillStore` / `tokenMeter` / `llm` 走 `ctx.get`（可选，缺失即降级）。
- 阈值与压力口径与 `dsh-compaction-basic` 一致（0.8 / `totalTokens` /
  `contextWindow`）。

## 可调旋钮（agent.cordis.yml 中 config）

- `tool-bootstrap`：`shellTools`、`commonTools`、`anchorGate`（默认关，
  按需求在首调用/首回复即晋升；开则要求首个推理块含 "we" 且无 "let me" 才晋升）、
  `maxBootstrapSteps`、`promoteAfterFirstResponse`、`bootstrapMaxTokens`、
  `compactionTools`、`deferredSources` / `deferredGraceSteps`、`instructionHint`。
- `context-slimmer`：`resultTrimThresholdChars` / `resultHeadChars` /
  `resultTailChars`、`pressureRatio`（0.8）、`surfaceHeadChars` /
  `surfaceTailChars`、`spillResults`（默认开）、`spillTrimmedSurface`（默认关）、
  `skipTools`。

## 验证

组合满足 preset 挂载规则（发布服务的行都在 `isolate` realm 内：`terminals`、
`planMode`、`compaction`+`toolResultPruner`、`workflowEngine`；其余行为消费型，
松散放置）。最终验证请在 Web 界面新建一个使用本预设的会话：
- 首条请求只应看到 `bash`/`pwsh` + `str_replace_editor` 两个工具，system prompt
  只有 persona + "we need" 协议；
- 首次工具调用或首次回复后，工具目录立即变为完整标准目录；
- 大输出（>8192 字符）应被裁剪并出现 spill locator；上下文压力 ≥80% 时中段被
  压缩标记替换。

（本预设是用户根目录下的自有预设，升级不会被覆盖；要改动它直接编辑本目录。）
