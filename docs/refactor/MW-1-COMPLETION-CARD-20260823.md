# MW-1 完成卡 · 多世界与世界通道

## 完成边界

- 世界组与通道继续由 `PROJECT_TABLES` 提供资源身份、World owner、导入导出、删除与端点重映射。
- 通道正式表达 `fromGroupId → toGroupId`、`bidirectional`、类型、名称、描述和 revision；作者可在总览中创建并再次编辑，不必删除重建。
- 世界两端的进入、离开、力量限制和带出规则均可编辑，并由 `world-link` aggregate 以逐字段 source ref 交付。
- 新增只读 Skill `world-origin.world-link-context`：目标世界和指定通道 Mandatory/full；相邻规则只在该通道任务中一跳展开。
- 所有其它 Gateway Skill 在执行策略中自动移除 `world-link`，不会因目录中存在通道而在普通世界观、故事或角色任务里扩权。
- 角色跨世界身份只由 `isCrossWorld` 显式决定；`homeWorldGroupId = null` 仅保留为单世界兼容/未归属语义。
- 同名资源标题显示世界身份，跨 World 与跨 Work 的目录读取继续由统一 scope gate 阻断。

## 三注册表

- 读：`CONTEXT_SOURCES.ragSelection` → Canon provider → `world` / `world-link` aggregate；通道 Skill 仅使用 Gateway。
- 写：本单元没有新增 AI 写入口；世界组 `exitCondition` / `takeawayRules` 补入 `FIELD_REGISTRY`，现有作者 UI 写入由受作用域约束的 store 完成。
- 表：`worldGroups` / `worldGroupLinks` 沿用 `PROJECT_TABLES`；为 link 补充 `bidirectional:false` 兼容默认和端点/规则说明。
- 生命周期：新 link 创建时盖 `worldId`、portable UID、`createdAt/updatedAt`；更新端点前验证两端属于同一 World；既有导入重映射与删世界级联保持不变。

## 关键反例

- 普通 `world-origin.worldview-field` 的执行策略不含 `world-link`，Prompt 看不到通道。
- 通道任务能读取 A→B 完整规则，但不会读取 B→C 的第二跳秘密。
- 同项目另一 World 的同名角色、同 World 另一 Work 的故事线在目录结果中为 0。
- 将通道端点改到另一 World 时 fail-closed，数据库保持原端点。
- 旧单世界 `homeWorldGroupId` 缺失仍可解析；多世界不再把 null 冒充跨世界。

## 验证证据

- `R-MW1-world-link-governance`: 3/3。
- 世界关系/详情 UI：14/14。
- Canon/Gateway/world-suggest/export 相关扩展回归：42/42。
- NS-4 事实与人类可读导入兼容：12/12。
- `check:architecture`、`check:required-tables`、`check:ai-manual`、`check:agent-context`、`check:agent-freshness`、`check:source-reachability`、`check:canon-coverage`：通过。
- `npx tsc --noEmit`、`npm run build`、`git diff --check`：通过。

## 仍受上位门禁约束

- 本卡只签收 `MW-1`，不代表 Phase 2 已通过；`CODEX-1` 与 `GATE-P2` 尚未完成。
- 本单元只建立通道上下文读取边界，没有新增 AI 自动创建/修改通道的产品入口；未来若增加，必须使用候选、Gateway exact evidence 与统一 adoption，不得从 UI 直连模型。
