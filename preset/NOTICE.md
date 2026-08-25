# Micro-Inversion Standard（微逆标准模式）

一个双阶段、Token 精益的 Agent Preset：核心目标是强制把 V4 Pro 的思维链起步习惯从
"let me" 翻转为 "we need"（v5 起检测器同时支持中文起手词），同时把上下文占用与
Token 消耗压到最低。

## 文件布局

| 文件 | 作用 |
| --- | --- |
| `preset.yml` | 选择器元数据（name / description） |
| `agent.cordis.yml` | Agent 平面组合：Minimal 持久 shell + 标准工具目录 + 三组钩子插件 |
| `tool-bootstrap.mjs` | 阶段一锚定 + 动态晋升状态机 + L1 认知 persona 构建 |
| `context-slimmer.mjs` | `tools/post-execute` 结果裁剪/落盘 + `agent/pre-step` 80% 压力压缩 |
| `anchor-sustainer.mjs` | v2 全局锚：L2 近场锚 + L3 结果锚 + D 漂移检测闭环（中英文双语） |
| `test/` | node:test 自动化测试（40 项，`npm test`） |

## 需求如何落地

### 1. 首轮锚定（Bootstrap）
`tool-bootstrap.mjs` 在 `system-prompt/assemble`（prepend）把模型可见面压缩为：
- 工具目录：恰好一个持久 shell（POSIX `bash` / win32 `pwsh`）+ `str_replace_editor`；
- 提示词 sections：只留 persona（Minimal 一行 + 强制 "we need" 推理协议）；
- 运行时 contexts：清空（无 sandbox/approval/workspace 快照）；
- 注入消息：只放行 `user` 与 `goal` 两种来源（v5：无 source.kind 的消息保留，
  并在丢弃时告警一次，绝不静默丢内容）；
- 输出预算：`bootstrapMaxTokens: 1024`（社区观测到的 "We need" 触发窗口），
  晋升后立即移除该上限；v5 尊重用户显式设置的更小预算（只降不升）。

### 2. 动态晋升（Dynamic Promotion）
同一 Session 内，首个持久 `tool/call` 或首次实质性回复（`assistant/message`）
立即把完整标准目录解锁：恢复全部 sections 与运行时 contexts，并把工作目录追加进
persona。晋升判定在 `step/end`/`turn/end` 边界刷新（绝不在工具执行中切换）。
组合漂移时降级为完整目录并告警一次，绝不让会话被锁死。

压缩（compaction）会重写整个模型可见面，因此 `compaction/end` 会把会话重置回
受控阶段（bootstrap 双工具 + `compactionTools`）；**v5：受控阶段不再套用 1024
冷启动输出上限**（`postCompactionMaxTokens` 默认不限），温热会话不被截断。
该重置同时存在于实时 `session/event` 与持久日志扫描两条路径，resume/reload 可重建。

### 3. 全局运行态锚（v2）
- **L1 认知换装**：晋升时把阶段一极简 persona 整体替换为"集体执行单元"认知 persona
  （身份重塑 + 显式 CoT 语法 + FORBIDDEN openers 黑名单 + 转场规则 + 自检 + 抗漂移 +
  v3 完整性/深度条款）。
- **L2 近场锚**：每次 `agent/pre-step` 在 messages 尾部注入恒定微指令（注意力最强处）；
  v6 起在连续 `throttleAfterConforms` 个合规块后跳过（见下）。
- **L3 结果锚**：每个被接受的工具结果经 harness 原生 `additionalContexts`
  （"结果 → 下一请求"通道）挂接续锚，不改结果文本、不污染日志。
- **D 漂移检测**：增量扫描 `session.events` 中每条 `assistant/message` 的
  **首个推理块**（frame-setter），`classifyOpener` 三分类（conform/violation/soft）；
  连续 ≥3 违规或累计 ≥5 升级锚文案 + 注入引述违规原文的重述消息；连续 3 个合规块
  降级。**v3 起纯软强化**：绝不触发上下文裁剪或输出预算收紧。
- **v4 成本修复**：请求面只保留最新 `maxAnchorsInSurface: 1` 条锚；工具结果续接步
  跳过 L2（L3 已覆盖）；锚文本精简至 ~12 tokens。
- **v5 双语**：`CONFORM_RE` / `VIOLATION_RE` 同时匹配英文与中文起手词
  （"我们需要/我们来/让我们"、"让我/我想/我认为…"），中文思维链也能被正确检测；
  漂移级别变化会写入会话日志（可观测性）。
