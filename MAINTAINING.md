# 维护手册（MAINTAINING）

微逆标准模式（Micro-Inversion Standard）的维护纪律，借鉴 odai 组件的工程约束
（canonical 单一事实源 / 完整性门禁 / 版本策略 / 评测契约）。任何改动前先读本文件。

## 单一事实源

- `preset/` 是唯一可编辑的预设源码；`preset/tool-bootstrap.mjs`、
  `preset/context-slimmer.mjs`、`preset/anchor-sustainer.mjs` 各自只承担自己的
  职责（晋升状态机 / 上下文瘦身 / 全局锚），机制不互相复制。
- 改动行为时，**同步更新**：`preset/agent.cordis.yml`（rev 注释 + `?v=` 缓存戳 +
  配置块）、`README.md`、`preset/NOTICE.md`、`preset/TEST.md`、`CHANGELOG.md`；
  行为性改动必须补 `test/` 单测。文档副本漂移视为缺陷。
- `docs/` 只放设计/总结类长文；对外能力、版本与迁移口径只以
  `CHANGELOG.md` + `README.md` 为准。

## 缓存戳规则（?v=）

- 修改任一 `.mjs` 后，把 `agent.cordis.yml` 里对应行的 `?v=N` 加 1
  （破 Node ESM 模块缓存；只改 yml 不会重载模块）。
- 若某插件内部 `import './other.mjs?v=N'`，其 `?v` 必须与该插件**行名**一致，
  否则出现模块双实例（当前版本无内部 import，未来加回时务必遵守）。
- 改完必须重启 `dsh web` 才对**新会话**生效；旧会话绑定创建时的组合。

## 改动门禁（提交前必须全过）

```sh
node scripts/validate.mjs   # 零依赖静态门禁：语法 / yml 行引用 / 版本一致性 / dist 提示
npm test                    # node:test 全套（当前 40 项）
node --check preset/*.mjs   # （validate.mjs 已含，可省）
```

- `scripts/validate.mjs` 为 fail-closed：任何硬检查失败禁止提交/发布。
- CI（`.github/workflows/integrity.yml`）在 push/PR 时自动跑 validate + test。

## 版本与发布

- 升版三处必须一致：`package.json` version、`CHANGELOG.md` 顶部标题、
  `publish.ps1` 默认 `-Tag`。发布前重建 `dist/<pkg>-v<version>.zip`（结构含
  顶层文件 + `preset/` + `test/` + `scripts/` + `docs/`，见现有 zip 布局）。
- 发布流程：`git commit` → `git push` → `git tag vX.Y.Z` → `git push origin vX.Y.Z`
  → GitHub Release + zip 资产（本机可用 `publish.ps1 -Token <PAT>` 或
  `curl --ssl-no-revoke` + 凭据管理器 token）。
- 提交信息遵循 `vX.Y.Z: <一句话>` 风格；CHANGELOG 只记已冻结版本的对外能力。

## 评测契约（诚实性要求）

- A/B 的 **off 臂必须在干净隔离会话运行**：不读取或注入 preset 文件、`.odai`、
  本仓库指令或既往会话转录；不满足隔离条件的 off 结果不能当正式基线。
- 报告必须同时给出 on/off 的质量分与 token（input/output/cacheRead/reasoning），
  并注明任务类型；**禁止**从单次采样宣称"无条件省 token"或"无条件提质"。
- 取证用 `scripts/analyze-session.mjs`（对 `session.export` 解压出的 JSONL）：
  起手词分类（conform/violation/soft）、锚/裁剪计数、usage 汇总，保证可复现。
- 已知边界（实测，勿反向宣传）：微逆只对**推理密集型**任务显著省 token
  （输出 −73%、推理 −86%）；**工具执行密集型**长编码任务不省反增（计费输入 +50%）。

## 旋钮新增规则

- 新旋钮默认值必须保守（宁可不生效，不可破坏既有保证）；未知键只告警（v5 起），
  但类型/范围错误必须抛错。
- 以减少 token 为目的的改动，必须先用行为契约与单测证明既有能力（we-need 保证、
  保护性裁剪、soft 不升级）不退化，再评估节省是否成立。
