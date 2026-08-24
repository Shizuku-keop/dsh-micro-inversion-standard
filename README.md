# dsh-micro-inversion-standard（微逆标准模式）

一个可复用的 **DSH Agent Preset**：双阶段、Token 精益的编码智能体模式。

核心目标：把模型思维链的起手习惯从 "let me" 翻转为 **"we need"**，同时把上下文占用与
Token 消耗压到最低，并保持供应商 KV Cache 对未变前缀持续命中。

> 这是 DSH **Agent Preset**（预设），不是 web profile 插件。DSH 通过扫描
> `<dshHome>/.agent-presets/<id>/` 目录来发现预设（`dsh-agent-presets` 的
> `includeUserRoot` 默认开启），因此"安装"就是把本仓库的 `preset/` 目录原样
> 放进该位置，然后重启 `dsh web`。

## 四项核心能力

1. **首轮锚定（Bootstrap）** — 第一条请求只暴露 Minimal 双工具
   （持久 shell `bash`/`pwsh` + `str_replace_editor`），系统提示词只留 persona
   与 "we need" 推理协议，输出预算钳制在 1024 token，强制第一条推理块以
   "we need …" 起手。
2. **动态晋升（Dynamic Promotion）** — 同一 Session 内，首次工具调用或首次
   实质性回复后立即解锁完整标准工具目录（fs / 检索 / jobs / skills / goals /
   plan / subagents / workflows / ask-user / todo / web …），恢复全部提示词
   sections 与运行时上下文；compaction 后重置回受控阶段，等新的晋升信号。
3. **上下文瘦身（Context Slimming）** — `tools/post-execute` 把超过 8192 字符
   的工具结果裁剪为 头4096 + 标记 + 尾1024，全文落盘为会话作用域 spill artifact
   并在标记中给出真实路径；`agent/pre-step` 在 token 压力达到路由模型窗口 80%
   时把请求面中段消息替换为一条恒定标记（持久日志保留全文，`/compact` 负责持久摘要）。
4. **Token / KV Cache 优化** — 两个阶段的系统提示词与工具目录各自字节级稳定，
   新内容只追加在尾部，裁剪只替换连续中段，未变前缀始终可被供应商缓存命中。

## 目录结构

```
micro-inversion-standard/
├── preset/                    ← 直接安装的预设目录（整体复制）
│   ├── preset.yml             ← 选择器元数据（name / description）
│   ├── agent.cordis.yml       ← Agent 平面组合（persona + 双钩子 + 标准目录）
│   ├── tool-bootstrap.mjs     ← 阶段一锚定 + 动态晋升状态机
│   ├── context-slimmer.mjs    ← 结果裁剪/落盘 + 80% 压力中段压缩
│   ├── NOTICE.md              ← 实现说明（四项需求如何落地）
│   └── TEST.md                ← 验收测试脚本
├── install.ps1                ← Windows 安装脚本
├── install.sh                 ← POSIX 安装脚本
├── README.md
├── LICENSE                    ← MIT（含 dsh-anchored-standard 归属）
├── CHANGELOG.md
└── package.json               ← npm 发布元数据（默认 private）
```

`agent.cordis.yml` 里的两个钩子行名是 `./tool-bootstrap.mjs?v=N`、
`./context-slimmer.mjs?v=N`（相对路径 + 缓存戳），所以 **`preset/` 必须整目录
原样复制**，不能只拷组合文件。

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

脚本会把 `preset/` 复制到 `%USERPROFILE%\.dsh\.agent-presets\micro-inversion-standard`
（POSIX 为 `$HOME/.dsh/.agent-presets/micro-inversion-standard`）。

### 方式 B：手动复制

把本仓库 `preset/` 目录整体复制为：

```
<dshHome>/.agent-presets/micro-inversion-standard/
```

Windows 默认 `dshHome` = `%USERPROFILE%\.dsh`，POSIX 默认 = `$HOME/.dsh`。
（若部署配置了其它 preset root，以 `dsh-agent-presets` roster 报告的路径为准。）

### 安装后

1. **重启 `dsh web`**（roster 按需扫描用户根目录，新预设需要重启才可见）；
2. 新建会话，在预设选择器里选 **「微逆标准模式 (Micro-Inversion Standard)」**；
3. 第一条请求应只看到 `bash`/`pwsh` + `str_replace_editor` 两个工具，推理以
   "we need" 起手；首次工具调用或首次回复后工具目录立即变为完整标准目录。

## 快速验收（30 秒版）

1. 新会话发送 `请用 pwsh 运行 Get-Location`（POSIX 平台把 pwsh 换成 bash）；
2. 看第一条请求的工具清单是否为 2 个、推理是否以 "we need" 开头；
3. 工具调用之后，下一条回复的工具目录应立即变为完整目录；
4. 再发一个输出 >8192 字符的命令（如 `1..3000 | ForEach-Object { "Line $_" }`），
   应看到 `[... micro-inversion: … trimmed …]` 裁剪标记 + `Full result:` 真实路径。

完整验收脚本见 `preset/TEST.md`（含会话日志 `request/header` 线缆级验证方法）。

## 配置旋钮

在 `preset/agent.cordis.yml` 中修改：

- **tool-bootstrap**：`shellTools` / `commonTools` / `messageSources` /
  `anchorGate`（默认关，开则要求首个推理块含 "we" 且无 "let me" 才晋升）/
  `maxBootstrapSteps` / `promoteAfterFirstResponse` / `bootstrapMaxTokens` /
  `compactionTools` / `deferredSources` / `deferredGraceSteps` / `instructionHint`。
