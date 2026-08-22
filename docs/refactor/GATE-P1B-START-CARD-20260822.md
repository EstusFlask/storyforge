# GATE-P1B 开工卡：“种族与民族”金标准切片总验收

日期：2026-08-22  
任务 ID：`GATE-P1B`  
隔离分支：`refactor/world-engine-harness`  
基线：`bd722008 test(E2E): edit structured worldview value only`  
状态：机械门已通过；凭据已按授权复制且连接测试成功；V1～V10 失败已归档，等待 V11 sealed run

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
| blind grader | `agnes/agnes-2.5-pro`（V11；由实时 `/v1/models` 目录确认，与 generator 身份不同） |
| grader temperature | `0` |
| grader max tokens | `4096`（V2；为兼容推理型 provider 的完成预算，不改变评分阈值） |
| 单次 grader timeout | `600000 ms`（V11；等待预算，不改变输出 token 或质量阈值） |
| checkpoint key | `storyforge-races-gateway-eval-v11` |
| grader schema preflight | 矩阵前 1 次；严格闭集 JSON；证据写入 checkpoint，不参与质量计分 |
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

### V2 失败运行

- checkpoint：`c9fda3db4cded9b88b1e65dae4bb2788203b31a53651eb4c76a9cfed2517553f`
- 进度：`0/100`，失败样本 `empty-01`
- 原因：`Agnes 2.0 Flash` 在 4096-token JSON-object 请求中仍返回截断的非法 JSON。
- 处置：不重试、不续接、不查看或改动质量阈值；建立 V3，撤销 Agnes provider 级 JSON-object 过宽声明，改用 `Agnes 1.5 Flash` 独立 grader，并先执行 schema preflight。

### V3 预检失败

- checkpoint：无；preflight 在创建 fixture 前失败。
- 原因：Agnes 返回 `model_not_found`，`agnes-1.5-flash` 当前无可用 distributor。
- 处置：新增 dev-only 实时模型目录发现；`/v1/models` 返回 8 个模型，其中稳定文本评审模型为 `agnes-2.5-pro`；V4 采用该模型，未使用 alpha、未生成样本、未改阈值。

### V4 失败运行

- checkpoint：`b476e759c58a0e812373b1a3a21192a22e9da8b52fc35b08564da425bb7922e5`
- 进度：`2/100`，失败样本 `empty-03`；grader schema preflight 已通过。
- 原因：generator 被路由到严格上游后返回 `System message must be at the beginning.`。正式 Prompt
  执行请求同时发送了作者模板 system 和 Harness hard system；部分上游接受，严格上游拒绝。
- 处置：保留 V4 失败 checkpoint；V5 在统一 Prompt 执行层把全部 system 内容合并为唯一首条
  system envelope，精确合并请求仍写入 hash 和 transcript；未更换模型、fixture 或质量阈值。

### V5 失败运行

- checkpoint：`7bca20b96e66fe3d0feb51ff757184c50b4c1ecd3e1f12a6df7ff3a516b4af5e`
- 进度：`0/100`，失败样本 `empty-01`；grader preflight 27.666 秒成功，`finish_reason=stop`。
- 原因：样本总耗时 190.451 秒，错误为 `signal is aborted without reason`；结合 grader 的 180 秒
  唯一超时控制器，定位为首例 blind grade 超时。system envelope 已通过 generator 调用。
- 处置：V6 将单次 grader 等待预算冻结为 600 秒，并显式分类超时；同时在 blind grade 前归档
  generator 候选、manifest 和 transcript，防止 grader 故障抹掉已成功的生成证据。模型、fixture、
  输出 token 上限与质量阈值均未改变。

### V6 失败运行

