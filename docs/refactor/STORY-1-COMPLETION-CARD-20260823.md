# STORY-1 完成卡 · 故事核心意图层与故事线投影

日期：2026-08-23  
状态：完成；允许进入 `CHAR-1`

## 完成边界

- `storyCores` 七个字段由 `STORY_CORE_GENERATABLE_FIELD_SPECS` 单一声明派生，Skill 写集、Gateway required 目标、UI 字段集合、字段模式、输出 schema 与长度边界不再分别手写。
- 七字段正式进入 required Context Gateway。当前目标已有内容时以 Mandatory Original 精确冻结；空态可结合项目名的低权重灵感和已存在的世界、角色、故事线、大纲证据生成候选。
- durable runner 不再只识别 `worldviews.*` Gateway canary；`storyCores.*` 和 `storyArcs.*` 使用同一 preflight、exact evidence、freshness 与 adoption 门。
- `storyCore.mainPlot/subPlots` 被定义为作者意图摘要；`storyArcs` 是独立的 1:N 可执行投影。生成故事线不会反向写故事核心，也不执行字段到故事线的自动一对一覆盖。
- AI 故事线采纳记录 `origin/status/sourceStoryCoreId/revision/hash/lastAlignedHash/producerRunId/candidateHash`。意图变化后 UI 显示漂移，旧候选由 CAS 阻断；既有故事线不会被自动覆盖。
- Dexie v64 为两条来源引用增加索引；旧故事线仅补 `manual/active`，不猜测 StoryCore 或 Agent 来源。删除来源通过 `PROJECT_TABLES` setNull，导入导出通过注册重映射。

## 三注册表结论

- 读：正式模型输入由 Skill `contextGateway` + `ragSelection` Provider 选择，目标故事字段和全部非空故事意图使用 Original 读取。
- 写：七个故事字段和故事线 provenance 字段均登记于 `FIELD_REGISTRY`；候选仍经 `CreativeArtifact/GenerationNode`、作者确认和 `adopt()`。
- 生命周期：`storyCores -> storyArcs[sourceStoryCoreId]`、`agentRuns -> storyArcs[producerRunId]` 与两项 `exportRemap` 均登记在 `PROJECT_TABLES`。

## 验证证据

- `R-STORY1-story-intent-projection`: 12 项，包括七字段同源、七字段 Original、全意图读取、1:N 零写入、provenance、drift/stale、删除反例。
- `R-STORY1-v64-migration`: 旧故事线原文保持，来源不猜测，新索引存在。
- 既有 STORY/HARNESS/UI 与 WE-1 回归：7 文件、70 项全绿。
- `check:architecture`、`check:required-tables`、`check:ai-manual`、`tsc --noEmit`、生产构建和 `git diff --check` 通过。

## 明确不在本单元冒充完成的内容

`STORY-1` 建立重规划候选所需的意图 hash、投影 provenance、漂移与一对多新增基础；对既有 arc 的扩写、重写、润色、合并、拆分、废弃及 stage/progress 操作合同属于 Phase 3 `ARC-1`，必须在该单元实现并通过对应门，不在本卡提前宣称完成。
