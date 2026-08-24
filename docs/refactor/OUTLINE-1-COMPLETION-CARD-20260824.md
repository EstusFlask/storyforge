# OUTLINE-1 完成卡：大纲生成 Gateway 与未写未来边界

日期：2026-08-24

任务：`OUTLINE-1`

状态：通过；允许进入 Phase 3 `DETAIL-1`

## 完成结论

分步骤大纲页面与 Master outline Agent 不再各自决定“读什么”。二者共用
`prepareOutlineGatewayAssemblyV1()`，由 outline Skill、Context Gateway 和 Canon Resource Provider
冻结同一份上下文与证据；旧的页面层来源 resolver 不再进入正式请求。

大纲生成只允许规划未写未来。单章已有正文时禁止重生成该章摘要；单卷任一下属章节已有正文时禁止重生成
该卷摘要。该边界在模型调用前和候选采纳前各校验一次，刷新或并发修改不能绕过。

## 读取与证据闭包

1. Mandatory 上下文包含当前世界的故事意图原文、故事线及稳定阶段、目标父节点/定点目标、全部已写章节
   保护边界，以及激活叙事蓝图的 module、node、beat、choice。
2. 旧批次候选仅在明确的 continuation/batch 请求中作为 `priorOutlineCandidate` 注入，普通生成不会把历史候选
   当作 Canon。
3. 相关 Canon 可由 Gateway 选择；正式 outline Skill 禁止页面追加读取和手拼来源集合，World/Work/WorldGroup
   scope 不匹配时 fail-closed。
4. 每次正式调用在模型前持久化 exact preflight，在模型响应后、候选落盘前生成 ContextManifest V3；候选事务
   失败时保留已完成的模型/Gateway 证据并只重试候选事务。

## 写入与生命周期闭包

- 候选仍经统一 CreativeArtifact/durable Harness 保存，作者确认前不写 `outlineNodes`。
- 采纳沿既有受治理入口执行，content revision、候选 hash、CAS 和确认收据共同阻断 stale 或篡改候选。
- `narrativeBeats`、`narrativeChoices` 已登记稳定 Canon resource identity；新建 module/node/beat/choice 继承
  Work owner 并获得 portable UID，导入、重命名、世界切换与删除继续由 `PROJECT_TABLES` 生命周期派生。
- 章节正文被投影为只读 `written-boundary` 资源，只用于保护与下游规划，不成为可写目标。

## 验证证据

- OUTLINE-1 与关联回归：11 个测试文件、97 个测试通过。
- durable adapter：39/39，通过刷新恢复、候选事务恢复、确认/采纳中断恢复、并发 CAS、stale、篡改和
  fail-closed 场景。
- `npx tsc --noEmit` 通过。
- `npm run check:architecture` 通过，且守卫要求 OutlinePanel 使用共享 Gateway、禁止页面 resolver 回流。
- `npm run check:required-tables` 通过：83 张表与 schema 一致。
- `npm run check:ai-manual`、`npm run build`、`git diff --check` 通过。

完整 CI、真实 API/浏览器整链与大规模上下文评测在 `GATE-P3` 和 Phase 4 统一执行；本卡不提前宣称细纲、
正文或百万字质量已经达标。
