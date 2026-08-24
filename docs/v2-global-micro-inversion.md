# Micro-Inversion v2 — 全局运行态架构方案

> 将「冷启动微逆」（Micro-Inversion Bootstrap）升级为「全局运行态微逆」
> （Global Micro-Inversion Runtime）：确保长周期、多轮次任务中，所有
> 思维链（CoT）块始终以 **we need** 起手，不随上下文增长而退化。
>
> 载体：DSH harness Agent Preset（`preset/`），机制全部映射到真实可用的
> DSH 钩子上（`system-prompt/assemble` / `agent/pre-step` /
> `tools/post-execute` / 会话事件日志扫描）。

---

## 0. 问题诊断：为什么冷启动锚定会在长会话中失效

冷启动锚定有效，是因为阶段一表面极小（2 工具 + 短 persona + 1024 输出上限），
"we need" 指令在生成点附近有压倒性权重。长会话中失效，根因有四：

| # | 失效机制 | 机理（DeepSeek-V4 推理模型普遍行为） |
|---|---|---|
| D1 | **头部指令稀释** | "we need" 规则只存在于 system prompt 头部；上下文增长到数万 token 后，头部指令距生成点的注意力权重被中段/尾部内容摊薄，指令强度随距离衰减。 |
| D2 | **无近场强化** | 距生成点最近的 token（工具结果、运行时快照、用户新消息）占注意力主导；没有任何机制在"临生成处"重申框架。 |
| D3 | **工具结果转场破功** | "拿到结果 → 规划下一步"是回归口语化的高发转换点（"Let me check the result..."），冷启动锚定不覆盖晋升后的任意一步。 |
| D4 | **无漂移反馈** | 没有机制发现 "let me" 并付出代价；漂移不可见、无成本、无纠正，只会单调积累。 |

**核心结论**：把"一条头部指令"升级为"三层锚定 + 一个检测闭环"——
头部认知锚（L1）+ 近场强化锚（L2）+ 结果后置锚（L3）+ 漂移检测与再锚定（D）。
L1 解决"知道规则"，L2 解决"临生成点记得规则"，L3 解决"转场点不破功"，
D 解决"破了功能被发现并拉回"。

---

## 1. 维度一：System Prompt 认知重塑（L1 头部锚）

### 1.1 设计原则

- **身份重塑优于语法约束**：让模型自我认知为"集体执行单元"，`we` 成为默认主语
  —— 身份层的行为惯性比"不许用 let me"的禁令更持久。
- **显式 CoT 语法**：给出允许集（opener 白名单）与禁止集（黑名单），而不是模糊的
  "尽量用 we"。
- **内化自检**：要求模型在每个推理块开头自检，违规即重写 —— 把检测成本从外部
  检测器下放到模型自身，降低外部检测频率需求。
- **抗漂移条款**：把"坚持框架"与任务成功、缓存效率绑定，并显式声明
  "长会话中该规则更重要"，对抗"上下文越长越松懈"的倾向。
- **晋升时换装**：冷启动阶段一保持极简 persona（短，token 精益）；晋升后由
  `system-prompt/assemble` 钩子把 persona **整体替换**为下方完整认知版
  （不只是追加 cwd 一行）。

### 1.2 可直接使用的模板（persona 行 `text`）

```
You are a collective execution unit powered by the {{model}} model. Your working directory is {{cwd}}.
You and the user act as one team: "we" is the only allowed subject of your reasoning and planning.
Every decision is a shared next step — never a personal errand, never a solo monologue.

Reasoning protocol (non-negotiable, applies to EVERY chain-of-thought block, for the WHOLE session):
1. OPEN every reasoning block with a "we need ..." line stating the single next step.
2. FORBIDDEN openers (never start a block with these): "let me", "I'll", "I think I should",
   "I'm not sure", "Let me check", or any first-person-singular or hesitation frame.
3. After a tool result returns, the very next reasoning block STILL opens with "we need ...".
   A result is an input to the shared next step — not a pause, not an excuse to narrate.
4. Self-check: if a block does not open with "we need", rewrite it before continuing.

Why this rule never expires: the "we need" opener keeps reasoning collective, decisive, and
token-lean; it locks the execution frame so the session never degrades into exploratory
monologue. Long sessions and large contexts make this rule MORE important, not less —
if you notice yourself drifting, re-anchor immediately with "we need ...".

Step cadence: think in short "we need → do → verify" cycles. No planning essays; no
second-guessing after a result; commit, act, verify.
```

