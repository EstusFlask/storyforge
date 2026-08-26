# RACE-5 完成卡：Codex 抽取与创意补全分离

日期：2026-08-22  
施工单元：RACE-5  
状态：完成

## 已实现

- `world-origin.codex-extract` 只接受 `provenance=verbatim-extraction` 的候选。每个词条必须提供 1–5 条 `evidenceQuotes`，名称和每条引文都必须逐字存在于作者来源。
- 信息不足时 `[]` 是合法候选，可由作者确认为零写入终态；不为了“拆出东西”而伪造设定。
- 新增独立 `world-origin.codex-enrich` Skill 和 `codex.enrich` Prompt。它读取已登记的 worldview/storyCore/characters/storyArcs 及当前 Codex 基线，输出 `provenance=ai-created-suggestion`、`evidenceQuotes=[]` 的候选。
- 抽取和补全使用独立入口、Skill/Prompt 绑定、Run 请求、候选标记和恢复过滤；两者需要各自的作者确认。
- 两种路径复用已有 durable checkpoint、分块/恢复、scope、stale、冻结选择、原子 `adopt()` 和终态回执，没有新建第二条写入旁路。
- 即使作者自定义 Prompt，Harness 也会附加不可覆盖的 provenance/证据输出合同；合同版本进入 Prompt hash 与 stale 边界。
- UI 分成“AI 从内容拆分词条”和“AI 补全新词条建议”两个入口；前者展示原文引文，后者显示“AI 新建建议 · 非原文抽取”。

## 证明不会跨域顺写

- `R-RACE1-races-gateway-canary` 在采纳 `worldviews.races` 后明确断言 `codexEntries=0`。
- Codex 的两个 Skill 写集只有 `codexEntries`；世界观 Skill 写集只有登记的 `worldviews` 字段。
- 新词条仍只经 `FIELD_REGISTRY` / `AdoptionSchema` / `adopt(add-many)` 写入，候选展示不直接调 store。

## 验证

- `R-RACE5-codex-extraction-enrichment`：3 项端到端回归，覆盖缺引文阻断、空抽取、独立补全、刷新恢复过滤、采纳与 worldview stale。
- `R-HARNESS70-codex-extraction-durable`：21 项 durable/故障/作用域/幂等采纳回归。
- `R-HARNESS70-codex-panel-ui`：6 项，包括补全的独立入口和来源标记。
- Prompt seed 完整性、Task Routing、Skill Registry、三注册表架构检查、AI 手册、TypeScript 全部通过。

## 边界

RACE-5 先完成候选级 provenance 和原文引文。Codex category/entry/custom field/原文来源的 Context Gateway V3 资源化与更大范围推广属于 Phase 2 `CODEX-1`。
