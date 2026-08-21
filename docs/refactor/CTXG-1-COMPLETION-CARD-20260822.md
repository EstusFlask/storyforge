# CTXG-1 完成卡：Context Gateway 合同、Provider、权限与版本

## 完成结论

`CTXG-1` 已完成。Context Gateway 的可编辑入口仍然只有 `CONTEXT_SOURCES`：每个来源可选挂载一个 `resources` Provider；Provider 的 source key/kind/version/normalization 被解析成无函数的冻结 snapshot。SourceRef 的 table 和逻辑 owner 只由 `PROJECT_TABLES` 校验和派生，没有新增第四注册表。

当前没有切换任何正式生成入口、没有增加模型调用，也没有建立持久 catalog。下一步 `CTXG-2` 将按本合同补稳定 resource UID 和 exact artifact 物理表。

## 交付

- `src/lib/registry/types.ts`
  - `ContextAccessPolicyV1`
  - `ContextResourceDescriptorV1` / `ContextResourceProviderV1`
  - `ContextSourceRefV1`
  - `ContextSufficiencyReportV1`
  - `RetrievalTraceV1`
  - `ContextPacketV1`
  - `AgentRunArtifactV1`
  - `ContextGatewayVersionV1` / frozen snapshot
  - `ContextSource.resources?` 唯一 Provider 扩展点
- `src/lib/context-gateway/contracts.ts`
  - Policy、SourceRef、owner/scope、kind/depth、metadata/body、candidate 可见性运行校验。
  - Sufficiency、Trace、Packet、Artifact 与 Gateway snapshot 确定性 hash。
  - V1 frozen snapshot 严格只读解析，不依赖当前 Provider 函数或当前版本。
- `src/lib/registry/assemble-context.ts`
  - 从现有统一装配边界导出 Gateway 合同能力，不创建平行上下文入口。
- `scripts/check-architecture.mjs`
  - 锁定全部九类合同、Provider 挂载点、PROJECT_TABLES owner、metadata/body 分离、candidate 权限和版本 hash 组成。

## 已冻结行为

- metadata 的 descriptor 没有正文；检测到 `content/body/original` 即失败。
- `listMetadata/searchMetadata` 与 `read/readOriginal` 是不同类型边界。
- candidate 在普通 list/search 中永远不可见；即使 Skill 允许，也只能用完整 `resourceKey` 定点读。
- original depth 必须同时被 Descriptor 和 Policy 允许，且 `allowOriginalRead=true`。
- mandatory source 必须属于 allowed source；allowed source 必须是已登记 `ContextSource` 且挂有 Provider。
- allowed kind 必须由这些 Provider 声明；未登记 table/kind/depth/provider 全部 fail-closed。
- Gateway version hash 覆盖 selector、descriptor version、provider set、sufficiency obligations、tool schema 与 normalization。
- Provider 实现函数不进入 snapshot；实时 Canon backend 换成 fixture/index backend 时调用方合同不变。

## 反例与验证

- CTXG-1 新增 7/7 tests 通过：序列化/hash、后端替换、owner、未登记项、candidate 隔离、metadata 泄漏、evidence hash 链、旧 snapshot 篡改/未来版本。
- 与 MEMINT 联合定向回归 14/14 通过。
- `check:architecture`、`check:required-tables`、`check:ai-manual`、`check:ai-entry-registry`、`check:source-reachability`、`check:roadmap`、`check:agent-context`、`check:agent-freshness`、`check:canon-coverage`、`check:project-metrics` 通过。
- ESLint、TypeScript、生产 build、`git diff --check` 通过。

## 下一依赖

`CTXG-2`：稳定 resource UID、显式幂等 backfill、纯读取目录、metadata/body 分离的内核，以及登记到 `PROJECT_TABLES` 的内容寻址 `agentRunArtifacts` 表和完整导出/导入/删除/清理生命周期。

