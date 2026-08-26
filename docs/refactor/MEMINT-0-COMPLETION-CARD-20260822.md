# MEMINT-0 / GATE-MEMINT 完成卡：记忆工程接缝封口

## 完成结论

`MEMINT-0` 与 `GATE-MEMINT` 已完成。Harness 的 exact Run evidence 和有界工作上下文没有形成第二套记忆中心，而是进入现有 `agentRuns / agentRunEvents / agentRunCheckpoints → MemorySettlementReceipt → MemoryArtifactIndex` 链：ledger 记录可移植的 exact artifact 引用，Settlement 去重并冻结引用哈希，checkpoint 保存版本化 compaction 合同并由原 ledger replay 校验。

本单元冻结的是唯一结算语义和物理存储接入合同。内容寻址正文表、resource UID、目录与具体 packet/request/response 写入由下一阶段 `CTXG-2` 按该合同落库；在此之前仍不宣称历史 Run 已可逐字回读。

## 五层边界

1. Canon authority：仅作者确认的领域记录；candidate、exact evidence、摘要和检索块均不能成为 Canon。
2. Derived narrative memory：复用 `retrievalChunks`、`narrativeSummaryNodes`、reference analysis 等可重建派生设施；允许 stale/rebuilding，不另建平行摘要库。
3. Execution evidence：复用现有 Run/event/checkpoint ledger；新增 `evidence.artifact.recorded` 事件，而非第二套 Run 或 receipt。
4. Bounded working context：compaction 只保存 generation、原包/替代包 hash、source revision/span、策略/Provider/Prompt/Gateway 版本、token 变化及保留/遗漏原因。
5. Projection/recovery：`workspaceDocuments`、snapshot/import/recovery 设施仍是非 Canon 投影；不复制领域正文。

`memoryPlaneForTableV1()` 只通过 `PROJECT_TABLES` 校验表身份；正式领域表、运行证据、派生缓存和恢复投影不会互相冒充。全局 Prompt 配置明确不属于项目记忆平面。

## 交付

- `src/lib/types/memory-engineering.ts`
  - exact artifact kind/ref、`evidence-pruned`、裁剪回执、工作上下文 compaction V1 合同。
- `src/lib/agent/run/event-schema.ts` / `projection.ts`
  - 新增严格解析的 `evidence.artifact.recorded` ledger 事件；可选 step/attempt 必须成对且绑定已有步骤代际。
- `src/lib/memory/settlement-core.ts`
  - exact artifact ref 由同一 Run ledger 进入现有 Settlement/Index；同内容引用确定性去重，导入重映射后 portable identity 稳定。
- `src/lib/memory/plane-contract.ts`
  - 五层边界及 `PROJECT_TABLES` 派生分类，不拥有表生命周期。
- `src/lib/memory/evidence-policy.ts`
  - API Key、Bearer、认证/cookie/token 字段与 provider 隐藏推理 fail-closed；扫描/hash 全程零模型调用。
- `src/lib/memory/artifact-retention.ts`
  - 运行历史清理采用 live-reference mark-and-sweep；显式 retention 裁剪必须生成 portable `evidence-pruned` tombstone receipt。
- `src/lib/memory/working-context.ts`
  - 原始 Context Packet 引用为必填；压缩不得删除 raw evidence；base checkpoint + tail 可重复恢复相同 hash。
- `scripts/check-architecture.mjs`
  - CI 锁定五平面、唯一结算、敏感信息、retention 和 compaction replay 关键边界。

## 关键反例

- 未登记表不能进入任何记忆平面；global Prompt 不被误标为项目 Canon。
- `Authorization`、Bearer、API key、token、cookie、`reasoning_content` 与 `<thinking>` 均拒绝持久化。
- 同一 exact artifact 被同一 Run 多次引用时 Settlement 只保留一个稳定 ref。
- 项目导出/import ID 重映射后 exact artifact ref、artifact id 与 settlement receipt hash 不变。
- Run 删除会先移除 ledger 引用；mark-and-sweep 随后只裁剪无活引用正文。
- 显式裁剪仍被 Run 引用的正文时留下 `evidence-pruned` 回执，不伪称 exact body 可用。
- compaction 遗漏原始 packet ref、压缩后 token 反增、span/hash/generation/base 链损坏均 fail-closed。
- 刷新后用同一 checkpoint + tail 两次 replay 得到相同 hash，且 raw artifact ledger ref 仍在。

## 验证证据

- MEMINT 与既有 Memory Settlement/Workspace 定向测试：4 files / 24 tests 通过。
- 新增反例：7/7 通过。
- 完整 `npm run ci`：448 files / 2123 tests 全部通过；coverage statements/lines 83.18%、branches 73.78%、functions 81.08%。
- 10 项架构/注册表/AI/路线图/上下文/Canon/指标检查、依赖审计（0 vulnerabilities）、ESLint、TypeScript、生产构建及 bundle budget 全部通过。
- `git diff --check` 通过。

## 下一依赖

下一单元为 `CTXG-1`：定义 Context Gateway 的版本化 Policy、Descriptor、Provider、SourceRef、Sufficiency、Trace、Packet、Artifact 和 GatewayVersion；Provider 只能挂入 `CONTEXT_SOURCES`，owner 只能从 `PROJECT_TABLES` 派生。随后 `CTXG-2` 才创建已登记的内容寻址 exact artifact 表和完整持久生命周期。

