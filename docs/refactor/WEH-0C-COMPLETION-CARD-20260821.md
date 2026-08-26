# WEH-0C 完成卡：保存屏障与内容修订向量

> 日期：2026-08-21  
> 分支：`refactor/world-engine-harness`  
> 前置：WEH-0B `8913350`

## 1. 完成结论

WEH-0C 已建立作者编辑的统一保存屏障。行内草稿、debounce 草稿和相应 store 写入会在正式生成、切世界及组件卸载边界完成提交；任一保存失败都会 fail-closed，不允许模型抢先读取旧 IndexedDB 状态。

主 Agent、大纲、批量大纲、细纲和正文候选现在保存 `WorkspaceContentRevisionVectorV1`。向量的表集合由 `PROJECT_TABLES` 的 `workspaceProjection/worldDomains` 元数据派生，排除二进制、Agent ledger、缓存和临时数据；采纳前若相关 Canon 已变化，候选 durable step 会先进入 `stale`，随后拒绝写回。

## 2. 真实施工边界

- `PendingEditCoordinatorV1`：登记 UI draft flusher；按记录 key 串行异步保存；循环等待 flush 期间新增的写入；未解决失败持续阻断，直到同 key 后续保存成功。
- 行内编辑：`InlineInput/InlineTextarea` 不再只依赖 blur；正式屏障可主动提交，组件卸载也提交最后草稿。角色维度 debounce 进入同一屏障。
- 保存入口：世界观/故事核心、项目单例设定、角色、修炼体系、大纲、细纲、正文、参考资料的行内更新均同步登记保存 Promise。
- 作用域切换：`WorldGroupSwitcher` 先保存再切换；失败保留原世界并显示错误。
- 正式生成：Master Copilot、单次/批量大纲、细纲、正文生成与续写在上下文装配前 flush，并在装配后复核同一 revision。
- durable stale：Master、outline、detailed-outline、prose 新候选冻结 revision；上游漂移时写入 `candidate.staled`，正式表零覆盖。
- 兼容：WEH-0C 前的候选缺少 revision 时，继续按既有 target snapshot、Context Manifest 和 CAS 规则处理，不伪造新证据。

## 3. 三注册表与生命周期

- AI 读取仍由 `CONTEXT_SOURCES + assembleContext()` 决定；revision 只验证内容新鲜度，不成为第二套上下文系统。
- AI 写回仍由 `FIELD_REGISTRY + AdoptionSchema + adopt()` 或已登记扩展完成；协调器没有业务写权限。
- 没有新增 Dexie 表。revision 作为现有 Agent candidate payload 的可选版本化证据，随 `PROJECT_TABLES` 已治理的 Run/Event 生命周期保存、恢复和迁移。
- revision 表集合直接从 `PROJECT_TABLES` 元数据派生；架构守卫禁止关键正式入口或行内 store 重新绕过屏障。

## 4. 关键反例收据

| 反例 | 结果 |
|---|---|
| 未 blur 草稿直接生成 | draft flusher 先执行；正式生成等待其登记的写入完成 |
| 保存 Promise 未结束 | flush 不提前完成 |
| 保存失败 | 后续正式 flush 持续失败；同 key 成功重存后才解除 |
| 同一记录快速多写 | Promise queue 严格串行 |
| 组件切页卸载 | 最后一版草稿提交，不依赖 blur 顺序 |
| 当前世界 Canon 修改 | revision 报告变化表，候选标 stale，正式目标零写 |
| 兄弟世界正文修改 | world-scoped 内容不进入当前世界向量 |
| Agent candidate/event 落库 | ledger 表不在向量内，不会使候选自我失效 |
| 大纲/正文上游修改 | outline/prose durable step 明确进入 stale |
| Master 上游修改 | Master candidate 标 stale，故事核心保持原值 |
| 旧项目所有权迁移 | scope resolve 后重新读行，避免以迁移前对象静默跳过保存 |

## 5. 验证收据

| 门禁 | 结果 |
|---|---|
| WEH-0C + Master/Outline/Detail/Prose 扩展回归 | 29 files / 195 tests passed |
| 保存/修订专项 | 4 / 4 passed |
| 大纲 durable 中断、CAS、恢复 | 39 / 39 passed |
| 相关 store/UI 回归 | 11 files 中 35 项通过；迁移后标题同步反例另行定向复验通过 |
| 注册表/架构检查 | required tables、AI manual、AI entry、architecture、source reachability、roadmap、agent context、agent freshness、canon coverage 全部通过 |
| TypeScript / ESLint | `npx tsc --noEmit`、`npm run lint` 通过 |
| production build | `npm run build` 通过 |
| patch hygiene | `git diff --check` 通过 |

测试日志中的“装配失败”“实际来源集合不相等”和“上下文损坏”均为主动构造的 fail-closed 反例，相应用例通过。

## 6. 能力边界和下一单元

- 当前 revision 是保守的内容级全量哈希屏障。它优先保证不采纳旧候选；Phase 1A 在稳定 resource UID 与 revision 建成后，应收窄为精确资源向量并保留 V1 只读兼容。
- 本单元没有解决候选文本框自身的快速编辑/刷新竞态；这属于 `WEH-0D`。
- 本单元没有统一 JSON salvage/repair、Prompt Engine 或正式 AI entry binding；分别由 `WEH-0E`、`WEH-0F`、`WEH-0H` 承接。
- 回滚不得恢复保存失败后仍调用模型的路径；若移除新 revision，只能回到旧候选的保守不可验证/重生成语义。
