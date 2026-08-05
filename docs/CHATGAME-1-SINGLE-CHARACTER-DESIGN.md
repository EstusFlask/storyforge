# CHATGAME-1 · 单角色聊天 MVP 功能登记

## 1. 开工登记卡

| 项目 | 内容 |
|---|---|
| 稳定 ID / 类型 | `CHATGAME-1` 单角色聊天 MVP / 完整功能 |
| 用户故事 | 用户选择一个已创作角色和世界快照，设定自己的身份与场景，进行可恢复、可分支的角色对话。 |
| 主归属 | CHATGAME-1 角色聊天与冒险；复用 SIM-1 运行时、Canon 冻结和会话分支。 |
| 取代/下线 | 不新建第二套聊天或游戏引擎；体验中心现有角色聊天入口统一使用共享运行时。 |
| 本阶段范围 | 单角色、用户身份/场景、冻结角色快照、流式回复、重生成、事件持久化、检查点和分支。 |
| 非范围 | 长期记忆、多角色房间、地点/物品/能力判定、文字游戏规则、多人在线和自动回写角色主档。 |
| 外部依赖 | SIM-1A/B 的事件 reducer、Canon 快照、`assembleContext()` 和共享 AI 客户端。 |

## 2. 三注册表四问

| 问题 | 本阶段裁决 |
|---|---|
| AI 读什么 | 只声明 `CONTEXT_SOURCES.simulationRuntime`，由 `assembleContext()` 提供冻结运行时实体、场景和可见聊天记录；组件不扫描 IndexedDB 拼接上下文。 |
| AI 写什么 | 角色回复先解析为事件候选并写入共享模拟事件；不新增 Canon 写字段，不绕过 `FIELD_REGISTRY / AdoptionSchema → adopt()`。 |
| 哪些表参与生命周期 | `simulationSessions`、`simulationEvents`、`simulationCheckpoints` 已登记在 `PROJECT_TABLES`，由其负责项目/世界删除、导入导出、父子分支和 FK 重映射。 |
| 缺失哪个注册表 | 无缺失；聊天提示词和长度限制属于纯运行时适配，不建立平行上下文或数据表。 |

## 3. 安全与实现边界

- 角色使用运行时人格快照，角色主档变化不会静默进入聊天；聊天回复不得直接改变位置、物品、生命或能力。
- 用户消息和角色回复有明确长度上限；回复重生成通过 `supersedes` 关系保留历史，不覆盖原事件。
- 流式输出只有完整解析并通过边界检查后才持久化；刷新从事件日志恢复，检查点恢复建立独立分支。
- 角色知识边界由冻结运行时上下文约束；未授权 Canon 不进入提示词。

## 4. 验收证据

- 定向回归：`tests/regression/R-CHATGAME1-single-character-chat.test.ts`，覆盖消息协议、长度边界和重生成/分支语义。
- 浏览器验收：`tests/e2e/core-workflow.spec.ts` 的角色聊天创建、流式回复、刷新恢复和分支路径。
- 设计与共享基座证据：`docs/INTERACTIVE-RUNTIME-ROADMAP.md`、`docs/SIM-RUNTIME-DESIGN.md`。

本阶段完成的是单角色聊天 MVP；长期记忆、多角色房间、冒险规则和多人在线必须在后续功能单位中重新登记和验收。
