# TTRPG-1A 单机战役主持

> 状态：已交付（2026-08-03）
> 主归属：TTRPG-1 跑团与战役主持
> 前置：SIM-1A / SIM-1B / SIM-1C

## 1. 完整功能边界

用户从已冻结的 StoryForge 世界建立跑团会话，设置当前场景和回合顺序，选择行动者并输入动作；
可以手动执行技能检定，也可以让 AI GM 生成结构化回合候选。作者确认“记录回合”后，系统在一个事务中追加：

1. 玩家动作。
2. 可选的确定性技能检定。
3. 依据真实检定结果选择的 GM 叙事。
4. 由代码计算的下一行动者和回合号。

刷新、检查点、分支、导出导入和会话续接继续复用 SIM-1，不另建跑团存档体系。

## 2. 三注册表四问

- **读什么**：AI 只读 `CONTEXT_SOURCES.simulationRuntime`，内容来自冻结 Canon 快照、运行时实体、
  当前场景、回合顺序、最近动作、检定和叙事；不重新读取可变创作表。
- **写什么**：AI 没有 Canon 写字段，不新增 `FIELD_REGISTRY` / `AdoptionSchema`；AI 输出先成为组件内
  可审阅候选，确认后只经专用运行时 API 追加事件。
- **哪些表**：只使用已登记 `PROJECT_TABLES` 的 `simulationSessions / simulationEvents /
  simulationCheckpoints`；无新表、无 DB 版本迁移，既有项目/世界删除和便携生命周期直接覆盖。
- **缺失注册表**：无。`simulationRuntime` 已是共同只读上下文源；运行时事件不属于创作 adoption。

## 3. 事件与规则

| 事件 | 作用 | 写入入口 |
|---|---|---|
| `ttrpg.scene.opened` | 冻结当前场景、地点、回合顺序和首位行动者 | `openTtrpgScene()` |
| `ttrpg.action.recorded` | 记录玩家明确提交的动作 | `appendTtrpgTurn()` |
| `ttrpg.check.resolved` | 保存确定性骰点、技能、DC 和成功状态 | `resolveTtrpgCheck()` / `appendTtrpgTurn()` |
| `ttrpg.gm.response.recorded` | 保存与动作/检定关联的 GM 叙事 | `appendTtrpgTurn()` |
| `ttrpg.turn.advanced` | 按固定顺序推进行动者和回合号 | `appendTtrpgTurn()` |

通用 `appendSimulationEvent()` 禁止写这些事件。骰点由会话 seed、事件序号、骰式和 nonce 派生；
AI 只能提出骰式、DC、成功叙事和失败叙事，不能提交骰点或改变回合顺序。候选基线过期时整个事务拒绝，
不会留下半个回合。

## 4. 非范围与后续功能

- `TTRPG-1B`：战斗遭遇、资源、状态效果、先攻和伤害规则。
- `TTRPG-1C`：长期战役摘要、任务、NPC 日程和跨会话节奏管理。
- `TTRPG-1D`：多人协作；等待 PLATFORM-1 的账号、同步和冲突处理。
- 战役日志不会自动写成小说正文、Canon、角色主档或正式物品流水。

## 5. 验收证据

- `R-TTRPG1-campaign-runtime`：场景、原子回合、确定性检定、成功/失败分支、过期拒绝和回合轮转。
- `R-TTRPG1-gm-parser`：严格 JSON、行动者锁定、未知字段、检定/分支配对和 Prompt 红线。
- `R-SIM1-runtime-ui`：从可见跑团入口开始场景并执行技能检定。
- SIM-1 原有检查点、分支、导出导入、删除和 Canon 不变性回归继续覆盖共同生命周期。