- **v6 稳态锚降载**：连续 `throttleAfterConforms`（默认 4）个合规推理块后，
  L2 近场锚停止注入（L1 persona 仍在系统提示词中强制协议）；`scanAndClassify`
  中 **soft 起手词也重置连击**（任何非合规起手词下一步立即重新武装）；升级态
  （level ≥ 1）永不降载；L3 结果锚永不降载。降载/重新武装切换写入会话日志。

### 4. 上下文瘦身（Context Slimming）
- `tools/post-execute`（prepend）：成功工具结果文本超过 `resultTrimThresholdChars`
  （8192）时，替换为 头4096 + 中段标记 + 尾1024；全文先经 `ctx.spillStore` 落盘，
  标记中给出 locator 与检索提示。**v5：按真实标记长度（含 locator 路径）动态拟合
  头尾，保证裁剪后总长 ≤ 阈值**。错误结果、value 替换决策、嵌套子调用、含非文本块的
  结果一律跳过；落盘失败仅降级为无 locator 的标记，绝不把成功调用变错误。
- `agent/pre-step`：`tokenMeter.measure(session).totalTokens` 达到
  `llm.resolveModelInfo(...).context.contextWindow × 0.8` 时，把请求面**中段可丢弃
  消息**替换为一条恒定标记消息（头 4096 / 尾 1024 字符，整消息边界切分）；
  **保护性裁剪**：用户/审批/目标/模型分析永不裁剪，标记枚举被裁内容（种类 + callId）；
  `dropProtectedUnderPressure: true` 可开启"最后手段"（默认关，开启时标记注明）。
  持久日志保留全文，`/compact` 负责持久摘要（与 `dsh-compaction-basic` 在同一
  0.8 边界协同，两者互补）。

### 5. Token / KV Cache 优化
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
- **兼容性注意**：以上均为 dsh `0.1.1-rc.x` 内部契约；宿主升级若接口变化，
  组合降级为完整目录并告警（绝不锁死会话），但阶段一过滤、锚注入等能力可能静默失效。

## 可调旋钮（agent.cordis.yml 中 config）

- `tool-bootstrap`：`shellTools`、`commonTools`、`anchorGate`（默认关，
  按需求在首调用/首回复即晋升；开则要求首个推理块含 "we" 且无 "let me" 才晋升）、
  `maxBootstrapSteps`、`promoteAfterFirstResponse`、`bootstrapMaxTokens`、
  `postCompactionMaxTokens`（v5，默认不限）、`compactionTools`、
  `deferredSources` / `deferredGraceSteps`、`instructionHint`。
- `context-slimmer`：`resultTrimThresholdChars` / `resultHeadChars` /
  `resultTailChars`、`pressureRatio`（0.8）、`surfaceHeadChars` /
  `surfaceTailChars`、`spillResults`（默认开）、`spillTrimmedSurface`（默认关）、
  `skipTools`、`dropProtectedUnderPressure`（v5，默认关）。
- `anchor-sustainer`：`maxAnchorsInSurface`（1）、`anchorAfterToolResult`（false）、
  `throttleAfterConforms`（v6，默认 4，0 关闭）。
- **v5 容错**：未知配置键只告警忽略（不再导致整个预设挂载失败）；类型/范围错误仍会
  抛错（这是真错误）。

## 验证

- 自动化：`npm test`（test/，40 项：晋升状态机 / 裁剪切分 / 漂移扫描 / 双语分类 /
  v5 新行为 / v6 稳态降载）；`node scripts/validate.mjs` 零依赖完整性门禁
  （CI 自动执行两者）。
- 手工验收：`preset/TEST.md`（request/header 线缆级验证方法），新建使用本预设的会话：
  - 首条请求只应看到 `bash`/`pwsh` + `str_replace_editor` 两个工具；
  - 首次工具调用或首次回复后，工具目录立即变为完整标准目录；
  - 大输出（>8192 字符）应被裁剪并出现 spill locator；上下文压力 ≥80% 时中段被
    压缩标记替换；中文起手（"我们需要 …"）与英文起手均被 D 检测识别；
  - v6：连续 4+ 合规块后 L2 锚停止注入（日志 throttled），任意非合规起手词后
    立即 re-armed。

（本预设是用户根目录下的自有预设，升级不会被覆盖；要改动它直接编辑本目录。）
