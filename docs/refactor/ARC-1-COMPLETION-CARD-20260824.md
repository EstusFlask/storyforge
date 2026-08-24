# ARC-1 完成卡：主线/支线可执行层与持续变换

日期：2026-08-24

任务：`ARC-1`

状态：通过；允许进入 Phase 3 `OUTLINE-1`

## 完成结论

故事线不再只有“AI 新增一条”能力。作者可以针对当前稳定故事线发起扩写、重写、润色或重规划；
操作类型和 `targetArcId` 会冻结进 Master Plan、durable Run 与候选载荷，刷新恢复不会改变目标或重复调用模型。
作者确认前 Canon 零写入；采纳后只原位更新目标记录，不复制出同名故事线。

## 资源与证据闭包

1. StoryArc、稳定 `stageId`、阶段内关键事件、storyline progress 与 crossing 均进入 Canon Resource
   Provider；关键事件可通过稳定阶段资源和事件序号渐进读取。
2. 既有故事线变换把目标聚合资源以 `full` 冻结，并把 `name/type/description/stages` 四个字段以
   `original` 冻结；目标 progress/crossing 同时作为 Mandatory full resources。
3. 候选 freshness 同时覆盖故事意图、全部故事线、动态 progress 和 crossing；任一基线变化都会阻断旧候选。
4. 新线/新阶段 Prompt 明确要求说明触发证据、关联角色、开始时点和与现有线的因果关系；未确认信息只能
   进入 assumptions，不得伪装为 Canon。

## 变换与采纳合同

- 创建：候选不得伪造 `stageId`；正式 ID 只在采纳时生成。
- 扩写/润色：冻结原版与可编辑新版并排展示；这是版本对照，不声称进行事实级语义验证。
- 重写/重规划：只展示可编辑新版；保留或修改阶段必须回传原 `stageId`，新增阶段省略 ID，删除阶段通过
  省略已有 ID 明确表达。
- 未知、重复或伪造 `stageId` 在写入前阻断；目标名称和主/支线身份不能被变换候选偷换。
- 采纳经登记 `adopt()` 写入字段，再由故事线生命周期原子清理被删除阶段造成的悬空 progress 指针。
- 故事核心变化或来源缺失时，UI 显示确定性过期原因及 storyCore revision、producer Run、candidate hash
  provenance，不静默选择或覆盖任一版本。

## 验证证据

- ARC-1 与关联回归：6 个测试文件、61 个测试通过。
- 其中包含真实 Gateway trace、durable 刷新恢复、候选前零写入、稳定阶段 ID、未知 ID、动态进度 stale、
  Intent provenance、Canon 目录分页以及 UI 双版本对照。
- `npx tsc --noEmit` 通过。
- `npm run check:architecture` 通过：无三注册表或 AI/DB 旁路反模式。
- `npm run check:required-tables` 通过：83 张表与 schema 一致。
- `npm run check:ai-manual` 通过，派生 AI 手册与 story-arc-copilot-v8 一致。

完整 CI、生产构建和隔离浏览器 E2E 在 `GATE-P3` 对 ARC→outline→detail→prose 整链统一执行；本卡不提前
宣称大纲、细纲、正文或百万字能力已经通过。

