# CTXG-1 开工卡：Context Gateway 合同、Provider、权限与版本

## 开工基线

- 分支：`refactor/world-engine-harness`
- 基线提交：`4c835b04 refactor(MEMINT-0): seal harness memory boundaries`
- 前置门：`GATE-MEMINT` 已通过；完整 CI 为 448 files / 2123 tests，依赖漏洞 0。

## 当前关联闭包

- AI 读取唯一注册表：`src/lib/registry/context-sources.ts` 的 `CONTEXT_SOURCES` / `CONTEXT_SOURCE_BY_KEY`。
- 统一装配入口：`src/lib/registry/assemble-context.ts`；当前以整段 source reader 和固定 layer/budget 工作。
- 表身份与 owner：`src/lib/registry/project-tables.ts` 的 `PROJECT_TABLES` / `REGISTRY_BY_NAME` / `domainOwner`。
- Skill/Run 冻结：`src/lib/agent/skill-registry.ts`、Run Contract、Context Manifest V1/V2。
- 现有只读工具：`src/lib/agent/tool-registry.ts`；CTXG-4 才增加 catalog/search/read/original 工具。
- exact evidence 接缝：`evidence.artifact.recorded` → 现有 Memory Settlement/Index；CTXG-2 才落物理正文表。

## 本单元交付

1. 在现有 registry 类型体系定义 `ContextAccessPolicyV1`、Descriptor、Provider、SourceRef、Sufficiency、Trace、Packet、Artifact 与 GatewayVersion。
2. `ContextSource.resources?` 成为唯一 Provider 扩展点；Provider id/version/kinds/normalization 冻结进合同 hash。
3. source ref 的 table 必须在 `PROJECT_TABLES`，逻辑 owner 只从 `domainOwner` 派生；不维护第二份 source/table/kind 对照表。
4. metadata list/search 与 body/original read 在类型和运行校验上分离。
5. candidate authority 默认不可搜索；original read、depth、kind、source、read-call 和 token 均由 policy 限制。
6. GatewayVersion hash 覆盖 selector、provider/descriptor、sufficiency obligations、tool schema 与 normalization；旧 V1 snapshot 只读解析，不按当前代码重写。

## 非范围

- 不创建资源正文副本、持久 catalog 或 `agentRunArtifacts` 表（CTXG-2）。
- 不给现有来源批量写 Provider（CTXG-3）。
- 不增加 Agent 工具或模型调用（CTXG-4/7）。
- 不切换任何正式生成入口。

## 退出门

- 未登记 source/table/kind/depth/provider fail-closed。
- 合同可 JSON 序列化、同输入 hash 稳定，函数实现不进入 snapshot。
- Canon/fixture 两种 Provider 后端对同一资源输出相同 resourceKey、scope 与 sourceRef 合同。
- candidate 默认搜索不可见，只有显式 policy 才能定点读取。
- 架构守卫证明 Provider 只挂 `CONTEXT_SOURCES`，owner 只来自 `PROJECT_TABLES`。
- 定向测试、项目检查、TypeScript、build 和完成卡通过。