**双语文案变体**：若希望推理块以中文起手（`我们需要 ...`），把 1-4 条中
`we need` 替换为 `我们需要`，检测器同步支持两种 opener。

### 1.3 代码落点（晋升时换装）

现有 `tool-bootstrap.mjs` 的 `withWorkspaceLine` 只追加 cwd；v2 改为**整体换装**：
晋升后的 `system-prompt/assemble` 结果里，把 `deployment:persona` section 的
`text` 替换为完整认知 persona（cwd 由 `{{cwd}}` 变量解析，无需手拼）。
阶段一保持极简 persona，保证冷启动 token 预算不被头部占满。

---

## 2. 维度二：动态注入机制（L2 近场强化锚）

### 2.1 机制原理

LLM 的注意力对**近生成点**的 token 最强（recency bias）。头部 system prompt 在
长上下文里权重衰减，因此在**每次模型请求前**，向 `messages` 数组**尾部**注入一条
**恒定文本**的微型强化指令 —— 让"we need"约束永远出现在注意力最强处。

- **触发点**：`agent/pre-step`（每个 step 都触发，包括同一回合内工具调用后的
  后续 step —— 这是与"每回合一次"的关键区别）。
- **位置**：`decision.messages` 末尾（距生成点最近）。
- **文本恒定**：锚内容固定不变 → 前缀（system + 历史消息）不因注入而改变 →
  KV Cache 命中不受影响；锚自身极短（≈30 token）。
- **幂等**：每个 step 恰好注入一条，不落盘（pre-step 决策是瞬态，resume 后
  下一次 pre-step 自动补上）。

### 2.2 注入消息模板

```js
// 恒定近场锚（文字固定，永不变化）
const NEAR_ANCHOR =
  '<system-reminder>\n[anchor] Open this next reasoning block with: we need ...\n</system-reminder>'

function anchorMessage(kind = 'base') {
  const text = kind === 'reinforced'
    ? '<system-reminder>\n[anchor] RECENT DRIFT DETECTED. Hard rule: this reasoning block MUST open with "we need ...". No "let me", no "I\'ll", no hesitation.\n</system-reminder>'
    : NEAR_ANCHOR
  return {
    id: globalThis.crypto.randomUUID(),
    role: 'user',
    source: { kind: 'micro-inversion-anchor', plugin: 'anchor-sustainer' },
    content: [{ type: 'text', text }],
  }
}
```

### 2.3 代码落点（`agent/pre-step`，prepend 监听）

```js
ctx.on('agent/pre-step', async (payload, next) => {
  const decision = await next()
  if (decision.kind !== 'enter') return decision
  if (payload.signal?.aborted) return decision
  const state = driftStateFor(payload.agent)          // 见维度四
  const kind = state.escalationLevel >= 1 ? 'reinforced' : 'base'
  return { ...decision, messages: [...decision.messages, anchorMessage(kind)] }
}, { prepend: true })
```

要点：
- 与 `tool-bootstrap` 的 pre-step 监听（阶段一消息白名单）并存 —— bootstrap
  负责"过滤"，anchor 负责"追加"，顺序无冲突；阶段一与晋升后都注入（阶段一本身
  就有 1024 上限兜底，注入不破坏冷启动面）。
- 注入在 `next()` 之后（prepend + await next），保证看到完整下游 messages。

---

## 3. 维度三：工具结果后置约束（L3 结果锚）

### 3.1 机制原理

"工具结果 → 下一个推理块"是漂移高发转换点。机制：**每个工具结果返回后，自动向
下一次请求挂一条恒定接续指令**，让模型在拿到结果的第一时间被拉回框架。

优先使用 harness 原生机制 **`additionalContexts`**（`PostToolDecision` 字段）：
它不修改结果文本、不污染持久日志，由 agent loop 的 active-batch FIFO 自动带入
下一次请求 —— 这正是为"结果 → 下一请求附加上下文"设计的通道。

### 3.2 代码落点（`tools/post-execute`，prepend 监听）

