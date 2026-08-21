# WEH-0A 完成卡：Agent Skill 唯一运行契约

> 日期：2026-08-21
> 分支：`refactor/world-engine-harness`
> 基线：`2c9ad713cb5e5201a191a3c8fcbfc641a592af1e`

## 1. 完成边界

WEH-0A 已把正文生成/续写、正文语义评审/修订以及卷纲/章纲正式 durable 入口切换到 `AgentRunContractV2`。V2 Run 必须冻结完整 Skill definition、上下文访问策略、Prompt、Tool schema、实际来源、可选来源激活理由、写权限和输出预算；Run 顶层权限必须精确等于步骤 binding 并集。

正式 UI 不再拥有正文或大纲生成来源数组：

- 正文从 `prose.generate` / `prose.continue` Skill 解析；`activeNarrativeBlueprint` 默认进入实际装配。
- `characterKnowledge` 只有在明确 POV 角色存在时激活，并绑定 POV 边界 hash。
- 大纲从 `outline.volumes` / `outline.chapters` Skill 解析；`priorOutlineCandidate` 只有在同批次前序候选确实存在时激活，并绑定候选 hash。
- Context Manifest 的 declared sources 与 `assembleContext()` 的实际 source evidence 必须精确匹配冻结 binding。
- 正文语义 review/revise/rereview 复用同一套 V2 可选来源边界，不再在运行时降级构造 V1 binding。

历史 V1 Run 保持原样可读；V2 Run 已通过便携编号导出/重绑定回归。旧常量仅保留为从 Skill 派生的只读兼容别名，不再拥有配置权。

## 2. 三注册表与生命周期

- 读：所有实际来源仍必须来自 `CONTEXT_SOURCES`；WEH-0A 没有新增上下文注册表。
- 写：正文权限修正为 `chapters.content + chapters.wordCount`；大纲权限修正为实际可采纳的 `parentId/type/title/summary/order`，均受 `FIELD_REGISTRY` 与 AdoptionSchema 校验。
- 表：没有新增表或平行 evidence store；`agentRuns/agentRunEvents/agentRunCheckpoints` 继续由 `PROJECT_TABLES` 派生导入、导出、删除和记忆生命周期。

## 3. 删除或封死的漂移

1. `ChapterEditor` 的正文手写来源清单已删除，避免 Skill 含 Blueprint、真实请求却漏读。
2. `OutlinePanel` 的固定来源常量已删除，避免普通大纲无条件读取 prior candidate。
3. Run、Manifest、shadow/durable trace 使用同一 binding；声明集合与实际装配集合不一致立即失败。
4. `check:architecture` 新增 ⑬ 守卫，阻止 UI 手写来源和正式 V2 契约回退。
5. AI 功能手册重新由 Skill 注册表生成，文档不再保存另一份可编辑真相。

## 4. 回归证据

定向回归：13 个测试文件、82 项测试全部通过，包括：

- `R-WEH0-skill-runtime-contract`：8 项（Blueprint、POV、prior candidate、权限、篡改、便携恢复、Manifest 精确集合、UI 旁路）。
- `R-HARNESS0/1/7/11/13/19/21`：合同、shadow、正文、大纲、批量、语义链和父子 lineage。
- `R-MEMORY-8-settlement-context-v2`：记忆结算兼容。
- `R-export-derive-roundtrip`、`R-export-import-roundtrip`：导入导出兼容。

门禁通过：

- `npm run check:architecture`
- `npm run check:required-tables`
- `npm run check:ai-manual`
- `npm run check:agent-context`
- `npm run check:agent-freshness`
- `npm run check:source-reachability`
- `npm run check:canon-coverage`
- `npm run check:ai-entry-registry`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `git diff --check`

## 5. 诚实边界与下一依赖

WEH-0A 只解决“谁定义正式运行所读、所写、所用版本”以及证据一致性，没有宣称大纲完整链已经 fail-closed。当前大纲 controller 仍可能在 durable trace/candidate/adoption 某阶段失败后继续旧路径，这属于下一单元 `WEH-0B`；保存竞态、候选编辑竞态、结构化输出和 Prompt Engine 分别属于 WEH-0C～0F。

回滚时可整体回退本单元提交；V1 parser/reader 未删除，回滚不需要 schema migration，也不触碰作者 Canon 数据。
