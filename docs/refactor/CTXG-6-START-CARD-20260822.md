# CTXG-6 开工卡：Manifest V3、Retrieval Trace 与精确输入证据

## 任务与完成边界

- 任务 ID：`CTXG-6`
- 基线：`b73369d5`（`CTXG-4/5` 已签收）
- 分支：`refactor/world-engine-harness`
- 目标：在现有 `ContextManifestV2`、Run ledger、`agentRunArtifacts`、Memory Settlement 和 working-context checkpoint 上演进 V3；把 selector、实际资源读取、tool transcript、sufficiency、Context Packet、rendered request、raw response、Prompt hash 与 candidate hash 串成可逐字回读、可验签、可恢复的同一 Run/step/attempt 证据链。
- 非范围：本单元不把 Gateway 切换到正式创作 Skill，不改变页面生成行为，不新增模型调用，不实现 provider 缓存；这些属于 `CTXG-7/8`。

## 重新审计结论

1. `ContextManifestV1/V2` 已覆盖来源状态、压缩/截断、稳定 Workspace/World/Work 和镜像 provenance；V3 必须兼容升级，不能覆盖 V2 或另建平行 Manifest。
2. `agentRunArtifacts`、`evidence.artifact.recorded`、导入导出、mark-and-sweep、`evidence-pruned` 和 Memory Settlement 接缝已存在；缺的是“一次 Gateway attempt 中每个 artifact 扮演什么角色”的完整 Manifest 引用。
3. 当前 exact artifact kind 能保存 packet、source snapshot、tool result、rendered request 和 raw response，但 Manifest 本身没有可逐字回读的 body kind；需要新增兼容的 `context-manifest` evidence kind，而不是新表。
4. CTXG-4 工具已经产出 host-only SourceRef evidence；CTXG-5 selector 已产出确定性选择/充分性。CTXG-6 应消费这些结果并冻结实际读取，不重新选择资源。
5. 现有 working-context checkpoint 已有 generation、packet replacement、source span/revision、策略/provider/prompt、token 与 raw refs；恢复仍需校验整个 base chain 和 packet artifacts，避免只凭 hash 字符串猜测恢复。
6. 现有 candidate/adoption 路径尚不会要求 Manifest V3；CTXG-6 先提供严格 finalize/verify API，CTXG-7 接入正式入口时才把“无 V3 不可候选/采纳”变成产品主路径。

## 三注册表与关联闭包

- 读：V3 只引用 `CONTEXT_SOURCES.resources` 产生的 descriptors/SourceRefs 与既有 V2 source evidence；不增加来源数组。
- 写：仅写现有 `agentRunArtifacts` 和 `agentRunEvents`，由 `PROJECT_TABLES` 既有 lifecycle、导入导出和 settlement 统一治理；不写 Canon，不动 `FIELD_REGISTRY` / AdoptionSchema。
- 表：不新增表、不升 schema；扩展 exact artifact kind parser/retention/export integrity 闭集。
- 调用方：新增 Gateway attempt preflight/finalize/verify/diagnostic API；CTXG-7 再由正式 Skill 使用。
- 测试：新增 `R-CTXG6`，覆盖逐字回读、hash/role/attempt、secret、写失败、candidate linkage、stale、pruned/corrupt 和多次 compaction replay。

## 预期修改面

- `src/lib/types/agent-run.ts` / `memory-engineering.ts`：Manifest V3、artifact role 与兼容 kind。
- `src/lib/agent/run/context-manifest.ts`：V3 create/parse/integrity 与 V2 嵌入校验。
- `src/lib/context-gateway/attempt-evidence.ts`：preflight、finalize、rebuild、candidate verifier、作者摘要和开发诊断导出。
- `src/lib/memory/artifact-*` / `event-schema.ts`：`context-manifest` exact artifact 全生命周期。
- `src/lib/memory/working-context.ts` / checkpoint：完整 base chain 与 packet artifact 校验。
- `scripts/check-architecture.mjs` 与 `tests/regression/R-CTXG6-context-evidence.test.ts`。

## 验收门

- 调用前 packet/request 先落 exact artifact；失败时不允许进入模型请求证据。
- finalize 后可由 Run/step/attempt 找到唯一 V3，并逐字回读 packet、source snapshot、tool result、request、response。
- V3 的 V2 hash、Gateway/policy/selector/report/trace/packet/Prompt/candidate/artifact refs 全部可重算；任一损坏或清理均诚实 fail-closed。
- `context.assembled` 只能在 V3 artifact 完成后出现；V3 finalize 失败时不能产生可采纳 candidate 证据。
- 当前 Canon 与 trace revision/hash 不一致时返回 stale 证据；历史 exact body 不随 Canon 修改改变。
- 多次 compaction 校验完整 base chain，刷新 replay hash 稳定；packet body 缺失/损坏时 fail-closed。
- 作者摘要不暴露内部表/recordId；开发诊断 JSON 不含 API Key 或隐藏推理。