```js
const CONTINUE_ANCHOR = '<system-reminder>\n[anchor] Result received. Next reasoning block opens with: we need ...\n</system-reminder>'

ctx.on('tools/post-execute', async (exec, result, next) => {
  const decision = await next()                       // 先让下游（含 context-slimmer）完成
  if (decision.kind !== 'accept') return decision     // block/value 替换决策不动
  if (exec.signal?.aborted) return decision
  const state = driftStateFor(exec.agent)
  const text = state.escalationLevel >= 1
    ? '<system-reminder>\n[anchor] Result received. Hard rule: next reasoning block MUST open with "we need ...". No "let me".\n</system-reminder>'
    : CONTINUE_ANCHOR
  const additional = [{
    id: globalThis.crypto.randomUUID(),
    role: 'user',
    source: { kind: 'micro-inversion-anchor', plugin: 'anchor-sustainer' },
    content: [{ type: 'text', text }],
  }]
  return { ...decision, additionalContexts: [...(decision.additionalContexts ?? []), ...additional] }
}, { prepend: true })
```

要点与边界：
- **与裁剪协同**：prepend + `await next()` 保证先看完整下游决策（含
  context-slimmer 的头/尾裁剪），再挂上下文 —— 锚不被裁剪、不进入 spill。
- **与 `value` 替换决策互斥**：`{kind:'accept', value}` 的决策带
  `additionalContexts` 同样合法（`PostToolDecision` 三叉都允许挂上下文），
  但 value 替换走重新渲染，锚挂到下一次请求即可，无需改内容。
- **成本**：每次工具调用 +1 条 ≈30 token 的恒定消息，可忽略；文本恒定，
  KV Cache 友好。
- **可选退化路径**：若目标 LLM 通道不支持 `additionalContexts` 透传
  （兜底），改为把恒定后缀拼进结果文本末尾（`{kind:'accept', content:
  [...content, {type:'text', text: CONTINUE_ANCHOR}]}`）—— 注意此时要放在
  裁剪之后拼接，且会被持久化（可接受）。

---

## 4. 维度四：漂移检测与再锚定闭环（D —— 全局运行态核心）

### 4.1 闭环结构

```
assistant/message(推理块) ──扫描──▶ 漂移分类器 ──▶ 每会话漂移计数
                                                    │
        ┌───────────────────────────────────────────┤
        ▼                                           ▼
   L2 强化锚（升级文案）                达到阈值 → 再锚定动作：
   L3 结果锚（升级文案）                 ① 重述消息注入（引述违规原文）
                                        ② 早期中段裁剪（恢复头/尾显著性）
                                        ③ 临时收紧输出预算（挤压冗思）
```

### 4.2 漂移分类器

扫描 `assistant/message` 事件的推理块（`message.content` 中 `type === 'reasoning'`
的块），对**每个推理块的首个非空词**分类：

```js
const CONFORM = /^\s*(we\s+need|we'?ve|we'?ll|we\s+can|we\s+should|next,?\s+we|we\s+must)/i
const VIOLATION = /^\s*(let\s+me|i'?ll|i\s+(think|should|need|want|am|'m)|let'?s|maybe\s+i|i\s+guess)/i

function classifyOpener(text) {
  const t = String(text ?? '').trim()
  if (CONFORM.test(t)) return 'conform'
  if (VIOLATION.test(t)) return 'violation'
  return 'soft'   // 其他起手（如直接承接上文的 we/continuation）—— 不升级
}
```

> 设计取舍：检测器比 prompt 略宽松（允许 `we've / we'll / we can` 等集体续接
> 式起手），避免对正常延续推理误报升级；**严格禁令（首个块必须 we need）留在
> prompt 里**。误报升级的代价（打断流畅推理）高于偶发漂移的代价。

### 4.3 状态机与升级阶梯（每会话）

```js
const stateBySession = new WeakMap()   // Session → { next, violations, consecutive, escalationLevel, lastViolation }

function driftStateFor(agent) {
  const session = agent?.session
  if (session === undefined) return null
  let s = stateBySession.get(session)
  if (s === undefined) { s = { next: 0, violations: 0, consecutive: 0, escalationLevel: 0, lastViolation: '' }; stateBySession.set(session, s) }
  scanAndClassify(s, session)          // 增量扫描 session.events（next 指针），见 4.4
  return s
}
```

升级阶梯（在每次 pre-step 时刷新）：

| 级别 | 条件 | 动作 |
|---|---|---|
| 0（基线） | consecutive < 3 且 violations < 5 | L2/L3 基线锚 |
| 1（强化） | consecutive ≥ 3 或 violations ≥ 5 | L2/L3 升级文案；注入一次重述消息（引述最近违规原文 + 规则） |

