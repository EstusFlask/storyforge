# WEH-0B 完成卡：正式 durable 链路 fail-closed

> 日期：2026-08-21  
> 分支：`refactor/world-engine-harness`  
> 前置：WEH-0A `616ad49`

## 1. 完成结论

大纲正式入口不再允许 trace、candidate 或 adoption 证据失败后沿旧 UI 路径继续。正式运行现在必须创建可持久化 Run 和候选；候选采纳收口为一个 durable 命令，并以冻结 intent、确认时 CAS、幂等业务写入、adoption event、post-state verification 和 terminal receipt 构成同一条可恢复链路。

本单元没有宣称所有世界引擎字段已经迁移，也没有处理编辑器保存竞态、候选文本输入竞态、各领域结构化输出或 Prompt Engine 真接入；这些仍由 WEH-0C～0H 承接。

## 2. 已落地合同

| 合同 | 完成状态 |
|---|---|
| execution boundary | 新 Run Contract V3 显式冻结 `formal/evaluation/simulation/experimental`；V1、V2 原样可读，未篡改已存 V2 形状 |
| formal 权限 | 只有 formal outline binding 拥有 `author-confirmed` 写目标；非正式 binding 的 writeTargets 为空且不可采纳 |
| trace | formal 使用 strict trace failure mode；初始化、模型前证据、候选落库失败均向调用方抛出，不能降级为 shadow-only |
| candidate | 正式模型结果只有在 durable candidate 成功落库后才进入可采纳 UI；否则重置输出并终止 Run |
| adoption | UI 只调用 `adoptOutlineGenerationCandidateV1`，不再直接拆开 begin、业务表写入和 commit |
| concurrency | 单节点用 `baseSummary`、列表用 `baseExistingTitles` 做确认时 CAS；确认后并发修改会阻断覆盖 |
| recovery | 冻结 intent 后的中断按同一 Run 验证或补齐；已写条目不会重复，非冻结并发数据不会被吞掉 |
| terminal | formal acceptance 固定为 output、author confirmed、adoption committed、post-state matches，最终签发现有 outline terminal receipt |

## 3. 故障与反例证据

覆盖了以下确定性边界：

- trace 初始化、模型前证据、candidate persistence；
- 作者确认前、intent 后、CAS 前后；
- 业务写入进行中、业务写入后；
- adoption event 后、verification 进行中、terminal receipt 后；
- durable 开关关闭时，formal 在模型调用前拒绝，而 evaluation 仍可 shadow-only 且不可采纳；
- 40 轮“确认后业务写入前”和“部分业务写入后”刷新/中断恢复；
- 作者并发修改使初次 CAS 与后续 recovery 同时 fail-closed，正式表保留作者版本。

## 4. 验证收据

| 门禁 | 结果 |
|---|---|
| 扩展大纲/Harness/正文兼容回归 | 36 files / 199 tests passed |
| WEH-0B 核心 durable adapter | 38 / 38 passed |
| TypeScript | `npx tsc --noEmit` passed |
| 八项架构/注册表检查 | 全部 passed；`PROJECT_TABLES` 82 张表一致，AI 入口 12 files / 23 calls |
| ESLint | `npm run lint` passed，0 warnings |
| production build | `npm run build` passed，3940 modules transformed |
| patch hygiene | `git diff --check` passed |

测试中的 `装配失败`、`Skill binding 不相等` 和 `模型输出无法确定性解析` 日志均来自主动构造的阻断反例，相应用例通过，并非未处理失败。

## 5. 数据、兼容与回滚

- 不新增 Dexie 表，不改变三注册表业务字段或项目数据 schema。
- `AgentRunRecord.contractVersion` 扩展为 1/2/3；解析器继续严格读取既有 V1/V2，新的正式大纲 Run 写 V3。
- 旧 V1/V2 Run 不伪造 execution boundary；只有 V3 才能声称已冻结该证据。
- 若需回滚产品入口，应回到 WEH-0A 的 Skill-derived Run，但不得恢复 formal catch-and-warn。临时 shadow 仅允许显式 evaluation/simulation/experimental，并保持不可采纳。

## 6. 下一依赖

WEH-0C 需要在本链路前增加保存屏障和 content revision vector：所有正式生成必须先 flush 当前编辑，再从 IndexedDB 重读并冻结 revision；作者在生成后修改上游内容时，旧候选必须可证明地 stale。WEH-0B 的 CAS 只保护采纳目标，没有替代这一来源新鲜度合同。
