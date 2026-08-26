# DETAIL-1 完成卡：场景细纲 Gateway、稳定合并与未写边界

日期：2026-08-24

任务：`DETAIL-1`

状态：通过；允许进入 Phase 3 `PROSE-1`

## 完成结论

单章场景拆分、单章增强和批量细纲现已共用 `prepareDetailedOutlineGatewayAssemblyV1()`。
正式入口不再维护旧的手工来源数组，也不再由批量 runner 通过 `contextResolver` 接收一份页面拼装上下文。
三条路径统一冻结 V3 formal RunContract、V2 `outline.details` Skill/Gateway 快照、模型前 exact preflight
和模型后 ContextManifest V3。

已有场景不再执行无条件 append。模型必须在 `scenePlanMode=merge-proposal` 下，对每个稳定 `sceneId`
恰好声明一次 `retain | modify | delete`，新增项使用 `add` 且不得伪造 ID；未知、遗漏、重复 ID 和内容重复场景
均在采纳前阻断。首次空细纲只接受 `replace + add`。

## 读取与证据闭包

1. `outline.details` 的正式 provider 来源只有 `ragSelection`；逻辑输入声明包含当前章纲、故事线、动态进度、
   已写章节进度和激活叙事蓝图，不再由组件复制来源清单。
2. Mandatory 包含目标章纲原文、前后相邻章、当前细纲/场景原文、当前世界故事线及稳定 stage、
   storyline progress、全部已写章节保护边界、已确认且同世界的事实，以及激活蓝图的 module/node/beat/choice。
3. 多世界隔离在资源选择前完成；其他世界的 story arc、progress 和 fact 不进入 Mandatory。
4. 单章与批量正式调用均在模型前落盘 Context Packet、Selector、Source Snapshot 与请求正文，响应后形成
   ContextManifest V3，再持久化候选；测试直接恢复并验证 exact artifact 链。
5. 真实 Manifest 测试证明 `activeNarrativeBlueprint` 的 module、node、beat、choice 均出现在模型实际读取证据中，
   修复了“Skill 声明需要蓝图、编辑器手写清单却遗漏蓝图”的非正常 Harness 分叉。

## 写入与生命周期闭包

- 作者确认前 `detailedOutlines` 零写入；刷新后从 durable candidate 恢复，不重复调用模型。
- 单章与批量候选均校验 output/candidate/manifest hash、正式上下文 freshness、章纲摘要 freshness 和 WorkspaceScope。
- 模型调用前与采纳前双重执行已写正文保护；目标章已经有正文时，必须进入独立改稿流程。
- 批量入口通过登记的 `outline.detail.batch` FormalAIEntry 调用模型，不再直连 `chat()`；正式写入仍经统一 `adopt()`。
- `detailedOutlines` 的 Work owner 由 AdoptionSchema 明确冻结；导入、导出、删除、迁移和引用生命周期继续由
  `PROJECT_TABLES` 派生。

## 验证证据

- DETAIL-1 与关联回归：11 个测试文件、44 个测试通过。
- 覆盖 mandatory 资源、跨世界隔离、已写目标阻断、稳定 sceneId 合并、未知/遗漏 ID、重复追加阻断、
  单章刷新恢复、作者修订、批量确认边界、exact V3 证据和正式 AI 入口机器登记。
- `npx tsc --noEmit` 通过。
- `npm run check:architecture` 通过；守卫禁止单章和批量细纲恢复手工来源/旧解析器/无条件 sceneId 追加旁路。
- `npm run check:required-tables` 通过：83 张表与 schema 一致。
- `npm run check:ai-manual`、`npm run build`、`git diff --check` 通过。

完整 CI、真实 API/浏览器整链和长篇检索质量在 `GATE-P3`、Phase 4 统一执行；本卡只签收 DETAIL-1，
不提前宣称正文、演化任务或百万字一致性已经达标。
