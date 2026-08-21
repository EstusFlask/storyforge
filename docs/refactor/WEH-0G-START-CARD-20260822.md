# WEH-0G 开工卡：Harness 证据可视化与故障门禁

## 本单元目标

把 Phase 0 已经存在但分散在上下文装配、候选事件和 durable Run ledger 中的真实证据，收口为作者可理解、测试可判定的 Harness 证据链；统一正式流程错误分类，并提供仅开发/测试可启用的标准故障注入适配器。

## 当前事实

- `assembleContext()` 已记录逐来源的 `full / compressed / truncated / none`、原始/实际 token 数和原始来源 SHA-256，但世界观、故事、角色及主 Agent 候选 UI 只展示来源名称与整段裁剪。
- 主 Agent durable Run 已持久化 `context.assembled`、`candidate.persisted`、`adoption.committed` 和 terminal verification receipt；候选 UI 没有把它们组织成“作者编辑已保存 → 上下文已冻结 → 候选已持久化 → 可采纳 → 终态已验证”的状态链。
- `failure-policy.ts` 已提供 Run 重试/重规划策略，但产品入口没有统一的 save、scope、context、budget、provider、parse、schema、gate、candidate、stale、adoption、terminal 分类。
- 现有 durable 测试可以依赖注入模拟部分故障，但还没有全流程共用、生产环境必定关闭的故障点适配器。

## 施工边界

1. 扩充逐来源证据的字符数，并保持原始来源哈希；不在本单元新增第二份上下文正文存储。
2. 新增共享证据面板，替换世界观、故事、角色和主 Agent 的手写证据摘要。
3. 候选持久化时冻结 Context Manifest hash；采纳完成后把 adoption hash 与 terminal receipt 作为结构化消息证据展示。
4. 新增统一错误分类器，并接入主 Agent 生成、候选同步、采纳及终态验证的错误事件。
5. 新增仅 `DEV / test` 可配置的内存故障注入点；生产构建和 UI 不提供任何开关或持久化入口。
6. 增加反例测试与架构守卫，最后运行 Phase 0 完整门禁。

## 明确不在本单元完成

- 原始上下文正文、压缩产物及引用片段的持久化和按需寻址属于 `MEMINT-0 / Phase 1A`，本单元只展示当前真实可验证的摘要、计数和哈希。
- 不新增正式业务表，不改变 `FIELD_REGISTRY` / `AdoptionSchema` 的写回语义。
- 不用模型判断故障类别或终态；分类与终验必须是确定性的。

## 完成判据

- 作者能从候选 UI 看见每个来源的交付状态、字符/token 前后数量、来源哈希、内容修订哈希、Context Manifest、候选哈希和五段生命周期。
- durable 采纳后的对话中能看见 adoption hash 与 terminal receipt；未完成的多候选 Run 不得伪装为终态完成。
- 十二类错误在相同输入下跨领域得到同一分类，并带稳定 fingerprint。
- 每个故障点在生产环境不可启用；关键边界故障不会造成未确认写入，已写入但回执中断的运行可通过 ledger 恢复/重验。
- 定向测试、架构/注册表/AI Manual 门禁、TypeScript、lint、build、完整 Vitest、`npm run ci` 及适用 E2E 通过。
