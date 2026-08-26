# PROGRESS-1 完成卡：正文采纳后的受控七域演化

日期：2026-08-24

任务：`PROGRESS-1`

状态：通过；允许进入 `FUTURE-1`

## 完成结论

正文生成/续写的正式采纳不再直接启动隐藏后处理，而是统一进入
`preparePostAdoptionAfterCommit()`。该协调器先执行零模型的确定性失效，再读取当前 Work 的作者策略，
最后才决定关闭、提出建议或在明确预算内自动执行。架构守卫会阻止正文采纳入口重新绕过该顺序。

每个 Work 独立保存以下作者配置：

- `off`：只清理或标记可重建派生数据，不创建章后模型 Run。
- `suggest`：旧 Work 和新 Work 的安全默认值；持久化调用次数、token、费用、任务和模型路由估计，
  作者确认前没有 `model.requested`。
- `auto-with-budget`：冻结任务、模型路由、调用、输入/输出 token、最大费用及未知价格授权；任一项越界时
  在模型调用前停止，不静默改用其它模型、降级任务或扩大预算。

策略设置属于 Work，不会串到同一 World 的其它作品。正文 hash、设置或实际模型路由变化会使旧授权失效；
同一 Work、章节、正文、设置和路由只创建一个稳定 task，刷新和重复触发不会重复扣费。

## 七域与上下游闭包

“整理本章”同一次结构化响应现覆盖：状态、事实、物品、故事年表、角色关系、伏笔、故事线。
故事线域可提出既有主/支线进度、两线交汇和新故事线三类候选；全部以正文逐字证据和登记 arc/stage
闭集校验，作者确认前业务表零写入。选中的故事线子候选在同一 IndexedDB 事务内采纳，避免部分写入。

章后 Run 只冻结所选任务真正需要的 Context Source、Skill binding 和写目标：

- 七域候选只获得七域上下文与作者确认写权限；
- 章节记忆只获得 `chapters` 派生字段权限；
- 检索和一致性步骤不获得 Canon 写权限；
- 检索自动补齐章节记忆前置，一致性自动补齐检索与记忆前置。

章节正文一旦变化，建议授权和七域候选均 stale；多 Work/World 读取通过 `readOwnedRows()` 和 scope
断言隔离。`StorylineProgressPanel` 不再用项目级查询拼接章节和大纲。

## 失效与写入边界

正文采纳后无论策略为何都会先：

1. 删除当前章节可重建的 retrieval chunks；
2. 保留摘要原文，但把当前章及其卷/书级 rollup 标为 stale；
3. 仅在逐字证据已经从正文消失时，把来源事实降级为 stale；
4. 保留作者确认 Canon，不让后台流程自动重写故事线、状态、事实或历史正文。

章节 summary、continuity handoff 和检索索引属于可重建派生数据；七域 Canon 候选仍需作者单独确认。
拒绝建议只关闭本次任务，不回滚已经完成的确定性失效。

## 验证证据

- `R-PROGRESS1-post-adoption-policy`：6 项，覆盖旧 Work 默认建议、零调用建议、task 幂等、Work 隔离、
  最小权限、正文变化 stale、未知费用/超预算预调用阻断、派生失效隔离及故事线三类候选采纳。
- 关联 durable/组织/lineage/consistency/Skill 回归：7 个文件、34 项通过。
- 正式 AI 入口与记忆结算回归：2 个文件、11 项通过。
- 全量 `npm run ci`：477 个测试文件、2,295 项测试全部通过；覆盖率、生产依赖审计、lint、TypeScript、
  三注册表/架构/来源可达性检查、生产构建和 bundle budget 全部通过。
- 全量门禁额外反证并修复了严格 Gateway 迁移债：主 Agent 现在从冻结 Skill 写目标通用派生
  outline/detail/prose 的 required Gateway 授权，不再保留仅覆盖世界观/角色的手写领域白名单；旧测试夹具
  也统一补齐资源身份、exact `ragSelection` 和 Gateway 运行证据。
- `npx tsc --noEmit`、`npm run check:architecture`、`npm run check:required-tables`（83 张表）、
  `npm run check:ai-manual`、`npm run build`、`git diff --check` 通过。
- 隔离浏览器使用独立 `127.0.0.1:4179` origin：创建专用 Work 后确认默认 `suggest`；切换 `off`
  并刷新后仍持久化；`auto-with-budget` 展示完整预算和未知价格授权；最后恢复安全默认 `suggest`。
  测试没有读取/复制 API Key，也没有修改作者在 4178 的预览项目。

本卡不把静态估算当作实际账单，也不提前宣称未来大纲保护、十万/三十万/百万字质量或整条真实 API
生产链已经通过；这些分别由 `FUTURE-1`、`GATE-P3` 和 Phase 4 的封闭评测签收。
