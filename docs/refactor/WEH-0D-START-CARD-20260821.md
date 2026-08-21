# WEH-0D 开工卡：候选草稿串行与决策屏障

> 日期：2026-08-21  
> 分支：`refactor/world-engine-harness`  
> 基线：WEH-0C `252e427`

## 1. 当前真实链路与缺口

世界观、故事核心、角色、故事弧、情节推进、创作规则、游戏生成及总对话面板都把候选文本框直接绑定到 `candidate.event.content`，每次 `onChange` 立即调用 `updateAgentEventCandidate()`。

对 durable 候选而言，一次保存不只是更新文本，还会校验旧 `candidateHash`、追加 `candidate.revised`、使旧验证收据失效并重建可用收据。浏览器连续输入会发出未排序的异步事务；后一次操作可能在前一次完成前读取旧 hash，造成保存失败、旧写覆盖新写，或界面文本与 durable ledger 不一致。采纳入口也没有等待最后一次候选保存。

## 2. 本单元裁决

| 关注点 | WEH-0D 方案 |
|---|---|
| 输入体验 | 文本框先更新 React 本地草稿，不等待 IndexedDB |
| 落库策略 | 以 `scope + conversation + candidate event` 为键防抖；每个候选独立串行，编辑期间合并中间版本 |
| durable 一致性 | 每次实际持久化仍只调用 `updateAgentEventCandidate()`，继续由既有 Run/Event 事务维护 hash 与验证收据 |
| 决策屏障 | 采纳和拒绝前必须 flush，并从 IndexedDB 重读候选；同步失败时不得执行决策或写业务表 |
| 页面边界 | 组件卸载、`pagehide` 和刷新意图触发 flush；存在未同步草稿时 `beforeunload` 明确阻止静默离开 |
| 多候选隔离 | 不使用全局单尾队列；每个候选拥有独立版本、timer、Promise drain 和错误状态 |
| 可观察性 | 后台保存失败进入 hook 错误状态；草稿继续保留，后续成功编辑可恢复 |

## 3. 三注册表与生命周期

- 本单元不改变 AI 读取来源，`CONTEXT_SOURCES + assembleContext()` 仍是唯一上下文入口。
- 本单元不改变业务字段写入，采纳仍经 `FIELD_REGISTRY / AdoptionSchema / adopt()` 或已登记的领域扩展。
- 不新增表。候选文本和 revision 仍保存在 `PROJECT_TABLES` 已治理的 Agent Event/Run 表中。
- 候选协调器只有“排序、合并、等待”权限，不获得 Canon 写权限，也不建立平行候选存储。

## 4. 必须先失败的反例

1. 同一候选连续输入 1000 次，最终 IndexedDB 文本必须与最后一次输入逐字一致。
2. 持久化仍在进行时继续输入，后一次不得被先完成的旧写覆盖。
3. 两个候选交错编辑，各自保持顺序且互不等待、互不串写。
4. 最后一次保存失败时点击采纳，业务表零写、confirmation 零写、草稿仍在界面。
5. 保存恢复后再次采纳，必须使用重新读取的最新 payload/hash 和最新正文。
6. 卸载、`pagehide` 和刷新意图均不得静默丢弃未同步草稿。
7. 非 durable 旧候选继续可编辑、刷新恢复和采纳。

## 5. 非范围与回滚

- WEH-0D 不处理结构化输出 salvage/repair、Prompt Engine 或 Context Gateway。
- 证据 UI 的完整聚合属于 WEH-0G；本单元只提供可查询的 draft diagnostics 和明确错误。
- 回滚不得恢复“每个按键直接并发写 durable ledger”；若协调器不可用，应 fail-closed 并禁用候选决策。