- checkpoint：`9603d86bc197e07b36b2c7c567f3d252c1602d25faa804a70340b1e6dbbf7ccd`
- 进度：`2/100`，失败样本 `empty-03`；前两例及各自盲评均完成。
- 原因：Agnes 上游返回 HTTP 500 `do_request_failed`，属于外部传输失败，不是质量判定。
- 处置：V7 新增签名 `attemptFailures` ledger；显式继续时保留失败尝试、错误、耗时和已有 transcript，
  不再由 results 切片抹掉历史。仍不做隐藏重试，模型、fixture、Prompt 判据和质量阈值均未改变。

### V7 失败运行

- checkpoint：`2f2c336bfba0795eaaf69a32de4f62eda4c0cd5cc7315b95f62c275c7f59a42e`
- 进度：`3/100`，失败样本 `empty-04`；失败尝试账本为 1。
- 原因：正式 generator 的首次结构化输出和唯一一次定向修复均未通过 schema；Harness 正确停止。
- 处置：V8 在 durable pause 前把结构化失败记为 `model.responded` 与 exact `raw-response`，并将
  preflight artifacts 和两次原始输出归档为 version 2 failure transcript。sealed score 新增
  “非 Provider 失败尝试=0”硬门，结构/解析/权限/scope 等失败不能被显式重跑洗掉；Provider 瞬时故障
  保留但单独计数。模型、fixture 与既有创作质量阈值均未改变。

### V8 失败运行

- checkpoint：`7360e3e0ee0f116fedccef875eda7d54b803f6f0a87f426bab1fa96d0dc57294`
- 进度：`26/100`，失败样本 `partial-07`；此前 20 个空态与 6 个部分世界观样本完成。
- 原因：generator、候选与 Context transcript 已成功；blind grader 返回 `finish_reason=length` 且 JSON
  不完整。该故障属于评测器，不应误算为 StoryForge generator 的非 Provider 失败。
- 处置：V9 为失败证据冻结 `generation / grader / attack` 阶段；grader 失败保存原始输出、parse error、
  finish reason、tokens、耗时与 hash，并单独统计显式重跑次数。产品质量阈值、模型与 fixture 未改变。

### V9 失败运行

- checkpoint：`eced7d0d08b1612ab10db21b980c68b2ba8e3e07e28378339526d1b182f19ba1`
- 进度：`2/100`，失败样本 `empty-03`；失败阶段为 `generation`，非 Provider 尝试为 1。
- 原因：首次候选因正文引号未转义而不是合法 JSON；唯一修复调用保留了全部内容，却错误增加
  `worldviews[]` 外层。失败 transcript 显示修复器只收到 schemaId、target 和错误，没有根合同结构。
- 处置：V10 把实际结构合同派生为最小 `contractShape`（根类型、允许根字段、必填根字段）并随 exact
  evidence 保存、向唯一修复调用披露；不重放完整项目上下文、不加第三次调用。模型、fixture 与阈值不变。

### V10 失败运行

- checkpoint：`3b7c314b656771793d07c32324794221b6ae6829c41786e0fe042cc4804fa999`
- 进度：`0/100`，失败样本 `empty-01`；失败阶段为 `generation`，非 Provider 尝试为 1。
- 原因：根合同已正确披露，第二次调用仍逐字复述含未转义正文引号的非法 JSON。该错误是纯 JSON
  lexical escaping，不应依赖模型再次理解。
- 处置：V11 增加确定性引号转义提案，并只接受“插入反斜杠、其余每个字符完全相同”的无损变换；
  截断补全、括号修补、字段或正文改写仍拒绝。原文和规范化文本均留证，schema 与质量阈值未放宽。

## 6. 凭据与连接回执

- 用户已在动作时明确确认把 4178 origin 的既有凭据复制到 4197 origin 并调用。
- 复制只经两个设置页和浏览器安全剪贴板桥接完成；未读取 localStorage，未在工具输出、日志或文档中暴露明文。
- 4197 使用 session-only API Key，未勾选持久保存。
- `agnes/agnes-2.5-flash` 连接测试返回 HTTP 200，耗时 911 ms。
