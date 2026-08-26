# CTXG-4 开工卡：四个 Context Gateway 只读工具

## 任务与完成边界

- 任务 ID：`CTXG-4`
- 基线：`d31af250`（`CTXG-3` 已签收）
- 分支：`refactor/world-engine-harness`
- 目标：把 `list_context_catalog`、`search_context`、`read_context_resource`、`read_original_evidence` 注册进现有 Tool Registry，并让 scope、ContextAccessPolicy、调用/token/结果上限与 SourceRef capability 全部 fail-closed。
- 非范围：本单元不建立 Mandatory Core/预选器/充分性循环，不冻结完整 RetrievalTrace/ContextPacket/tool-result exact artifact，也不切换正式创作 Skill；这些分别属于 CTXG-5～7。

## 重新审计结论

1. 现有 `tool-registry.ts` 已有 15 个只读工具、闭集参数校验、World/Work/Chapter 校验和统一 `executeAgentTool()`；通用 Runner 已有 step/tool/token/loop 预算及 durable `tool.called/tool.returned` hash，应该扩展而非另建执行器。
2. 当前 `AgentToolExecutionContext` 只有旧 `AgentContextPolicy`，没有冻结的 `ContextAccessPolicyV1`、Gateway scope 或跨调用资源读取额度；四个新工具若直接注册会绕过 kind/depth/candidate/original 权限。
3. Provider 已能分页、搜索、分层读取和原文回查，但搜索合同还没有 entity/story arc/time 组合过滤；工具适配层必须保持稳定 cursor，不能取前 N 条后自行无游标过滤。
4. 原始 `ContextSourceRefV1` 含表名和本地主键。模型不应把任意对象当查询能力；`read_original_evidence` 应只接受当前 Gateway session 先前签发的 opaque capability，并再次校验 scope、policy 与当前资源版本。
5. 新工具会改变 Agent Tool schema；必须同步升级冻结 schema version/hash，旧 Run 仍按其历史 binding 只读恢复。

## 关联闭包

- 入口：`AGENT_READ_TOOLS` / `AGENT_TOOL_BY_NAME` / `executeAgentTool()`；文本 JSON 与 native tool calling 共用同一注册表。
- 读：只能通过 `CONTEXT_SOURCES[*].resources` Provider；不直接查询业务表。
- 权限：Host 创建冻结 Gateway session，模型参数不能传 project/world/work/worldGroup 或 policy；kind/depth/candidate/original、call/token/page 上限由 session 强制。
- 证据：每个结果返回 scope/policy/provider/resource/content/source capability 元数据；本单元复用现有 Runner 的 `tool.called/tool.returned` hash，exact tool-result artifact 留给 CTXG-6。
- 写：业务表、候选表、派生索引零写；仅更新当前内存 session 的计数与 capability 集合。
- 生命周期：不新增表、不改 schema；资源与 source ref 生命周期继续由 CTXG-2/3 管理。

## 施工顺序

1. 扩展 Provider search filter 合同与 Canon Provider 的稳定组合过滤/cursor hash。
2. 建立冻结 Gateway tool session：规范化 policy、校验 provider/scope、累计 read call 和 retrieved token、签发 opaque SourceRef capability。
3. 实现四个 Agent tool adapter，严格参数 schema、metadata-only 目录、分层正文、原文 capability 回查及结构化 evidence。
4. 合并进现有 Tool Registry 与两种调用协议；同步 tool schema version/hash，不改 Runner 的统一预算执行路径。
5. 增加架构守卫与跨 scope、越权 kind/depth、candidate、坏 cursor/ref、超预算、删除、零写反例。

## 验收与停止条件

- 四个工具只出现在唯一 Tool Registry，风险均为 `read`，未知参数和模型注入 scope/policy 均拒绝。
- list/search 不返回正文或本地 DB SourceRef；搜索可组合 kind、entity/story arc、time 和关键词并稳定分页。
- 未经当前 session 签发、跨 session、被篡改或已经 stale 的 capability 无法读取原文。
- kind/depth/candidate/original 权限与 session call/token/page 上限全部 fail-closed；工具结果仍受 Runner 总预算和循环检测。
- 删除资源、跨 World/Work/WorldGroup、坏 cursor 与 Provider 异常不泄漏正文；全工具运行前后数据库快照一致。
- tool schema version/hash 与当前唯一注册表完全一致；现有 15 个工具回归不变。
