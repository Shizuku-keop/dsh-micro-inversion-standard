# dsh-micro-inversion-standard（微逆标准模式）

一个可复用的 **DSH Agent Preset**：双阶段、Token 精益的编码智能体模式，并把
模型思维链的起手习惯从 "let me" 翻转为 **"we need"**（v5 起同时支持中文起手词
"我们需要 …" 的检测），同时把上下文占用与 Token 消耗压到最低，保持供应商
KV Cache 对未变前缀持续命中。

> 这是 DSH **Agent Preset**（预设），不是 web profile 插件。DSH 通过扫描
> `<dshHome>/.agent-presets/<id>/` 目录来发现预设（`dsh-agent-presets` 的
> `includeUserRoot` 默认开启），因此"安装"就是把本仓库的 `preset/` 目录原样
> 放进该位置，然后重启 `dsh web`。

## 五项核心能力

1. **首轮锚定（Bootstrap）** — 第一条请求只暴露 Minimal 双工具
   （持久 shell `bash`/`pwsh` + `str_replace_editor`），系统提示词只留 persona
   与 "we need" 推理协议，输出预算钳制在 1024 token，强制第一条推理块以
   "we need …" 起手。
2. **动态晋升（Dynamic Promotion）** — 同一 Session 内，首次工具调用或首次
   实质性回复后立即解锁完整标准工具目录（fs / 检索 / jobs / skills / goals /
   plan / subagents / workflows / ask-user / todo / web …），恢复全部提示词
   sections 与运行时上下文；compaction 后重置回受控阶段（v5：不再套用 1024
   冷启动输出上限，温热会话保持完整输出预算），等新的晋升信号。
3. **全局运行态锚（v2，anchor-sustainer）** — L1 认知 persona 晋升时整体换装；
   L2 每次请求在尾部注入恒定近场锚；L3 每个工具结果经 harness 原生
   `additionalContexts` 挂接续锚；D 漂移检测闭环增量扫描推理块起手词
   （**中英文双语**），违规时升级锚文案并注入重述消息（纯软强化，绝不触发
   裁剪或输出收紧）。**v6 稳态锚降载**：连续 `throttleAfterConforms`（默认 4）
   个合规推理块后跳过 L2 近场锚（L1 persona 仍强制协议；任意 soft/违规起手词
   立即重新武装）——只在合规已被证明时才省这一步的锚 token。
4. **上下文瘦身（Context Slimming）** — `tools/post-execute` 把超过 8192 字符
   的工具结果裁剪为 头4096 + 标记 + 尾1024（v5：按真实标记长度动态拟合，
   绝不超出阈值），全文落盘为会话作用域 spill artifact 并在标记中给出真实路径；
   `agent/pre-step` 在 token 压力达到路由模型窗口 80% 时把请求面中段可丢弃消息
   替换为一条恒定标记（用户/审批/目标/模型分析永不裁剪；`/compact` 负责持久摘要）。
5. **Token / KV Cache 优化** — 两个阶段的系统提示词与工具目录各自字节级稳定，
   新内容只追加在尾部，裁剪只替换连续中段，未变前缀始终可被供应商缓存命中。

## 目录结构

```
micro-inversion-standard/
├── preset/                    ← 直接安装的预设目录（整体复制）
│   ├── preset.yml             ← 选择器元数据（name / description）
│   ├── agent.cordis.yml       ← Agent 平面组合（persona + 三组钩子 + 标准目录）
│   ├── tool-bootstrap.mjs     ← 阶段一锚定 + 动态晋升状态机 + L1 认知 persona
│   ├── context-slimmer.mjs    ← 结果裁剪/落盘 + 80% 压力中段压缩
│   ├── anchor-sustainer.mjs   ← v2 全局锚：L2 近场锚 + L3 结果锚 + D 漂移检测
│   ├── NOTICE.md              ← 实现说明（需求如何落地）
│   └── TEST.md                ← 验收测试脚本
├── test/                      ← node:test 自动化测试（npm test，40 项）
├── scripts/                   ← 维护工具（见下）
│   ├── validate.mjs           ← 零依赖完整性门禁（语法/yml 引用/版本一致性）
│   └── analyze-session.mjs    ← 会话取证分析器（A/B 评测证据，可复现）
├── .github/workflows/         ← CI：push/PR 自动跑 validate + npm test
├── install.ps1                ← Windows 安装脚本（事务化覆盖）
├── install.sh                 ← POSIX 安装脚本（事务化覆盖）
├── docs/                      ← v2 架构方案 + 工作总结（含 A/B 实测）
├── README.md
├── MAINTAINING.md             ← 维护纪律（单一事实源 / 门禁 / 发布 / 评测契约）
├── LICENSE                    ← MIT（含 dsh-anchored-standard 归属）
├── CHANGELOG.md
└── package.json               ← npm 发布元数据（默认 private）
```

