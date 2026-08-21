# GATE-P1A 开工卡：Context Gateway Phase 1A 总验收

## 任务与完成边界

- 任务 ID：`GATE-P1A`
- 基线：`52fa227f feat(CTXG-8): cache and retrieve long-form context`
- 目标：以机器可执行 shadow read 和完整阶段门证明 G1～G5、零副作用、跨 scope 隔离、Trace 可解释性与性能；通过前不切换任何正式业务字段。
- 非范围：本门不生成或采纳 races 候选，不调用创作模型，不把 `world-origin.worldview-field` 从 `shadow` 提升为 `required`。

## 门禁映射

| 审查目标 | 当前实现 | 本门证据 |
|---|---|---|
| G1 纯读取目录 | CTXG-2/3/8 | 重复目录 DB 零变化、portable identity、metadata 无 body、缓存失效 |
| G2 Canon 描述器 | CTXG-3 | 六领域、嵌套 stage/scene、world link、末位资源、scope/authority/revision/source ref |
| G3 四个只读工具 | CTXG-4/7 | 唯一 Tool Registry、双 transport allowlist、伪造/越权/超预算/删除反例 |
| G4 Context Gateway | CTXG-5/7/8 | Mandatory Core、分类配额、关系/时间扩展、快慢路径、长篇候选与 Canon fallback |
| G5 Retrieval Trace | CTXG-6/7 | V3 Manifest、exact artifacts、query/decision/depth/omission/source ref 与 freshness |

## 施工与验收

1. 新增只读 shadow compare：同一冻结 scope 对旧 `assembleContext` 和新 Gateway 确定性路径各读一次，只返回内存报告；追加规划模型调用固定为 0，不写 candidate/Canon/Run/Artifact。
2. 报告记录旧 source evidence、Gateway selected/omitted/source refs、sufficiency、trace/packet hash 和差异 reason code；数据在比较期间变化则整次作废。
3. 测试同项目跨 world group、跨 project/work 不泄漏；比较前后 `PROJECT_TABLES` 快照完全相同。
4. 运行 Phase 1A 全回归、完整 `npm run ci`、`npm run ci:e2e`、隔离浏览器 smoke 与 bundle 门。
5. 任一正式入口被意外切为 required、shadow 触发模型/写入、scope 泄漏、旧值命中、Trace 不可回读或完整 CI 失败时，本门失败并停止进入 Phase 1B。
