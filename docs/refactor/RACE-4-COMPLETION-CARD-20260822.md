# RACE-4 完成卡：保存、刷新、stale 与故障矩阵

日期：2026-08-22  
施工单元：RACE-4  
状态：完成（机械路径）

## 本单元新增收口

- durable 候选的采纳和拒绝现在显式带入当前 `worldGroupId`。
- 底层在恢复候选后核对“生成时世界组”与“当前世界组”；切换世界后，旧候选的采纳和拒绝都 fail-closed。
- 新增种族 canary 端到端故障测试：一次结构修复、exact raw evidence、费用记账、刷新恢复、stale、网络结果未知、候选写前故障、采纳写前/写后故障与幂等恢复。

## 场景矩阵与回归证据

| 场景 | 确定性证据 |
|---|---|
| 空项目、部分世界观、故事先写、角色先写/下游反推 | `R-RACE1-races-gateway-canary`、`R-HARNESS32-worldview-field-agent` |
| 补充说明、即时编辑后生成、保存失败阻断 | `R-RACE2-races-mode-length-contract`、`R-WEH0C-authoring-barrier`、`R-GATE-P1A-shadow-read` |
| 刷新、候选编辑、拒绝、采纳、并发 CAS | `R-RACE1-races-gateway-canary`、`R-WEH0D-candidate-draft-coordinator`、`R-WEH0D-master-candidate-sync-ui`、`R-HARNESS1-master-durable-orchestrator` |
| Canon 变更使旧候选 stale | `R-RACE4-races-fault-matrix`、`R-HARNESS32-worldview-field-agent`、`R-WEH0C-authoring-barrier` |
| 错字段、非法 JSON、结构修复失败、超长、取消 | `R-RACE4-races-fault-matrix`、`R-WEH0E-structured-output-execution`、`R-WEH0E-structured-output-pipeline`、`R-RACE2-races-mode-length-contract` |
| 超预算 | `R-RACE2-races-mode-length-contract`、既有 team-budget / bounded-replan 回归 |
| 网络结果未知 | `R-RACE4-races-fault-matrix`：零候选、零 Canon，运行保留失败证据 |
| context/candidate/adoption/terminal 故障 | `R-RACE4-races-fault-matrix`、`R-WEH0G-harness-observability`、`R-HARNESS1-master-durable-orchestrator` |
| 切换 World/Work/世界组和跨 scope 攻击 | `R-RACE4-races-fault-matrix`、`R-CTXG4-context-gateway-tools`、`R-CTXG5-context-selector` |

## 边界

- 本卡签收的是机械正确性：读到什么、修复几次、何时写入、中断后怎样恢复、是否跨 scope。
- “故事/角色与世界观的矛盾是否被模型正确理解”属非确定性质量，由 RACE-6 的多 trial transcript + outcome 评测签收，不用单次模拟响应冒充。
- LONGOUT-1 仍未开放；超过单次 effective cap 的请求在模型前明确拒绝。