`agent.cordis.yml` 里的钩子行名带缓存戳：`./tool-bootstrap.mjs?v=7`、
`./context-slimmer.mjs?v=5`、`./anchor-sustainer.mjs?v=4`（相对路径 + 缓存戳），
所以 **`preset/` 必须整目录原样复制**，不能只拷组合文件。

## 安装

### 方式 A：克隆仓库后运行安装脚本

```bash
git clone https://github.com/Shizuku-keop/dsh-micro-inversion-standard.git
cd dsh-micro-inversion-standard
```

Windows（PowerShell）：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

POSIX（bash）：

```bash
sh ./install.sh
```

脚本先把 `preset/` 复制到临时目录再原子替换，中断不会留下半安装状态。

### 方式 B：手动复制

把本仓库 `preset/` 目录整体复制为：

```
<dshHome>/.agent-presets/micro-inversion-standard/
```

Windows 默认 `dshHome` = `%USERPROFILE%\.dsh`，POSIX 默认 = `$HOME/.dsh`。

### 安装后

1. **重启 `dsh web`**（roster 按需扫描用户根目录，新预设需要重启才可见）；
2. 新建会话，在预设选择器里选 **「微逆标准模式 (Micro-Inversion Standard)」**；
3. 第一条请求应只看到 `bash`/`pwsh` + `str_replace_editor` 两个工具，推理以
   "we need" 起手；首次工具调用或首次回复后工具目录立即变为完整标准目录。

> 适用边界（重要）：本项目实测 **微逆只对推理密集型任务显著省 Token**
> （A/B：输出 −73%、推理 −86%）；**工具执行密集型的长编码任务不省反增**
> （实测计费输入 +50%）。请按任务类型选择：分析/多事实任务用微逆，纯工具
> 执行任务用内置 `standard`。

## 快速验收（30 秒版）

1. 新会话发送 `请用 pwsh 运行 Get-Location`（POSIX 平台把 pwsh 换成 bash）；
2. 看第一条请求的工具清单是否为 2 个、推理是否以 "we need" 开头；
3. 工具调用之后，下一条回复的工具目录应立即变为完整目录；
4. 再发一个输出 >8192 字符的命令（如 `1..3000 | ForEach-Object { "Line $_" }`），
   应看到 `[... micro-inversion: … trimmed …]` 裁剪标记 + `Full result:` 真实路径。

完整验收脚本见 `preset/TEST.md`（含会话日志 `request/header` 线缆级验证方法），
自动化单测见 `test/`（`npm test`，40 项）；提交/发布前跑 `node scripts/validate.mjs`
完整性门禁（语法 / yml 行引用 / 版本一致性），CI 会自动执行两者。

## 评测与取证（可复现 A/B）

`scripts/analyze-session.mjs` 对 `session.export` 解压出的 JSONL（文件或目录）做
证据统计：推理块起手词分类（conform/violation/soft，双语）、锚/裁剪计数、
`request/header` 工具数与 maxTokens、usage 汇总（input/output/cacheRead/reasoning）：

```sh
node scripts/analyze-session.mjs session.jsonl          # 人类可读
node scripts/analyze-session.mjs --json session.jsonl   # 机器可读
```

评测纪律见 `MAINTAINING.md`：off 臂必须干净隔离、报告必须同时给质量与 token、
禁止从单次采样宣称无条件省 token。

## 配置旋钮

在 `preset/agent.cordis.yml` 中修改（v5 起未知配置键只告警不报错，单个拼写
错误不会再让整个预设挂载失败）：

