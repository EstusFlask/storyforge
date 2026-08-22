# GATE-P1B 开工卡：“种族与民族”金标准切片总验收

日期：2026-08-22  
任务 ID：`GATE-P1B`  
隔离分支：`refactor/world-engine-harness`  
基线：`bd722008 test(E2E): edit structured worldview value only`  
状态：机械门已通过；凭据已按授权复制且连接测试成功；V1 失败已归档，等待 V2 sealed run

## 1. 完成边界

本门只在以下证据同时成立时通过：

1. `worldviews.races` 已作为唯一正式 Context Gateway canary 运行，无旧上下文旁路、双读或双写。
2. RACE-6 固定 100 场景全部执行，checkpoint 验签成功，所有冻结阈值通过。
3. generator 与 blind grader 使用不同模型身份；模型、provider、grader prompt version 已写入 checkpoint。
4. 真实浏览器完成生成、刷新恢复、候选编辑、拒绝、采纳、切世界、跨 scope 和 stale/CAS 路径。
5. 完整 CI、E2E、生产构建、bundle 与架构门均通过。
6. 签名 checkpoint 已导出并保存；API Key、认证头和隐藏推理均不得进入证据。

任一项缺失都不得把 RACE-6 或 GATE-P1B 标成完成，也不得进入 Phase 2。

## 2. 已闭合的机械证据

| 证据 | 当前结果 |
|---|---|
| RACE-1～5 实现 | 提交 `4e6b1bae`、`bf552116`、`c709af16`、`d5aa9b49`、`9cf4d1b8` |
| RACE-6 Harness | 提交 `88432a28`；100 个冻结 fixture、80 次生成、40 次盲评、20 次确定性攻击 |
| Phase gate 回归修复 | 提交 `17447e1d`；自动资源硬上限、V2 selector policy、author-edit canonical hash、bundle 拆分 |
| 真实结构化 UI E2E 修复 | 提交 `bd722008`；value-only 编辑器不再写入外层 wrapper |
| 完整 CI | 463 files / 2199 tests；依赖 0 漏洞；lint、TypeScript、build、bundle gate 全通过 |
| 完整 E2E | 隔离 Chromium 53/53 通过 |
| 生命周期 | checkpoint 每例签名落盘；项目清理由 `PROJECT_TABLES` 派生的 `cascadeDeleteProject()` 完成 |

以上只能证明 Harness 编排与机械不变量，不能替代真实生成质量结果。

## 3. 冻结真实运行配置

| 项目 | 冻结值 |
|---|---|
| 隔离 origin | `http://127.0.0.1:4197/storyforge/` |
| generator | `agnes/agnes-2.5-flash`（从正式 `agent.world-foundation.worldview-field` 路由解析） |
| blind grader | `agnes/agnes-2.0-flash`（从 `eval.race6.blind-grader` 路由解析） |
| grader temperature | `0` |
| grader max tokens | `4096`（V2；为兼容推理型 provider 的完成预算，不改变评分阈值） |
| 单次 grader timeout | `180000 ms` |
| checkpoint key | `storyforge-races-gateway-eval-v2` |
| fixture / thresholds | 见 `RACE-6-EVAL-PROTOCOL-20260822.md`；真实结果出现后不得下调 |

如果隔离环境无法使用上述模型身份，必须在运行前修订并重新冻结协议；不能在看到结果后换模型、改 fixture 或降低阈值来伪造通过。

## 4. 执行步骤

1. 用户明确确认后，仅通过设置 UI 把 4178 origin 中已配置的凭据复制到 4197 origin；不读取、不记录、不输出明文。
2. 在 4197 设置页确认 generator/provider/base URL 可用，并选择不同身份的 blind grader。
3. 确认当前不存在旧 RACE-6 checkpoint；若存在，先导出，再通过 UI 显式清理。
4. 点击“运行冻结矩阵”。运行中每例必须先持久化并签名，再清理可释放的隔离项目。
5. 网络中断或页面刷新后，只从验签成功且模型身份完全一致的 checkpoint 继续；不得跳过失败样本。
6. 完成后先导出 `race6-<hash>.json`，再核对 100/100、`status=completed`、`score.passed=true` 和全部分项指标。
7. 在同一隔离 origin 执行用户路径 smoke：生成 → 刷新 → 编辑/拒绝/采纳 → 手改 Canon 触发 stale → 切世界/Work → 错误恢复。
8. 重新运行 `npm run ci`、`PLAYWRIGHT_PORT=<isolated-port> npm run ci:e2e` 和 `git diff --check`。
9. 建立完成卡，记录 checkpoint hash、模型身份、各指标、失败/修复迭代、CI/E2E 证据；不记录凭据。

## 5. 结果回执（运行后填写）

| 字段 | 结果 |
|---|---|
| 运行时间 | 待执行 |
| checkpoint hash | 待执行 |
| generator / grader | 待执行 |
| 完成样本 | 待执行 |
| 空态占位 / 标题过锚 / 具体设定 | 待执行 |
| 部分态约束 / 新增信息 | 待执行 |
| 末位 recall@20 / 实际使用 | 待执行 |
| Mandatory 送达 / 保留 | 待执行 |
| scope 泄漏 / 对比交付 / CAS 阻断 | 待执行 |
| 总判定 | **未执行，门未通过** |

### V1 失败运行

- checkpoint：`c87e831fac1d73442424486ecbb0efa2ab6ca0ef06369d69c82b3c1bf944e552`
- 进度：`1/100`，失败样本 `empty-02`
- 原因：blind grader 返回 `finish_reason=length`，V1 在检查严格 JSON 完成性之前直接判截断。
- 处置：保留 V1 失败证据；建立 V2 新 checkpoint key，不续接、不篡改 V1；阈值与 fixture 均未下调。

## 6. 凭据与连接回执

- 用户已在动作时明确确认把 4178 origin 的既有凭据复制到 4197 origin 并调用。
- 复制只经两个设置页和浏览器安全剪贴板桥接完成；未读取 localStorage，未在工具输出、日志或文档中暴露明文。
- 4197 使用 session-only API Key，未勾选持久保存。
- `agnes/agnes-2.5-flash` 连接测试返回 HTTP 200，耗时 911 ms。