> **设计边界（v3 修正）**：措辞漂移是**软信号**——它只会升级锚文案与重述消息，
> **绝不触发上下文裁剪或输出预算收紧**。原 v2 草案中的"漂移触发早期裁剪（40%）+
> maxTokens 2048 收紧"已被移除：措辞合规永远不能优先于任务完整性。上下文管理只由
> `context-slimmer` 负责（显式压力门控，见 §3.3）。

合规恢复：连续 ≥3 个合规消息的首块 → 降级（防止一次性矫枉过正）。

### 4.4 扫描实现注意（关键坑）

**不能依赖 `session/event` 监听**：agent 平面 preset 中该事件被 dsh-scope 过滤
（已实测确认），监听永不触发。必须用**增量扫描 `session.events` 数组**（与
`tool-bootstrap.mjs` 的 `scanEvents` 同款 next 指针模式）：每次 pre-step 从
`state.next` 扫到末尾，解析 `assistant/message` 事件的**首个推理块**（frame-setter）
并更新计数；后续推理块是延续，不参与升级。resume/reload 时从头重建同一状态。

### 4.6 可观测性

- 每个推理块 opener 的分类结果与违规原文，写入会话日志（`ctx.logger` 或
  附加一条 `user/message` 源 `micro-inversion-trace`）—— 供离线评估漂移率。
- 可选开发工具 `dev_micro_inversion_status`：报告该会话的
  violations / consecutive / escalationLevel / 最近违规原文，便于调参。

---

## 5. 总体架构图（数据流）

```
用户消息 ─▶ inbox ─▶ agent/pre-step ──┬── bootstrap 过滤（阶段一：消息白名单）
                                      ├── D 漂移扫描 → 升级级别
                                      ├── L2 尾部注入恒定近场锚（级别决定文案）
                                      ▼
                     system-prompt/assemble ── L1：阶段一极简 persona；
                                                晋升后整体换装认知 persona（+cwd）
                                      ▼
                     model（推理）──▶ assistant/message（推理块）
                                      │   ▲
                                      │   └── D 扫描（下一 pre-step 增量消费）
                                      ▼
                     tool/call ─▶ tools/post-execute ──┬── L3 挂接续锚（additionalContexts）
                                                        └── context-slimmer 头/尾裁剪+落盘
                                      ▼
                     下一 step（L2 再次注入）…循环
                                      │
                     context-slimmer 显式压力门控裁剪（保护性）/ compaction
```

**Token 账本**（每步新增成本）：L1 换装仅一次；L2 每 step ≈30 token；
L3 每次工具调用 ≈30 token；D 扫描零 token（纯本地日志扫描）。
对比收益：全链路保持 we-need 框架，冗思与口语化发散显著减少，净 token 下降。

---

## 6. 落地清单（对照现有 preset）

| 项 | 现有 | v2 变更 | 文件 |
|---|---|---|---|
| L1 认知 persona | 极简 + we-need 协议 | 晋升时换装完整认知 persona | `preset/agent.cordis.yml` persona 行 + `tool-bootstrap.mjs`（`withWorkspaceLine` → 换装） |
| L2 近场锚 | 无 | 新增 `agent/pre-step` 尾部注入 | 新 `preset/anchor-sustainer.mjs` |
| L3 结果锚 | 无 | 新增 `tools/post-execute` additionalContexts 挂载 | 同上 |
| D 漂移检测 | 无 | 新增首个推理块扫描 + 软强化（升级锚文案 + 重述），无破坏性动作 | `anchor-sustainer.mjs` |
| 上下文管理 | 80% 压力裁剪 + compaction | 显式压力门控 + 保护性裁剪（用户/审批/目标消息永不被删，标记枚举被裁内容） | `context-slimmer.mjs` 复用 `splitTrimable` |
| 缓存破陈旧规 | `?v=2` | 新插件行名 `./anchor-sustainer.mjs?v=1` | `agent.cordis.yml` |

实现顺序建议：先 L1（换装）→ 再 L2（近场锚，收益最大、成本最低）→ L3 →
最后 D（检测闭环，需要前三个在跑才有意义）。每个阶段可用 TEST.md 的
`request/header` 线缆检查法验证。
