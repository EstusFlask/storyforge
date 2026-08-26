# CTXG-5 开工卡：确定性预选与上下文充分性

## 任务与完成边界

- 任务 ID：`CTXG-5`
- 基线：`85747f36`（`CTXG-4` 已签收）
- 分支：`refactor/world-engine-harness`
- 目标：在现有 Canon Provider、`ContextAccessPolicyV1` 与 Skill `contextTaskKind` 上建立纯函数预选器；统一交付 Mandatory/Pinned、分类最低配额、一跳高风险关系、当前邻域/最近变化/早期锚点，并输出可解释、可重算的 `ContextSufficiencyReportV1`。
- 非范围：本单元不执行额外模型调用，不持久化 Retrieval Trace/Context Packet，不切换正式生成入口，不实现缓存；这些分别属于 `CTXG-6～8`。

## 重新审计结论

1. `CTXG-3/4` 已提供完整 metadata 目录与受控读取能力，但没有任何统一算法决定某个任务首先应读哪些资源；旧固定前缀/固定条数问题尚未在正式链路中被替代。
2. `AgentSkillDefinitionV1.contextTaskKind` 已冻结五类领域任务，适合作为 selector policy 的唯一入口；不能让页面或字段自行复制选择算法。
3. Descriptor 已含 priority、authority、revision、关系、时间边界和 token estimate，足以实现不读正文的确定性预选；作者正文仍是 Canon resource，不转换成 Skill。
4. 当前 `createContextSufficiencyReportV1()` 只负责规范化已有义务，尚不会从任务、选择结果和预算派生义务；需新增统一 builder，避免 UI/Prompt 私自判断“还要不要读”。
5. `perKindMinimumTokens` 只有单 kind 配额，仍需在 selector policy 冻结世界、角色、故事规划、正文事实四类最低份额，防止单个超长世界观独占预算。
6. Mandatory/Pinned 不能因预算不足静默丢弃；无法在预算内交付时必须保留选择证据并把硬义务标为 conflicted，阻断后续生成。

## 三注册表与关联闭包

- 读：只接收 `CONTEXT_SOURCES.resources` Provider 返回并经 Policy 过滤的 descriptors；不新增来源注册表，不直接访问数据库。
- 写：只产生内存选择计划、reason code、omission 与充分性报告；不写 Canon，不涉及 `FIELD_REGISTRY` / `AdoptionSchema`。
- 表：不新增表，不改 `PROJECT_TABLES` 生命周期；CTXG-6 才持久化 exact trace/artifact。
- 调用方：CTXG-5 先提供无副作用 API；CTXG-7 再接入正式 Skill 快慢路径。
- 测试：新增 `R-CTXG5`，覆盖顺序无关、Mandatory/Pinned 100%、分类配额、一跳扩展、早期锚点、冲突、scope、预算与稳定 hash。

## 预期修改面

- `src/lib/context-gateway/selector.ts`：task-kind policy、预选、配额、关系扩展、充分性 builder 与稳定 hash。
- `src/lib/registry/types.ts`：冻结 selector 输入/输出、分类、reason code 与版本化结果合同。
- `src/lib/context-gateway/contracts.ts` / `src/lib/registry/assemble-context.ts`：严格校验与统一导出。
- `scripts/check-architecture.mjs`：守卫 selector 只能从已有 task kind、Policy 与 resource descriptors 派生，且不得直接访问 DB。
- `tests/regression/R-CTXG5-context-selector.test.ts`：正反例与纯函数证明。

## 验收门

- 所有可发现的 `must-read`、`pinned` 与显式 Mandatory resource key 均被选择；预算不足时 fail-closed，不静默遗漏。
- 目录首/中/末位置和输入排列不改变选择集合、reason code、充分性报告或 hash。
- 单个超长世界资源不能挤掉任务策略要求的角色、故事规划和正文事实最低配额。
- 一跳扩展不递归越界；相关早期锚点与最近变化可同时保留。
- scope/authority 冲突、缺失 Mandatory 和同名冲突均产生结构化义务；hard failure 禁止继续生成。
- 同一 descriptors、task kind、策略版本和预算得到相同 selector/report hash；选择器运行 DB 零写。
