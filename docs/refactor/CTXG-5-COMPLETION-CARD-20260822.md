# CTXG-5 完成卡：确定性预选与上下文充分性

## 完成结论

- 任务 ID：`CTXG-5`
- 基线：`85747f36`
- 分支：`refactor/world-engine-harness`
- 状态：完成，允许进入 `CTXG-6`；本卡不宣称 Phase 1A 已过门或正式生成入口已切换。

Context Gateway 现在已有一个由 Skill `contextTaskKind`、`ContextAccessPolicyV1`、冻结 scope、metadata descriptors 与显式预算共同驱动的纯函数预选层。作者正文仍保留在 Canon；Skill 只携带读取规则和证据义务。

## 实现范围

1. 为五个登记 task kind 各冻结一份 selector policy；共享同一算法，只区分 core kinds、五类预算比例、一跳上限和早期/最近锚点上限。
2. 选择硬优先级依次覆盖显式 Mandatory、must-read、pinned、目标资源、mandatory source 与任务 Mandatory Core；硬集合超预算仍完整保留并在充分性报告中 fail-closed，不静默丢项。
3. 世界、角色、故事规划、正文事实、参考五类资源拥有独立预算份额；`perKindMinimumTokens` 进一步形成逐 kind 硬证据义务。
4. 自动选择先读 summary/index，明确 Mandatory、Pinned、Must-read 和目标资源才优先 focused/full，形成渐进式披露而非固定前 N 条全文拼接。
5. 实体、故事线、时间范围、作者权重、authority、task relevance、revision 和稳定 resource key 进入确定性排序；输入目录排列不影响结果。
6. 高风险关系只从冻结种子扩展一跳；扩展结果不再成为下一跳种子。当前邻域、相关早期时间锚点与最近 revision 各有独立 reason code。
7. 输出包含 selected/omitted、选择深度、分类预算、hard requirement、reason codes、inventory hash、sufficiency report hash 和 selector hash。
8. 充分性 builder 增加严格字段/status/evidence 校验；软 missing/conflicted 才可请求追加读取，Mandatory、scope、同名异 Canon 或硬预算冲突直接阻断。
9. Canon descriptor 现在携带作者 `retrievalWeight` 与 `tokenCap`；二者仍从已有 `ragPolicy` 派生，未新增策略表或第四注册表。
10. `assembleContext` 继续作为统一导出边界；selector 不导入数据库、不读正文、不写表，也不触发模型调用。

## 关键反例

- 相同目录正序、倒序和目标位于首/中/末时，选择集合、报告和 hash 完全相同。
- 所有可发现的 Mandatory/Pinned/Must-read 交付率 100%；缺失目标或硬集合超预算时 `additionalRead=forbidden`。
- 一个 5000-token 世界观资源不会挤掉角色、故事规划、正文事实及更小的世界锚点。
- 一跳资源带有 `one-hop-high-risk`；它自己的关系目标不会被误扩成第二跳。
- 早期事实与最近 revision 可同时进入计划；reason code 能解释每个选择，而非只暴露一个分数。
- 隐式 candidate 不可见，显式 key candidate 才可进入；跨 Work/WorldGroup descriptor 形成硬 scope-integrity 冲突。
- 同名同 kind 且正文 hash 不同的已选 Canon 形成结构化冲突，不允许悄悄择一。
- selector source 无任何 DB 依赖，运行只消费调用方提供的 metadata descriptors。

## 验证记录

- 关联回归：5 files / 31 tests，全绿（CTXG-1～5）。
- 十项静态闸门：required tables、AI manual、AI entry registry、architecture、source reachability、roadmap、agent context、agent freshness、Canon coverage、project metrics 全绿。
- `npm run lint`：通过。
- `npx tsc --noEmit`：通过。
- `npm run build`：通过，3966 modules。
- `npm run check:bundle-size`：通过；entry 665.7 KiB / 198.5 KiB gzip，未超过 700 / 230 KiB 预算。
- `git diff --check`：通过。

## 后续边界

- `CTXG-6` 把本选择结果、实际 resource reads、SourceRef evidence、sufficiency、Prompt 与 candidate 串进现有 Manifest/Run Artifact/Trace，保证逐字回读和 replay。
- `CTXG-7` 才把确定性快路径和有限追加读取接入正式 Skill；当前 selector 不自行调用四个 Gateway 工具。
- `CTXG-8` 才实现 scope/version/content/policy hash 缓存、失效和百万字目录性能门。
