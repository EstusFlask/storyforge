# WEH-0E 完成卡：统一结构化输出与一次 repair

> 完成日期：2026-08-22  
> 分支：`refactor/world-engine-harness`  
> 基线：WEH-0D `4d9807f`

## 1. 完成边界

本单元建立了一个正式结构化输出真相源 `StructuredOutputPipelineV1`，并把世界观字段、故事核心、创作规则、角色创建/补全/重规划、角色驱动规划、故事线进度、细纲、灵感反推、大纲、故事线和世界游戏候选接入同一分类与证据合同。

正式 Master Harness 现在执行：

```text
raw model response
→ 原文证据
→ 确定性 normalize/salvage
→ strict schema
→ node target / permission / scope gate
→ 最多一次定向 repair
→ candidate evidence 或不可采纳失败证据
```

完成内容：

1. 只允许 BOM、外层空白、单一 JSON 围栏、唯一平衡 JSON 根和登记字段 alias；拒绝 JSON5、截断补全、竞争 JSON 根和创作性猜测。
2. parse/schema/target 错误统一为带 `code/category/path/fingerprint/repairable` 的机器问题；scope、permission、stale、length 明确不可自动 repair。
3. `runBudgetedGenerationNode()` 将结构错误和 gate 错误合并到同一个 Canon retry 额度；repair Prompt 不重新携带完整项目上下文。
4. 第二次仍失败时保存两次 raw attempt，状态为 `manual-repair` 或 `blocked`，不产生 candidate，不允许采纳。
5. repair 耗尽后的 durable failure 被分类为不可重试的 `structured_output_repair_exhausted`；不能在恢复时把整步当普通协议错误重新运行。
6. 成功/修复证据随 Master candidate payload 和 durable Run 保存；恢复时验证状态、步骤、alias、issue 指纹、repair 身份与最终状态一致性。
7. 错误事件也保存 raw evidence，并明确 `adoptable: false`；没有通过 parser/gate 的值不能进入正式写路径。
8. 旧 CreativeArtifact 继续作为创作候选可靠性合同；新的结构证据是其底层解析/调用证据，不建立第二套 Canon 或采纳入口。

## 2. 兼容与生命周期

- 没有新增表或业务字段；`PROJECT_TABLES` 生命周期不变。
- `MasterCandidatePayload.structuredOutputEvidence` 是可选字段，旧候选和旧 Run 继续可读。
- 正式写入仍只经过 `FIELD_REGISTRY / AdoptionSchema / adopt()` 或已登记扩展；parser 无写权限。
- `CONTEXT_SOURCES` 不变；repair 不重新查询 Canon，也不扩张原 Skill 的来源集合。
- AI 手册已重新生成，正式入口数量与源码一致。

## 3. 关键反例

- BOM、围栏、带说明的唯一平衡根无需模型调用即可规范化，并记录具体步骤。
- 两个竞争 JSON 根、JSON5、截断 JSON、未知/缺失字段、错误 enum 均 fail-closed。
- 世界观、故事、角色和细纲对同一种非法 JSON 给出相同 parse 分类。
- 可修错误最多两次总调用；第二次失败不产生第三次调用并保留两版 raw。
- provider、取消、scope、permission、stale、超长均无额外调用。
- repair Prompt 不含原始正式上下文。
- 导入或恢复时篡改 issue fingerprint、status 或 repair 身份会被拒绝。
- repair 耗尽后的 durable Run 暂停，不会在恢复时再次自动消耗模型调用。

## 4. 验证证据

定向与扩大回归：

- WEH-0E、CREL、世界观、故事、角色、补全、重规划、故事线进度、细纲、大纲、灵感、故事线、fan-out、H86 配对评测和世界游戏：14 files / 99 tests 全部通过。
- 扩大 `tests/regression + tests/canon`：首次 421 files / 1995 tests 通过；两处新合同断言已修正并定向复跑通过；一处并行负载下 60 秒超时的确定性文字冒险用例单独复跑 7/7 通过。

完整单元门禁：

- `npm run check:architecture`
- `npm run check:required-tables`
- `npm run check:ai-manual`
- `npm run check:agent-context`
- `npm run check:agent-freshness`
- `npm run check:source-reachability`
- `npm run check:canon-coverage`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `git diff --check`

以上全部通过。

## 5. 明确非范围

- 本单元不修改 Prompt 模板所有权；真实 Prompt Engine 接入属于 WEH-0F。
- 本单元不增加 Context Gateway 动态读取；repair 只能使用原 raw 和确定性问题。
- 章节细纲的独立 CreativeArtifact UI 仍保留“结构失败后作者手动编辑再校验”的零隐藏重试路径；它同样使用统一 parser，自动额外调用为 0。
- 结构化运行证据的作者可视化属于 WEH-0G。

## 6. 回滚

可以关闭自动 repair，但不能恢复 JSON5、截断补全、竞争根选择、各领域自定重试次数或未验证值进入采纳。回滚时须继续保留 strict parser、raw evidence 和不可采纳失败状态。

