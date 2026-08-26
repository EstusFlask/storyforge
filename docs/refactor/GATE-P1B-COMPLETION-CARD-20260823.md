# GATE-P1B 完成卡：“种族与民族”金标准切片总验收

日期：2026-08-23  
任务：`GATE-P1B`  
状态：通过；允许进入 Phase 2 `WE-1`

## 门禁结论

RACE-1～RACE-6 的代码、真实模型矩阵、隔离浏览器和完整仓库门禁同时闭合。`worldviews.races`
是当前唯一已用 sealed 真实模型矩阵证明的 Context Gateway required 世界观字段；本门没有把其它字段
批量宣称为可用，也没有宣称百万字长篇能力已经通过。

## 六项签收证据

1. `worldviews.races` 正式生成只经注册 Skill、Prompt、durable Run Contract、Context Gateway 与统一
   CreativeArtifact；旧手拼来源旁路不参与执行。
2. V21 100/100 完成，checkpoint
   `d2f7a083a002f4f6592ffcf97f16c99ae4fa09a0c3a64cf9ace290197061821e` 验签，所有冻结阈值通过。
3. generator `agnes/agnes-2.5-flash` 与 grader `deepseek/deepseek-v4-flash` 跨 provider；模型身份、
   prompt version、preflight、usage、finish reason、hash 与失败账本进入 checkpoint。
4. 隔离 Chromium 53/53 通过生成、恢复、编辑、拒绝、采纳、世界/作品隔离、scope 攻击、CAS stale、
   导入导出和错误恢复。
5. 完整 CI 464 files / 2214 tests，0 生产依赖漏洞；架构、三注册表、AI 手册、TypeScript、coverage、
   production build 与 bundle gate 全部通过。
6. checkpoint 已由可见 UI 导出；任何证据均不保存 API Key、认证头或隐藏推理。

## 失败没有被抹掉

- V1～V20 的额度、超时、provider、结构化输出和评测判据失败均保留在历史 key/文档中；V21 没有续接
  不兼容 checkpoint，也没有在看到结果后降低质量阈值。
- V21 的 4 次 grader JSON 失败进入独立账本并显式续跑；产品 non-provider 失败仍为 0。
- 首轮全量 E2E 52/53，唯一失败是测试写死 DeepSeek 历史模型标签。测试改为按作者创建的预设 ID
  验证路由，定向用例通过后再次执行全套，最终 53/53、退出码 0。

## Phase 2 开工约束

Phase 2 从 `WE-1` 开始，以注册表派生方式把同一 Harness 推广到世界观现有可生成字段；禁止复制
`races` 的手写 target/source 清单。每个领域都要保持：候选先于 Canon、刷新可恢复、作者确认后才
`adopt()`、scope/CAS fail-closed、表生命周期由 `PROJECT_TABLES` 派生。`STORY-1`、`CHAR-1`、
`MW-1`、`CODEX-1` 只能在 `WE-1` 的派生合同与反例门可复用后继续。
