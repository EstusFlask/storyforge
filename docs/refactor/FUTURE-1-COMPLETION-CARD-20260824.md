# FUTURE-1 完成卡：只向未来的持续演化控制面

日期：2026-08-24

任务：`FUTURE-1`

状态：通过；允许进入 `GATE-P3`

## 交付结论

StoryForge 现在把持续创作明确收口为同一条作者确认循环：

```text
未来故事线 / 新角色候选
  → 作者采纳
  → 未来章纲候选
  → 作者采纳
  → 未来细纲候选
  → 作者采纳
  → 下一未写章正文候选
  → 作者采纳
  → 七域章后结算与派生记忆
  → 重新计算最后已写章边界，进入下一轮
```

游戏、跑团、角色聊天和文字游戏不在这条循环中反写 Canon。它们只消费不可变 `WorldRelease`；
试玩或互动产生的新需求重新作为作者目标进入上述未来循环。

## 关键修复

1. `staged-author-confirmed` 不再只是分类标签。durable trace 和默认执行器同时实施作者确认屏障：
   上游候选未采纳时，下游步骤保持 `scheduled`，不会产生 `model.requested`。
2. 上游采纳后，下游不再把作者可编辑候选文本或临时假设直接拼进 Prompt；它通过已登记 Context
   Gateway 重新读取最新 Canon。候选 hash 只保留为 lineage，不再充当正式上下文。
3. 作者采纳上游候选后，UI 会在仍有可执行步骤时继续同一 durable Run；若继续失败，已完成采纳不回滚，
   运行保留为可恢复状态。
4. `buildFutureEvolutionPlanV1()` 以标准章序计算最后已写章：保护边界之前的章纲全部只读，边界之后才是
   未来章纲、细纲和正文目标。即使中间存在空章，只要更晚章节已有正文，空章也归入保护区。
5. 未来故事线沿已确认 `storylineProgress.currentStageId` 冻结已有阶段 ID；演化只允许创建/扩展故事线、
   创建新角色和规划未写未来，不把历史改写混入普通续写。
6. 计划的 Skill、上下文源和写目标全部从 `AGENT_SKILLS` 派生；本单元没有新增手写来源清单、平行
   AI 入口、表或写回路径。

## 作者可见结果

正文编辑器的“影响分析”同时显示：

- 已写历史保护章数；
- 可继续规划的未来章数；
- 缺少细纲的未来章数；
- 故事线/角色、章纲、细纲、正文、章后结算、产品投影六阶段；
- 当前计划 hash。Canon 一旦变化，旧计划 fail-closed，必须重新计算。

## 回归证据

- `R-FUTURE1-continuous-evolution`：2/2 通过；覆盖继承世界作用域、最后已写章、故事线阶段保护、
  角色世界隔离、细纲/正文目标、stale 与边界前移。
- `R-HARNESS22-master-dependency-join`：6/6 通过；新增分阶段正向恢复和恶意执行器绕过反例，证明
  上游采纳前下游零 `model.requested`，作者编辑后的上游 Canon 被恢复阶段读取。
- `R-AUDIT6-chapter-editor-toolbar`：13/13 通过；作者可见未来边界与产品反馈回路。
- 相关执行回归：6 files / 34 tests 全绿；`npm run lint`、`npx tsc --noEmit`、
  `npm run check:architecture`、`git diff --check` 通过。

完整 CI、生产构建和隔离浏览器真实 API 整链由 `GATE-P3` 统一签收。本卡不提前宣称百万字质量门、
真实模型长篇一致性或 Phase 4/5 已通过。
