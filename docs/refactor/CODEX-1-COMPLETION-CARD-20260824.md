# CODEX-1 完成卡（2026-08-24）

## 完成边界

- 保留并强化 `world-origin.codex-extract` / `world-origin.codex-enrich` 两个独立 durable Skill；逐字抽取与 AI 创意补全不共用输出语义。
- 两个 Skill 的正常 Canon 读取都已迁入 required Context Gateway。抽取只开放 Codex 分类/词条资源；补全按任务从 World Canon 目录选择，不再维护 worldview/storyCore/characters/storyArcs 固定来源大包。
- 目标分类和同类既有词条是 Mandatory Full；分类 schema、自定义字段和词条均使用 portable resource UID，可在多世界 scope 中寻址。
- 原始作者文本继续作为逐字冻结来源进入分块；Gateway selector、retrieval trace 和完整 Context Packet 随 plan/candidate 持久化并参与刷新、恢复和 stale 判断。
- `codexEntries` 新增正式 provenance：`origin`、`sourceEvidenceQuotes`、`sourceContentHash`、`producerRunId`、`producerCandidateHash`。作者采纳后仍能区分逐字抽取与 AI 建议，并回溯产生它的 Run 和冻结候选。
- 短文返回 `[]` 仍是合法候选；系统不会为了制造“成功”强行新建词条。

## 三注册表与生命周期

- 读：Skill 只声明 `manualText` / `ragSelection`；Context Gateway 从 `PROJECT_TABLES.resourceIdentity` 和 `FIELD_REGISTRY` 派生 category、entry 与 custom field 资源。
- 写：新增 provenance 字段全部进入 `FIELD_REGISTRY`，并由两个 Skill 的 `writeTargets` 与 required Gateway targets 同源声明；最终仍只经 `adopt(codexEntries)` 写入。
- 表：DB v65 为 `codexEntries.producerRunId` 建立生命周期索引并迁移历史默认值；该字段已进入 `PROJECT_TABLES` export remap，`agentRuns` 删除时 set-null，不级联删除作者已采纳词条；历史词条明确迁移为 `origin=manual`，不会伪造 AI 来源。
- scope：修复项目级共享 `codexCategories.worldGroupId=null` 在多世界目录中被误判为主世界专属的问题。

## 验证证据

- `R-CODEX1-gateway-provenance`：3/3。覆盖 required Gateway、分类/自定义字段资源地址、逐字抽取与 AI 补全两次独立采纳、正式来源证据。
- `R-CODEX1-v65-migration`：历史人工词条无损升级、来源默认值和 `producerRunId` 生命周期索引。
- `R-HARNESS70-codex-extraction-durable` + `R-RACE5-codex-extraction-enrichment` + UI：30/30。
- Context Gateway / registry 定向回归：37/37。
- `npm run check:architecture`、`npm run check:required-tables`、`npx tsc --noEmit` 已通过；AI manual 已重新生成。

## 未越界声明

本卡只签收 `CODEX-1`。Phase 2 的跨域统一门由 `GATE-P2` 单独验收；Phase 3 的故事线、大纲、细纲、正文和演化链尚不能因本卡宣称完成。
