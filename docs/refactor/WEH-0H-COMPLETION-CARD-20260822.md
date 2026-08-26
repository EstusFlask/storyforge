# WEH-0H 完成卡：正式 AI 入口机器绑定

## 完成结论

`WEH-0H` 已完成。原有“12 个文件 / 23 个 Hook 或裸 chat 次数 + 人工 reason”登记已替换为单一版本化 `FormalAIEntryBindingV1`：当前 32 个操作级绑定覆盖 35 个实际调用，模型执行必须携带稳定 `entryId`，运行时和 CI 同时核验入口、category、Skill、执行边界、候选种类、调用方和采纳权限。

## 交付

- `src/lib/agent/ai-entry-registry.json`
  - 升级为 v2 registry / v1 binding。
  - 入口按操作登记，不再按文件计数。
  - 辅助、评测和实验入口机器声明 `adoptAllowed=false`。
- `src/lib/agent/formal-ai-entry.ts`
  - 严格解析注册表，未知字段、重复 ID、未知 Skill、category 错配和越权采纳 fail closed。
  - `executeRegisteredAIEntryV1()` / `streamRegisteredAIEntryV1()` 成为 UI 模型调用集中执行边界。
  - 支持把完整绑定规范序列化并冻结为 Run snapshot，恢复时校验 hash。
- `useAIStream.start()`
  - 不再允许缺省入口身份；每次请求必须提交 `FormalAICallMetaV1`。
- 现有直接 UI / GenerationNode 调用
  - 正文、审校、地理概念图、章纲、细纲、场景考证、Harness eval、Prompt 示例、自由工作流、模拟运行时和文风校准均已绑定字面量 entryId。
  - UI 不再直接导入底层 `chat` / `streamChat`。
- durable 证据链接
  - 细纲正式 Run 冻结 `outline.detail.scene` / `outline.detail.enhance` 绑定快照。
  - Run Contract 经 `runId` 连接 Context Manifest；候选保存同一 `runId` 与 `manifestHash`；采纳开始前再次验证 Skill 和 `detailedOutlines` 目标。
- CI 与文档
  - AST 守卫覆盖 member、Hook 解构 alias、raw import wrapper 和 namespace member。
  - AI Manual 新增由注册表派生的正式入口表。
  - 架构检查新增 WEH-0H 集中执行、旁路和 durable link 守卫。

## 关键反例

- 删除任一真实入口绑定或增加未登记 entryId：AI entry checker 失败。
- `ai.start()` 缺 entryId、Hook 解构别名缺 entryId：checker 自测失败。
- `chat as ask` 本地 wrapper、`api.chat()` namespace member：checker 自测失败。
- 未知 Skill、未知 schema 字段、重复 ID：严格 registry parser 拒绝。
- entryId 与 category 不匹配：provider 请求前拒绝。
- auxiliary/evaluation/experimental 开启采纳：parser 拒绝。
- Run 内 entry snapshot 被篡改：hash 校验拒绝；细纲入口/Skill/写目标错配时不开始步骤。

## 验证证据

- AI entry：`32 bindings / 35 calls; formal 15, auxiliary 13, evaluation 3, experimental 1`。
- 定向回归：9 个受影响文件、89 项测试通过；WEH-0H 核心 6 项反例通过。
- 完整回归：445 files / 2108 tests 全部通过。
- `check:required-tables`、`check:ai-manual`、`check:ai-entry-registry`、`check:architecture`、`check:source-reachability`、`check:roadmap`、`check:agent-context`、`check:agent-freshness`、`check:canon-coverage`、`check:project-metrics` 通过。
- ESLint、`npx tsc --noEmit`、生产构建（3947 modules）和 `git diff --check` 通过。

## 边界与下一步

- `prompt.workflow.step` 因 category 和 SaveTarget 均由作者自由工作流决定，被明确限制为 `experimental`、内存草稿、`adoptAllowed=false`；模型调用后的显式保存仍是独立作者动作。本单元不把它伪装成单一正式 Skill。
- WEH-0H 解决入口授权和证据身份，不新增用户可见证据汇总、错误归类或开发态故障注入面板；这些由 `WEH-0G` 收口。
- 下一工作单元：`WEH-0G`。
