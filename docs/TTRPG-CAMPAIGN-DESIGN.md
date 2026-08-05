# TTRPG-1A/1B/1C 单机战役、战斗遭遇与长期战役

> 状态：TTRPG-1A/1B/1C 已交付（2026-08-05）
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

## 4. TTRPG-1B · 规则与战斗遭遇

### 完整功能边界

在已有跑团场景上，作者可以直接创建或让 AI 提出一份遭遇候选。作者确认后，系统从冻结运行时
实体读取先攻、生命值、护甲和可用资源，按会话 seed 与事件序号计算确定性先攻并建立战斗回合。
战斗行动支持攻击骰、护甲命中、伤害骰、资源扣减、资源手动调整和状态效果施加/移除；每一步都
进入同一条 `simulationEvents` 事件流，刷新、检查点、分支和导出导入继续复用 SIM-1。

### 三注册表四问

- **读什么**：AI 遭遇和 GM 只读取已经登记的 `CONTEXT_SOURCES.simulationRuntime`，其中包含冻结
  Canon、实体、当前场景、回合、遭遇参与者、资源、状态、攻击和最近事件；不重读可变创作表。
- **写什么**：AI 没有 Canon 写字段，不新增 `FIELD_REGISTRY` 或 `AdoptionSchema`。AI 遭遇输出先在
  UI 中作为候选，作者确认后只通过 `startTtrpgEncounter()` 写入运行时事件。
- **哪些表**：只使用 `PROJECT_TABLES` 已登记的 `simulationSessions / simulationEvents /
  simulationCheckpoints`；无新表、无迁移，既有删除、导入导出和引用重映射直接覆盖。
- **缺失注册表**：无。战斗资源和状态是运行时遭遇快照，不是 Canon 字段。

### 事件与确定性规则

| 事件 | 作用 | 写入入口 |
|---|---|---|
| `ttrpg.encounter.started` | 保存遭遇、参与者、先攻顺序、护甲、资源和首位行动者 | `startTtrpgEncounter()` |
| `ttrpg.encounter.resolved` | 结束当前遭遇并保留最终战斗状态 | `resolveTtrpgEncounter()` |
| `ttrpg.combat.attack.resolved` | 保存攻击骰、命中结果、伤害骰和目标资源 | `resolveTtrpgAttack()` |
| `ttrpg.combat.resource.changed` | 在 0 与上限之间调整已登记资源 | `changeTtrpgResource()` |
| `ttrpg.combat.condition.applied` | 施加或叠加状态效果 | `applyTtrpgCondition()` |
| `ttrpg.combat.condition.removed` | 按稳定状态 ID 移除状态效果 | `removeTtrpgCondition()` |
| `ttrpg.combat.turn.advanced` | 按先攻顺序推进战斗回合并递减离场行动者的持续回合 | `resolveTtrpgAttack()` |

通用 `appendSimulationEvent()` 禁止写这些事件。AI 不得决定先攻、生命值、护甲、骰点、资源结果或
状态变化；候选基线过期、行动者越权、目标不在遭遇或事件顺序不一致时，整个攻击事务拒绝，不留下
半个回合。战役日志仍然只属于运行时，不自动写回小说 Canon。

## 5. 非范围与后续功能

- `TTRPG-1D`：多人协作；等待 PLATFORM-1 的账号、同步和冲突处理。
- 战役日志不会自动写成小说正文、Canon、角色主档或正式物品流水。

## 6. TTRPG-1C · 长期战役

长期战役资料继续保存在现有 `SimulationRuntimeState.ttrpg.campaign`，不新增表或并行存档。
摘要、任务和 NPC 日程都是专用事件，随事件流回放、检查点恢复、分支和项目便携往返。

### 事件与边界

| 事件 | 作用 | 写入入口 |
|---|---|---|
| `ttrpg.campaign.summary.updated` | 更新跨场景摘要，并校验作者编辑时的事件基线 | `updateTtrpgCampaignSummary()` |
| `ttrpg.campaign.quest.upserted` | 新增或更新任务、状态、优先级和运行时期限 | `upsertTtrpgQuest()` |
| `ttrpg.campaign.schedule.upserted` | 新增或更新 NPC 的时间段、地点、活动和重复方式 | `upsertTtrpgNpcSchedule()` |

世界时间复用既有 `time.advanced` 事件；任务期限和日程只读同一个 `state.clock`，不另建时钟。
分支复用 `branchSimulationSession()`，子会话从父会话指定序号继承摘要、任务、日程和实体状态，
之后的更新只进入子会话。AI 仍只读取 `simulationRuntime` 冻结运行时上下文，不能直接修改这些状态。

## 7. 验收证据

- `R-TTRPG1-campaign-runtime`：场景、原子回合、确定性检定、成功/失败分支、过期拒绝和回合轮转。
- `R-TTRPG1-gm-parser`：严格 JSON、行动者锁定、未知字段、检定/分支配对和 Prompt 红线。
- `R-TTRPG1B-combat-encounter`：确定性先攻、攻击/伤害原子事务、资源上下限、状态持续时间、
  专用事件防旁路、过期候选和便携往返。
- `R-TTRPG1C-long-campaign`：摘要/任务/日程与统一时钟回放、过期基线/伪造实体拒绝、分支继承与便携往返。
- `R-SIM1-runtime-ui`：从可见跑团入口开始场景并执行技能检定。
- SIM-1 原有检查点、分支、导出导入、删除和 Canon 不变性回归继续覆盖共同生命周期。
