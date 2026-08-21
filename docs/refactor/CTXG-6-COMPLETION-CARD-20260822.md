# CTXG-6 完成卡：Manifest V3、Retrieval Trace 与精确输入证据

## 结论

- 任务：`CTXG-6`
- 状态：完成，允许进入 `CTXG-7`；本卡不宣称 Phase 1A 已过门，也不宣称正式创作入口已切换。
- 基线：`b73369d5 feat(CTXG-5): add deterministic context selector`
- 实现边界：每个 Run/step/attempt 现在可形成唯一 `ContextManifestV3`，并由现有 Run ledger、`agentRunArtifacts`、Memory Settlement 和 working-context checkpoint 统一治理。

## 已完成的合同与顺序

1. `ContextManifestV3` 内嵌并校验 V1/V2 Manifest hash，同时绑定 Workspace/World/Work 稳定身份、Gateway/Policy/Selector/Catalog/Packet、Sufficiency、Retrieval Trace、Prompt、Candidate 与 working-context generation/checkpoint。
2. 模型请求前必须先持久化 selector result、Context Packet、被选资源原文快照、tool transcript 和 rendered request；密钥或 provider 隐藏推理会在 exact-evidence 边界 fail-closed，不会进入 `model.requested`。
3. finalize 只接受唯一、有序的 `model.requested → model.responded`；所有 preflight artifact 必须在请求前已可逐字回读。然后依次写 raw response、V3 body、`context.assembled`，最后才允许 `candidate.persisted`。
4. 同一 attempt 重复 finalize、Selector/Trace/Packet/Policy/SourceRef 不一致、必读证据未满足、artifact 缺失/被清理/损坏都会 fail-closed。
5. Retrieval decision 新增独立 `policyRevision/policyHash` 证据；候选可分别报告 `content-stale`、`policy-stale`、`source-ref-stale`、scope/policy binding stale，不再把检索策略变化误当成 Canon 内容变化。
6. Selector result 也进入内容寻址 exact artifact；`selectorHash` 可从原文重算，并与 Manifest 中的 inventory/sufficiency/policy 绑定核对。

## 精确证据与生命周期

- 扩展了原有 exact artifact 闭集：`context-manifest`、`selector-result`、`context-packet`、`source-snapshot`、`tool-result`、`rendered-request`、`raw-response`。
- 没有新增数据表；七类证据全部复用 `agentRunArtifacts` 的内容寻址去重、`evidence.artifact.recorded` 的 Run 引用、`PROJECT_TABLES` 的导入导出/删除与 mark-and-sweep / `evidence-pruned` 生命周期。
- source snapshot 同时固化 exact body hash 和 Canon SourceRefs hash；tool result 固化 tool/call/resource 身份，避免“有一份原文，但无法证明属于哪个资源”。
- 作者摘要只显示数量、token、证据状态和短 hash，不暴露表名/recordId；开发诊断导出可回读精确原文，但仍受 secret/hidden-reasoning 防线约束。

## Compaction 与恢复封口

- 创建 working-context compaction 前会校验上一 checkpoint 及 original/replacement packet/raw artifact 实体。
- 恢复时不再只检查最新 checkpoint 和一层 base，而是逐层校验完整 base chain、事件 replay、tail 边界、generation 与每代 exact packet/raw body。
- 多次读取的 `checkpointChainHashes + checkpoint + tail` replay hash 稳定；任一历史 packet 消失时诚实失败，不使用剩余 hash 伪造可恢复。

## 回归与门禁证据

- `R-CTXG1～6` + `R-MEMINT0` + Memory V2 + Run lifecycle：9 files / 53 tests 通过（在 selector-result 精确证据加固前）；最终 CTXG-6/MEMINT/CTXG-2 核心集将在提交前再次运行。
- `npm run check:required-tables`、`check:ai-manual`、`check:ai-entry-registry`、`check:architecture`、`check:source-reachability`、`check:roadmap`、`check:agent-context`、`check:agent-freshness`、`check:canon-coverage`、`check:project-metrics` 已通过；项目指标已按当前源码重新生成。
- `npx tsc --noEmit`、`npm run lint`、`npm run build`、`npm run check:bundle-size` 已通过；本单元未增加新页面主入口，未改变现有 4178 预览项目。
- 新增架构守卫 `㉗`：锁定 V3、preflight/finalize/verify/freshness API、七类 exact artifact 闭集、完整 compaction chain 和独立的 Context Gateway headless 公开边界；不把 durable evidence 反向导入 `assembleContext` 而造成 Tool Registry 初始化环。

## 剩余边界与下一单元

- CTXG-6 提供了严格 API，但当前正式世界观/故事/角色/大纲/细纲 Skill 尚未调用它；旧 V1/V2 入口仍为历史兼容，不伪称已经完成产品切换。
- `CTXG-7` 将把 CTXG-3～6 的目录、确定性 selector、有限追加读取和 attempt evidence 真正接入 Agent Skill / Runner；无 V3 或 stale V3 的新候选必须不可采纳。
- `CTXG-8` 才实现 scope/version/content/policy hash cache、失效和百万字目录/读取性能门；Phase 1A 的整体 CI/E2E 仍在 `GATE-P1A` 统一签收。