- **tool-bootstrap**：`shellTools` / `commonTools` / `messageSources` /
  `anchorGate`（默认关，开则要求首个推理块含 "we" 且无 "let me" 才晋升）/
  `maxBootstrapSteps` / `promoteAfterFirstResponse` / `bootstrapMaxTokens` /
  `postCompactionMaxTokens`（v5，compaction 后受控阶段输出预算，默认不限）/
  `compactionTools` / `deferredSources` / `deferredGraceSteps` / `instructionHint`。
- **context-slimmer**：`resultTrimThresholdChars`（8192）/ `resultHeadChars`（4096）/
  `resultTailChars`（1024）/ `pressureRatio`（0.8）/ `surfaceHeadChars` /
  `surfaceTailChars` / `spillResults`（默认开）/ `spillTrimmedSurface`（默认关）/
  `skipTools` / `dropProtectedUnderPressure`（v5 最后手段，默认关：中段全为
  保护消息时不裁剪；开则裁剪且标记注明）。
- **anchor-sustainer**：`maxAnchorsInSurface`（1）/ `anchorAfterToolResult`
  （false）/ `throttleAfterConforms`（v6，默认 4：连续 N 个合规推理块后跳过 L2
  近场锚，0 关闭；任意 soft/违规起手词重置连击并立即重新武装）；起手词检测为
  内置中英文双语，无需配置。

改完 `.mjs` 后，把组合文件里对应行的 `?v=N` 缓存戳加 1（破 Node ESM 模块
缓存），再重启 `dsh web`。详见 `preset/NOTICE.md`。

## 行为说明与已知边界

- **web 工具 `fetch: false`**：本预设默认只搜索不抓取网页（token-lean 取舍）。
  需要抓取 URL 时把 `tool-web` 的 `fetch` 改为 `true`。
- **中文思维链**：v5 起 `classifyReasoning` / `classifyOpener` 同时识别
  "我们需要/我们来/让我们" 与 "让我/我想/我认为" 等起手词；若希望 persona
  强制中文起手，把 persona 文本中的 "we need" 替换为 "我们需要"（组合文件内有
  中文变体注释）。
- **子代理首轮受限**：spawn/fork 出的子代理若继承本组合，其首个请求同样处于
  阶段一（2 工具 + 1024 上限），首次工具调用即晋升。
- **旧会话绑定旧组合**：已存在的会话绑定创建时的 standing mount，升级预设只对
  新会话生效。
- **spill 文件**：全文落盘到 `%TEMP%\dsh-spill-*`（POSIX `$TMPDIR`），由
  宿主 spillStore 管理生命周期；本预设不负责清理。
- **锚的持久化**：L2/L3 锚以 `user/message` 事件进入持久日志（保证 resume 后
  语义一致）；请求面只保留最新 `maxAnchorsInSurface` 条（v4），日志累积由
  `/compact` 摘要处理。
- **稳态锚降载（v6）**：连续 `throttleAfterConforms` 个合规起手词后，L2 近场锚
  停止注入（L1 persona 仍在系统提示词中强制协议；**任意** soft/违规起手词——
  含"刚读到结果"式观察续写——立即重置连击并在下一步重新武装）；升级态
  （drift level ≥ 1）永不降载；L3 结果锚永不降载（工具转场是漂移高发点）。
  降载/重新武装的切换会写入会话日志，`analyze-session.mjs` 可据此核对实际锚数。

## 兼容性

- 面向 dsh `0.1.1-rc.x`（web profile）；依赖 `dsh-agent-presets` 默认的
  `includeUserRoot`（未改配置即可）。
- 钩子消费的事件/服务：`system-prompt/assemble`、`agent/pre-step`、
  `agent/request`、`tools/post-execute`、`session/event`（均为 prepend 监听）；
  `tools` / `systemPrompt` 注入，`spillStore` / `tokenMeter` / `llm` 走
  `ctx.get`（缺失即降级，绝不阻塞请求）。这些都是 rc 内部契约，宿主升级时
  若接口变化，组合会降级为完整目录并告警，不会锁死会话。
- 阈值与压力口径与 `dsh-compaction-basic` 一致（0.8 / `totalTokens` / `contextWindow`）。

## 许可与归属

MIT。`tool-bootstrap.mjs` 改编自 `liangshen` preset 的
`tool-bootstrap.mjs`（其本身衍生自 [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)，
MIT），去掉了 PTC-Mode 代码呈现机制，保留并改写了锚定/晋升状态机。
