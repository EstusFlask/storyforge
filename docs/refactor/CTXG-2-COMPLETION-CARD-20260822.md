# CTXG-2 完成卡：稳定资源身份、纯目录与 exact artifact 生命周期

## 签收结论

- 任务 ID：`CTXG-2`
- 状态：完成
- 基线：`3b8587a6`（`CTXG-1`）
- 完成边界：已完成 Context Gateway 的稳定资源身份与 exact Run evidence 物理层；尚未开放领域目录/读取工具，也尚未切换正式生成入口。

## 已交付能力

1. `PROJECT_TABLES.resourceIdentity` 成为资源身份唯一登记处；新建/采纳统一经 `stampNewRecord()` 盖 `res:v1:<kind>:<uuid>`，不再依赖项目 ID 或 Dexie 自增 ID。
2. 项目载入与导入使用显式、全事务、幂等 backfill；未知身份格式、项目内跨表重复 UID 或中途故障全部失败并回滚。
3. `buildRagLibrary()` 严格只读；缺 UID 时返回可诊断的 `identity-missing`，不再在目录读取时偷偷修库。
4. RAG policy 拥有独立 `revision/hash`；修改检索策略不改 Canon 正文、正文更新时间或资源 UID。
5. schema v63 新增并登记 `agentRunArtifacts`：按 `project + artifact kind + SHA-256` 去重保存 UTF-8 原文，Run 所有权只由追加事件表达。
6. artifact 正文写入与 `evidence.artifact.recorded` 在同一 Run 锁和 Dexie 事务内提交；正文失败不留引用，事件失败不留孤儿正文，重复调用幂等。
7. 导出/导入逐字验证 hash、byte length、安全边界与 prune receipt；损坏正文或密钥/隐藏推理使整个导入回滚。
8. Run 删除采用引用感知 mark-and-sweep：共享正文保留，最后引用消失后保留可验证 `evidence-pruned` tombstone；显式裁剪只允许所有引用 Run 已终结。
9. Memory Artifact Index 显示 `available / missing / corrupt / evidence-pruned`，不会把历史 hash 引用误报成仍可逐字读取。

## 关键反例证据

- 缺身份的 legacy 行不能进入目录；backfill 第二次写入数为 0，中途注入故障后所有 UID 写入回滚。
- 连续两次构建目录前后业务行序列化结果完全一致。
- 导出再导入保持资源 UID；伪造重复 UID 导入时项目根记录也不落库。
- 同一正文由两个 Run 引用时只存一份；删除第一个 Run 保留正文，删除最后一个 Run 后变为 tombstone。
- API key、Authorization、隐藏推理等内容无法进入 exact artifact；篡改正文无法导入。
- 策略连续更新只增加 policy revision/hash，Canon 时间戳与正文不变。

## 验证记录

- 定向回归：9 files / 54 tests，全绿（含 CTXG-2、RAG、World/Work scope、Flow、MEMINT、百万字内存验收、导入导出、schema、注册表）。
- 十项静态闸门：required tables、AI manual、AI entry registry、architecture、source reachability、roadmap、agent context、agent freshness、Canon coverage、project metrics 全绿。
- `npm run lint`：通过。
- `npx tsc --noEmit`：通过。
- `npm run build`：通过，3961 modules。
- `npm run check:bundle-size`：通过；entry 623.5 KiB / 186.2 KiB gzip，均未超过 700 / 230 KiB 预算。
- `git diff --check`：通过。

## 后续边界

- `CTXG-3` 开始实现注册表派生的领域 Provider 与 metadata-only catalog。
- 四个受策略约束的读取工具、sufficiency loop、Context Packet 持久化以及正式入口切换仍按后续单元推进。
- 本卡只证明物理身份和证据生命周期成立，不宣称 Phase 1A 或百万字完整创作链已经过门。