- **context-slimmer**：`resultTrimThresholdChars`（8192）/ `resultHeadChars`（4096）/
  `resultTailChars`（1024）/ `pressureRatio`（0.8）/ `surfaceHeadChars` /
  `surfaceTailChars` / `spillResults`（默认开）/ `spillTrimmedSurface`（默认关）/
  `skipTools`。

改完 `.mjs` 后，把组合文件里对应行的 `?v=N` 缓存戳加 1（破 Node ESM 模块缓存），
再重启 `dsh web`。详见 `preset/NOTICE.md`。

## 卸载

```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.dsh\.agent-presets\micro-inversion-standard"
```

（POSIX：`rm -rf "$HOME/.dsh/.agent-presets/micro-inversion-standard"`）然后重启
`dsh web`。删除不影响任何已运行会话；新会话不再出现该预设。

## 兼容性

- 面向 dsh `0.1.1-rc.x`（web profile）；依赖 `dsh-agent-presets` 默认的
  `includeUserRoot`（未改配置即可）。
- 钩子消费的事件/服务：`system-prompt/assemble`、`agent/pre-step`、
  `agent/request`、`tools/post-execute`、`session/event`（均为 prepend 监听）；
  `tools` / `systemPrompt` 注入，`spillStore` / `tokenMeter` / `llm` 走 `ctx.get`
  （缺失即降级，绝不阻塞请求）。
- 阈值与压力口径与 `dsh-compaction-basic` 一致（0.8 / `totalTokens` / `contextWindow`）。

## 一键发布（publish.ps1）

仓库自带 `publish.ps1`：建仓 → 推送 → 打 tag → 创建 GitHub Release 并上传 zip 附件，
一条命令完成（在**有外网**的机器上运行）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\publish.ps1 -Token <PAT>
```

- Token：classic PAT（`repo` scope）或 fine-grained PAT（`Administration:write` 建仓 +
  `Contents:write` 推送）；token 只在本进程使用，推送完成后脚本会把本地 `origin`
  改回不含 token 的干净 HTTPS 地址。
- 开关：`-Visibility private`（默认 public）、`-SkipCreate`（仓库已存在）、
  `-SkipRelease`（只推 tag 不建 Release）、`-Tag v1.0.1`、`-RepoName <name>`。
- Release 附件来自 `dist\dsh-micro-inversion-standard-<tag>.zip`（`git archive` 产物，
  不入库）。更新版本时先改 `package.json` 版本号与 `CHANGELOG.md`，再跑本脚本。

## 发布到 GitHub

### 1. 在 GitHub 上创建仓库

- 打开 https://github.com/new ，仓库名建议 `dsh-micro-inversion-standard`；
- 公开/私有按你偏好，**不要**勾选 "Add a README / .gitignore / license"
  （仓库里已有，避免冲突）；
- 复制仓库地址（HTTPS 或 SSH 均可）。

### 2. 本地初始化并关联远程

```bash
# 进入本仓库目录（如尚未 git init）
git init
git add .
git commit -m "feat: package micro-inversion-standard as a reusable preset (v1.0.0)"

# 关联远程（把地址换成第 1 步复制的）
git remote add origin https://github.com/Shizuku-keop/dsh-micro-inversion-standard.git

# 推送到 main 分支
git branch -M main
git push -u origin main
```

### 3. 打 tag / 发 Release（可选，推荐）

```bash
git tag v1.0.0
git push origin v1.0.0
```

然后在 GitHub 仓库页面 → **Releases → Create a new release**，选 `v1.0.0`，
用 `git archive` 或 GitHub 自动生成的 zip/tarball 作为附件，把 README 的安装
步骤贴进 release notes，用户即可下载 zip 解压后运行 `install.ps1` / `install.sh`。

### 4. 之后每次更新

```bash
# 修改 preset/ 里的文件后
git add .
git commit -m "fix: ..."
git tag v1.0.1
git push && git push origin v1.0.1
```

> 提示：升级已有安装时，记得把 `agent.cordis.yml` 里两个 `.mjs` 行的 `?v=N`
> 缓存戳加 1（本包 v1.0.0 已用 `?v=3`），否则改了插件但 ESM 模块缓存不重载。

### 网络受限怎么办（本机实测）

本机直连 GitHub TLS 会失败/超时，可用代理或镜像：

```bash
# 方式 1：git 走 ghproxy 代理拉取/推送（推送仍需要你的凭据）
git remote set-url origin https://ghproxy.net/https://github.com/Shizuku-keop/dsh-micro-inversion-standard.git

# 方式 2：配置 git 全局代理（HTTP(S) 代理）
git config --global http.proxy http://127.0.0.1:7890
git config --global https.proxy http://127.0.0.1:7890
```

或者在能直连 GitHub 的机器上完成 `git push`（仓库本身是纯文本 + 脚本，拷过去即可）。

## 发布到 npm（可选）

本包默认 `"private": true`，防止误发布。若想支持 `npm i -g` 分发：

1. 改 `package.json`：去掉 `"private": true`，把 `name` 改成未被占用的
   `@Shizuku-keop/dsh-micro-inversion-standard`（或 `dsh-micro-inversion-standard`）；
2. 填好 `repository` 字段；
3. `npm login` 后执行 `npm publish`（先跑一次 `npm publish --dry-run` 检查
   `files` 列表是否只含 `preset/` 与安装脚本、README、LICENSE）。

安装脚本本身放在仓库里，用户克隆后运行即可，因此 npm 发布是纯加分项，不是必需。

## 许可与归属

MIT。`tool-bootstrap.mjs` 改编自 `liangshen` preset 的
`tool-bootstrap.mjs`（其本身衍生自 [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)，
MIT），去掉了 PTC-Mode 代码呈现机制，保留并改写了锚定/晋升状态机。
