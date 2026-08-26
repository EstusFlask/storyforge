# MEMINT-0 开工卡：Harness 证据与现有记忆工程接缝封口

## 开工基线

- 分支：`refactor/world-engine-harness`
- 基线提交：`a2cc2f09 feat(WEH-0G): expose harness evidence and fault gates`
- 前置门：`GATE-P0` 已通过；完整 CI 为 447 files / 2116 tests，隔离 Chromium E2E 为 53/53。
- 原工作区 `/Users/qinyingying/Desktop/project/storyforge` 仍保留作者并行改动；本单元只在隔离工作区施工，中央进度表除外。

## 五个记忆平面

| 平面 | 唯一权威/现有设施 | 本单元边界 |
|---|---|---|
| Canon authority | `PROJECT_TABLES` 登记的领域表、作者确认的 `adopt()` | exact evidence、摘要、检索块均不得成为 Canon 或自动回写 Canon |
| Derived narrative memory | `retrievalChunks`、`narrativeSummaryNodes`、`consistencyDossier` | 可 stale、删除和重建；不得另建平行 chunk/summary 表 |
| Execution evidence | `agentRuns`、`agentRunEvents`、`agentRunCheckpoints`、现有 Memory Settlement/Index | 在同一 ledger/settlement 上增加内容寻址 exact artifact 引用和裁剪回执，不建立第二套 receipt/index |
| Bounded working context | Context Manifest、checkpoint 与 replay | 冻结 compaction generation、原包/替代包哈希、来源 revision/span、版本、token 与保留/遗漏原因；恢复为 base checkpoint + tail replay |
| Projection/recovery | `workspaceDocuments`、Workspace Manifest、recovery capsule、`MemoryArtifactIndex` | 只投影/恢复/同步，不复制领域正文，不把 workspace binding 误作证据正文库 |

## 当前源码关联闭包

- 类型：`src/lib/types/memory-engineering.ts` 的 `MemoryArtifactRefV1`、`MemorySettlementReceiptV1`、`MemoryArtifactIndexV1`。
- 结算：`src/lib/memory/settlement-core.ts` 从 Run 事件派生 artifact refs；`src/lib/memory/settlement.ts` 验证终态结算事件并构建唯一 Index。
- 运行账本：`src/lib/types/agent-run.ts`、`src/lib/agent/run/event-schema.ts`、`src/lib/agent/run/event-store.ts`。
- 恢复：`src/lib/agent/run/checkpoint.ts` 已有投影哈希、opaque resume payload 和 ledger replay。
- 生命周期：`src/lib/registry/project-tables.ts` 是 export/import/delete/remap 的唯一表清单；`src/lib/db/schema.ts` 当前为 v62。
- 复用对象：`retrievalChunks`、`narrativeSummaryNodes`、一致性 dossier、`workspaceDocuments`。

## 已确认缺口

1. 当前 artifact ref 指向事件或领域哈希，不能逐字回读 exact Context Packet、压缩/截断前快照、去认证请求、工具结果和原始响应。
2. exact body 尚无内容寻址、不可变、项目级去重、活引用清扫和 `evidence-pruned` 语义。
3. checkpoint 没有正式 compaction payload 合同，无法说明何时、为何以哪个替代包压缩了哪些来源。
4. 现有导入导出能搬运 ledger，但尚不能证明 exact evidence 哈希在重映射后稳定。
5. 尚无统一入库守卫禁止 API Key、认证头、cookie 和隐藏推理正文。

## 施工范围与顺序

1. 先冻结版本化五平面、artifact kind/ref、retention/tombstone 和 compaction checkpoint 合同及反例。
2. 扩展现有 Memory Settlement/Index 接口，使它能索引 exact artifact ref 和 `evidence-pruned` 状态；不复制正文到 Index。
3. 使用现有 checkpoint 表承载版本化 compaction resume payload，验证 generation、packet hash、source revision/span、token、策略/Provider/Prompt 版本和 tail replay。
4. 增加密钥/认证/隐藏推理 fail-closed 检查；本地扫描、hash、settlement 和 replay 保持零模型调用。
5. 用生命周期、导入导出、清理、损坏、stale/rebuilding 反例签 `GATE-MEMINT`。

内容寻址正文表、resource UID 和 Gateway 目录的物理落库仍按进程表由 `CTXG-2` 完成；MEMINT-0 先把唯一结算契约和可接入边界封死，避免 schema 先行后再产生第二套记忆语义。

## 明确非范围

- 不改变世界观、故事、角色的产品行为。
- 不新建第二套 Canon、Memory Settlement、Artifact Index 或检索摘要体系。
- 不把候选默认纳入搜索，不由 compaction 删除 raw evidence。
- 不保存 API Key、认证头、cookie、provider 隐藏推理或浏览器凭据。
- 不增加模型调用、轮询、后台 Agent 或隐藏费用。

## 退出门

- 五平面由机器可检查合同唯一声明，所有已登记表各归一个平面。
- exact artifact ref、裁剪状态和 settlement/index hash 在重放及导入重映射后稳定。
- compaction checkpoint 可从 base + tail 重建相同投影/工作包哈希；raw artifact ref 不因压缩消失。
- Run 删除/项目删除/导出导入/活引用清扫语义有反例；派生记忆 stale/rebuilding 不污染 Canon。
- 敏感内容入库反例全部 fail-closed，入库/导出命中数为 0。
- 定向测试、项目检查、TypeScript、build、完整 CI 通过并形成完成卡。
