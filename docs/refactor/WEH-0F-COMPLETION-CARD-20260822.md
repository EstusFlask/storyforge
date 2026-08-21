# WEH-0F 完成卡：Prompt Engine 真接入

- 单元：WEH-0F
- 日期：2026-08-22
- 分支：`refactor/world-engine-harness`
- 前置：`19b6bc9`（WEH-0E）

## 完成结果

1. 新建 `PromptExecutionRequestV1`、`PromptExecutionOptionsV1` 和 `PromptExecutionEvidenceV1`：
   - 新 Run 在计划创建时冻结激活的 PromptTemplate 全文；
   - 冻结模板 ID、名称、scope、updatedAt、模板 hash、参数 hash、override hash；
   - 实际执行记录 rendered messages hash 与最终 temperature/maxTokens。
2. 世界基座字段、故事核心字段和角色创建正式节点均从冻结模板调用 `renderPrompt()`。
3. system override 只进入 system role，user override 只进入 user role；作者补充是独立 user message。
4. 结构、写入权限、目标字段和作用域约束由 Harness 作为独立 system message 注入，模板或 override 不能移除。
5. 三个分步骤 UI 改为 `submitTargetedRequest()`，直接固定 Agent Skill 和 Prompt 模块，不再把参数/override 混入作者文本。
6. 删除旧 160/240/360/640/1000 字符静默截断；作者要求在 8000 字符内逐字保留，超限在模型调用前明确失败；override/参数也有显式上限。
7. durable 主计划、plan hash、Run Contract execution binding 和候选证据串联同一 Prompt 身份：
   - 新 Run 暂停后即使切换激活模板，恢复仍使用计划中的旧模板；
   - 历史计划没有冻结模板时继续历史手写路径，不读取最新模板，也不伪造 WEH-0F 证据。
8. durable 解析会拒绝 Prompt 模块与 Skill 不匹配、未声明模板参数、非法类型/长度、冻结内容 hash 被篡改、候选证据与计划不一致。
9. 架构检查新增 ⑱，持续阻止三条入口退回手写 Prompt、UI 静默截断或丢失 durable Prompt 证据。

## 设计裁决

Run Contract 在执行前绑定可预知且不可变的模板与运行选项；依赖实际上下文和上游候选后才能产生的 `renderedPromptHash` 随候选/Run evidence 保存。没有把尚未形成的实际消息 hash 伪装成预执行契约字段。

## 验证证据

- WEH-0F 新回归：2 files / 6 tests 通过。
- Prompt/世界观/故事/角色/Master durable 扩展回归：14 files / 70 tests 通过。
- 全量回归首次运行：445 files，2104/2105 tests 通过；唯一失败为 AI manual 自动生成文件漂移。
- 重新生成 AI manual 后，manual + WEH-0F：3 files / 10 tests 通过；因此全量失败项已独立复验通过。
- 10 项工程检查：required tables、AI manual、AI entry registry、architecture、source reachability、roadmap、agent context、agent freshness、canon coverage、project metrics 通过。
- `npm run lint`：通过。
- `npx tsc --noEmit`：通过。
- `npm run build`：通过（3945 modules transformed）。
- `git diff --check`：通过。

## 未进入本单元的内容

- WEH-0H 的机器可验证正式 AI 入口绑定。
- WEH-0G 的汇总证据 UI、统一故障门和 Phase 0 总完成卡。
- Context Gateway、渐进式披露和长篇检索能力。

## 下一单元

`WEH-0H`：用版本化 `FormalAIEntryBindingV1` 收口正式 AI 入口，并使未登记或别名/wrapper 旁路在 CI 中 fail closed。
