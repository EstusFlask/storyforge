# PROSE-1 完成卡：正文唯一 Gateway、长尾回查与 exact adoption

日期：2026-08-24

任务：`PROSE-1`

状态：通过；允许进入 Phase 3 `PROGRESS-1`

## 完成结论

正文编辑器的生成、续写、质量审查、语义审查和报告修订，以及主 Agent/ChatCopilot 的正文入口，
现已共用 `prepareProseGatewayAssemblyV1()`。正式入口不再从页面或 Copilot 维护 prose 来源数组，
也不再将角色、连续性和世界资料拆成第二份上下文真相。

正文 Skill 的物理来源统一为 `ragSelection`，逻辑输入仍声明章纲、细纲、故事线、进度、蓝图、
连续性、视角认知、当前事实和一致性档案。模型调用前冻结 exact Context Packet、Selector、
Source Snapshot 与实际请求，响应后形成 ContextManifest V3；候选只能在作者确认后经 `adopt()` 写正文。

## 读取与信息边界闭包

1. Mandatory 包含目标章纲标题/摘要原文、细纲全文与禁写项、直接前章的正文尾部/交接、当前故事线及 stage、
   storyline progress、视角角色与该角色在目标章边界内的 confirmed knowledge、有效 confirmed facts、
   active narrative blueprint、作者明确引用及目标章 Consistency Dossier。
2. 长尾世界设定、早期伏笔、远距章节和其它相关资源由 Gateway selector 在统一预算内选择；
   Consistency Dossier 是按目标章即时生成的高权威资源，不为每章预先物化一份平行事实库。
3. Canon Provider 的冻结 scope 新增 chapter 与 perspective character 边界。`characterId=null` 明确禁止全体角色认知
   进入正文检索；指定角色时只暴露该角色账本，其他角色的私人知识不会因自动选择而泄漏。
4. 多世界、Work、章节与角色边界进入 scope fingerprint；采纳时以完全相同的 scope 重建目录并检查 freshness。
5. 主 Agent 仍支持“尚未创建章节记录”的无写候选；此兼容入口使用同一 Gateway，但不伪造章节或细纲资源。
   ChapterEditor 正式分步骤入口继续要求目标章节和细纲已经存在。

## 候选、审查与写入闭包

- 正文 RunContract 冻结 `prose.chapter.generate|continue` FormalAIEntry、Skill binding 和写目标。
- 模型前 exact preflight，模型后 raw response 与 ContextManifest V3，候选 hash 与实际响应 hash 绑定。
- 必读章纲、细纲禁写项、事实、认知、蓝图或档案任一变化，采纳前均以 `candidate-context-stale` 阻断；
  stale 候选不能触碰 `chapters.content`。
- 生成、续写、review、revise 复用同一 Gateway assembly；审查者可以作不同解释，但不能重建更窄的手工上下文。
- Narrative Brief 能从 `ragSelection` 的精确资源块派生进入状态等运行时语义，不再因 Gateway 化退化为空合同。
- 架构守卫同时禁止 ChapterEditor 和主 Agent prose-copilot 恢复页面层来源清单或旧 `assembleContext()` 旁路。

## 验证证据

- PROSE-1 与关联正文回归：18 个测试文件、98 个测试通过。
- 覆盖正文编辑器、主 Agent/ChatCopilot、无章节零写候选、续写保护、视角认知隔离、跨世界隔离、
  直接连续性、语义审查/修订、刷新恢复、候选 stale、exact V3 采纳和六域写后整理既有能力。
- `npx tsc --noEmit` 通过。
- `npm run check:architecture` 通过；`npm run check:required-tables` 通过（83 张表）。
- `npm run check:ai-manual`、`npm run build`、`git diff --check` 通过。

本卡只签收正文唯一契约和 exact 上下文闭环。正文采纳后的授权策略、演化 child runs、未来规划保护、
真实 API/浏览器整链及十万/三十万/百万字评测分别由 `PROGRESS-1`、`FUTURE-1`、`GATE-P3` 和 Phase 4 签收；
当前不据此宣称百万字一致性已经达标。
