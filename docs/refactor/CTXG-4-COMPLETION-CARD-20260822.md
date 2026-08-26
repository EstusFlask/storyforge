# CTXG-4 完成卡：四个 Context Gateway 只读工具

## 完成结论

- 任务 ID：`CTXG-4`
- 基线：`d31af250`
- 分支：`refactor/world-engine-harness`
- 状态：完成，允许进入 `CTXG-5`；本卡不宣称 Phase 1A 已过门或正式生成已切换。

`list_context_catalog`、`search_context`、`read_context_resource` 与 `read_original_evidence` 已并入现有 `AGENT_READ_TOOLS` / `AGENT_TOOL_BY_NAME` / `executeAgentTool()`，文本 JSON 和 native tool calling 继续共用同一 Tool Registry 与同一 Runner 预算。

## 实现范围

1. 扩展 Canon Provider search 合同，支持 kind、entity relation、story arc relation、time range 和关键词组合；所有过滤进入 provider cursor hash，跨 filter/scope/policy 复用 cursor 会失败。
2. 建立 host-only `ContextGatewayToolSessionV1`：
   - 冻结 World/Work/WorldGroup scope 和规范化 `ContextAccessPolicyV1`；
   - 冻结 provider set、policy hash 与 scope fingerprint；
   - 累计 Gateway read call 和 retrieved-token 双重额度；
   - 维护有界、可重放稳定的 SourceRef capability 映射。
3. 四个工具执行严格参数闭集：模型参数不包含 project/world/work/worldGroup/policy，运行时还会比对 Agent execution context 与 session scope，防止 Host 误接线。
4. catalog/search 只返回公开 descriptor metadata、当前页 kind 计数和 opaque cursor，不输出正文、表名、本地主键或 raw SourceRef。
5. resource read 先做 index 定位与 kind/candidate/depth 权限，再按明确 depth/maxTokens 读取；Provider 返回内容、hash 和 token count 会重新校验。
6. original read 只接受当前 session 先前签发的 capability；跨 session、伪造、过期、删除或未授权 original 全部拒绝。Host-only evidence 保留 capability 与真实 SourceRef 的映射，供 CTXG-6 exact artifact/replay 接入，模型可见内容不含该映射。
7. 工具级单次结果预算、session 总调用/token 预算和现有 Runner 的 step/tool/result-token/loop 预算同时生效；Gateway adapter 不直接访问数据库。
8. Agent tool schema 升级到 `agent-read-tools-v3`，hash 与当前唯一注册表重新冻结；旧 V2 binding 的历史完整性解析不依赖当前 live registry。

## 关键反例

- 未提供 host session、未知参数、执行上下文与冻结 project/world/work/worldGroup 不一致均在 Provider 调用前拒绝。
- 未授权 kind/depth、candidate 普通读取、original 禁用、跨 session/篡改 capability 均返回空正文失败结果。
- metadata 输出不含 `sourceRefs`/`recordId`；原文能力只在明确 resource read 成功后签发。
- 搜索可按故事线一跳关系、角色实体关系和章节时间边界组合命中；换查询或作用域复用 cursor 失败。
- 另一 WorldGroup 的世界观和另一 Work 的故事核心均不可见。
- 超 session token、超 read-call、超工具结果上限、资源删除和 stale SourceRef 全部 fail-closed。
- 四个新工具、旧 15 个工具、通用 Runner、durable Runner 与 native transport 回归通过；Provider/工具运行数据库零写。

## 验证记录

- 关联回归：8 files / 59 tests，全绿（CTXG-1/3/4、旧 Tool Registry、通用/durable Runner、tool schema freshness、native transport）。
- 十项静态闸门：required tables、AI manual、AI entry registry、architecture、source reachability、roadmap、agent context、agent freshness、Canon coverage、project metrics 全绿。
- `npm run lint`：通过。
- `npx tsc --noEmit`：通过。
- `npm run build`：通过，3965 modules。
- `npm run check:bundle-size`：通过；entry 663.1 KiB / 197.8 KiB gzip，未超过 700 / 230 KiB 预算。
- `git diff --check`：通过。

## 后续边界

- `CTXG-5` 建立 task-kind Mandatory Core、确定性预选器、分类配额、一跳扩展与充分性报告。
- `CTXG-6` 把工具的 host-only SourceRef evidence、实际文本与 Context Packet 写入 exact artifact/Manifest/Trace，并支持 durable capability 恢复。
- `CTXG-7` 才把 Gateway 快慢路径接入正式 Skill；目前新增工具不会自行触发模型调用或改变现有创作流程。
