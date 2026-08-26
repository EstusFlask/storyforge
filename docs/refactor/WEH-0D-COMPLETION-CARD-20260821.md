# WEH-0D 完成卡：候选草稿串行与决策屏障

> 日期：2026-08-21  
> 分支：`refactor/world-engine-harness`  
> 前置：WEH-0C `252e427`

## 1. 完成结论

WEH-0D 已把世界引擎共用的候选编辑链路从“每次按键并发写 IndexedDB”改为“界面本地即时响应、按候选独立防抖、同候选严格串行、决策前强制同步”。世界观、故事、角色、大纲、故事线、创作规则和游戏生成面板继续共用 `useMasterCopilot`，因此无需逐页复制队列逻辑。

采纳与拒绝现在会先 flush 指定候选，再从 IndexedDB 重读 event/content/payload/hash，随后才进入 durable adoption 或旧版采纳。同步失败时不写 confirmation、不写 Canon，界面保留作者最后草稿并显示明确错误。组件卸载、`pagehide` 和 `beforeunload` 也进入统一保护边界。

## 2. 真实施工边界

- `CandidateDraftCoordinatorV1`：以 `scope + conversation + candidate event` 为键；每个候选独立保存 version、timer、Promise drain 和失败状态。
- 快速输入合并：防抖期内只保存最终版本；保存进行中出现新版本时，当前写完成后继续串行保存最新值，旧写不能覆盖新写。
- 本地草稿覆盖：后台同步或其它同 scope 面板 reload 时，未同步本地文本继续覆盖数据库旧文本，不因同步事件闪回。
- 事务内证据更新：creative artifact 的重算基于 `updateAgentEventCandidate()` 事务读取到的当前 payload，不再使用 UI 闭包中的旧 candidate hash/artifact。
- 决策屏障：flush 成功后重新读取候选；durable/legacy 两条采纳链路都只接收重读结果。
- 页面边界：未同步时刷新意图被显式拦截并触发 flush；卸载和 `pagehide` 尽力完成现有 IndexedDB 写入。
- 架构守卫：禁止删除候选队列、恢复逐键并发写、绕过决策前重读或移除离开保护。

## 3. 三注册表与生命周期

- AI 上下文仍只由 `CONTEXT_SOURCES + assembleContext()` 决定；候选草稿不是新上下文来源。
- Canon 写回仍经 `FIELD_REGISTRY + AdoptionSchema + adopt()` 或已登记领域扩展；协调器没有业务写权限。
- 没有新增 Dexie 表。候选内容、candidate hash、revision 和收据仍使用 `PROJECT_TABLES` 已治理的 Agent Event/Run 生命周期。
- 旧版非 durable candidate 保持可编辑、可刷新恢复和可采纳；新队列不要求迁移历史记录。

## 4. 关键反例收据

| 反例 | 结果 |
|---|---|
| 同一候选 1000 次快速输入 | 真实 IndexedDB Agent Event 最终逐字等于第 1000 版；防抖期只产生一次实际写入 |
| 写入期间继续输入 | 先完成旧事务，再保存最终稿；顺序固定且无旧写回盖 |
| 两候选交错编辑 | 各自独立 flush；候选 B 不等待被阻塞的候选 A |
| durable ledger 不可同步 | 采纳返回 false；confirmation 0、worldview 0、数据库仍为旧文本、本地保留新文本 |
| 刷新意图 | `beforeunload` 被取消并触发 flush；真实 Agent Event 保存刷新前最后一版 |
| 同 scope reload | 未同步 local draft 继续覆盖读回旧值 |
| creative artifact 多次编辑 | 每次实际写入基于当前数据库 payload 重算，避免 UI 闭包旧证据 |

## 5. 验证收据

| 门禁 | 结果 |
|---|---|
| WEH-0D 专项 | 2 files / 6 tests passed；无 unhandled rejection |
| 候选领域扩展回归 | 21 files / 109 tests passed |
| 注册表/架构检查 | required tables、AI manual、AI entry、architecture、source reachability、roadmap、agent context、agent freshness、canon coverage 全部通过 |
| TypeScript / ESLint | `npx tsc --noEmit`、`npm run lint` 通过 |
| production build | `npm run build` 通过 |
| patch hygiene | `git diff --check` 通过 |

回归日志中的 planner unavailable 是主动验证确定性降级的既有反例，对应用例通过。

## 6. 能力边界和下一单元

- `beforeunload` 能阻止静默刷新并发起 flush，但浏览器进程被强制终止时任何纯前端 IndexedDB 应用都不能保证异步事务完成；因此产品语义是“存在未同步草稿时阻止正常离开”，不是伪称系统崩溃零丢失。
- 本单元没有统一错误 JSON、字段漂移、salvage 与 repair；由 WEH-0E 建立唯一 structured-output pipeline。
- 完整运行证据 UI 将在 WEH-0G 聚合；本单元已提供 `candidateDraftDiagnosticsV1()` 供后续展示。
