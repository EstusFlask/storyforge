# RACE-6 完成卡：种族与民族 Gateway 真实金切片

日期：2026-08-23  
施工单元：`RACE-6`  
状态：完成

## 结论

`worldviews.races` 已通过 Context Gateway required canary 的真实模型验收。sealed V21 固定 100 个
fixture，使用 `agnes/agnes-2.5-flash` 生成、`deepseek/deepseek-v4-flash` 跨 provider 独立盲评，
完成 100/100 且 `score.passed=true`。这证明金切片的读取、生成、候选、恢复、作者确认、scope、CAS
与错误证据闭环可用；它不等同于全部世界观字段或百万字长篇已经通过。

## 冻结真实证据

- checkpoint：`d2f7a083a002f4f6592ffcf97f16c99ae4fa09a0c3a64cf9ace290197061821e`
- checkpoint key / grader prompt：`storyforge-races-gateway-eval-v21` / `races-gateway-blind-grader-v21`
- 80 次正式生成、50 次独立盲评、20 次确定性攻击；攻击 fixture 复用已生成候选。
- 空态占位率 0%，标题过锚率 0%，具体设定率 100%。
- 部分态约束遵守率 95%，新增有效信息率 100%。
- 末位证据 recall@20 100%，送达后实际使用率 100%，自动选择不超过 task policy 硬门。
- Mandatory 送达率 100%，语义事实保留率 100%。
- 双版本候选交付率 100%，跨 scope 泄漏率 0%，CAS stale 阻断率 100%。
- generator provider 失败 0，产品 non-provider 失败 0。grader 曾有 4 次空/非法 JSON；每次 raw
  evidence 均进入失败账本，只有作者可见续跑，没有隐藏重试，最终 50 个盲评样本均闭合。

## 真实运行中修复的问题

1. Provider 目录、模型别名、base URL、上下文窗口与 proxy endpoint 更新为当前受验证配置；generator
   与 grader 必须来自两个已保存预设，运行开始后模型配置冻结，不受全局设置切换影响。
2. 统一 Prompt transport 合并为唯一 system envelope；NVIDIA strict JSON schema、provider 错误阶段、
   quota/authorization/rate-limit 和 grader 失败分栏进入相同证据合同。
3. 结构化输出只做可证明无损的确定性归一化：数组字符串安全逗号、对象尾部、根字段过度转义和正文
   内部引号；结构性尾巴仍拒绝。原文、归一化结果和 step registry 均留证。
4. V20 揭示字符子串不能代表创作事实保留。V21 只在 eval 中用独立 grader 判断 pinned 事实语义；
   生产扩写/润色继续向作者展示前后两版，不新增会替作者裁决文学事实的运行时硬验证器。
5. 末位命名实体仍用精确名称判定，因为该项验证的是检索到的明确实体是否真正进入结果，而不是文风。

## 三注册表与生命周期边界

- 读取只经 `CONTEXT_SOURCES`、Context Gateway selector/manifest/trace 和受治理追加读取。
- 正式写入仍只经 `FIELD_REGISTRY`、`AdoptionSchema`、`adopt()`；候选、盲评和失败证据不直写 Canon。
- fixture 与 checkpoint 清理由 `PROJECT_TABLES` 派生的项目生命周期执行；跨 Project/Work/WorldGroup
  攻击不能泄漏或改写数据。
- 旧版本 checkpoint key 只读保留，V21 不续接或篡改 V1～V20 证据。

## 验证

- 完整 `npm run ci`：464 files / 2214 tests；覆盖率 83.27% statements、73.82% branches、
  81.27% functions；依赖审计 0 漏洞；TypeScript、架构、必需表、AI 手册、build 与 bundle gate 通过。
- `PLAYWRIGHT_PORT=4198 npm run ci:e2e`：隔离 Chromium 53/53 通过（4.8 分钟）。
- E2E 覆盖候选生成、刷新恢复、编辑、拒绝、采纳、跨 scope、stale/CAS、导入导出和本地记忆工作区。
- checkpoint 已通过可见 UI 导出；证据不含 API Key、认证头或隐藏推理。

## 下一步边界

RACE-6 只授权进入 `GATE-P1B` 签收和 Phase 2。其它 worldview/story/character/outline 字段必须逐一由
注册表派生目标、复用相同 Run Contract 和完成相应回归，不能把 races 的特判复制成新的手写清单。
