# OUTLET-1 完成卡：WorldRelease 到可运行世界

> 状态：IMPLEMENTED / VERIFIED
> 完成日期：2026-08-21
> 合同：[OUTLET-1 ADR](../adr/OUTLET-1-PLAYABLE-WORLD-BUNDLE.md)
> 上位计划：[游戏平台总施工方案](../GAME-PLATFORM-MASTER-CONSTRUCTION-PLAN-20260821.md)

## 完成边界

本单元已把不可变 `WorldReleaseManifestV2.records` 的真实内容接入运行时，不再只生成依赖表审计条目：

- 新增 `PlayableWorldBundleV1`、编译器版本、结构化 diagnostics 和 bundle hash；
- 映射世界根、表依赖、世界观、世界规则、力量体系、叙事模块；
- 映射角色、地点、人工器物、势力为 Canon 来源与运行时实体；
- 将便携角色关系解析为稳定 sourceKey 引用；
- 0-based portable identity 只进入 sourceKey，`recordId` 保持 null；
- 唯一地点名称可解析为角色 `locationKey`；缺失、同名、悬空和重复身份显式诊断；
- `createWorldInstance()` 在未显式传入状态时采用发布 bundle，再叠加冻结叙事/产品状态；
- error diagnostics 阻断发布世界进入运行时，warning 允许兼容降级；
- 旧 Canon-only builder 保留为 bundle 的兼容包装器；旧会话不迁移、不重算。

## 三注册表结论

- AI 读取：本单元不调用 AI，不新增 `CONTEXT_SOURCES`。
- AI 写入：本单元不生成或采纳作者 Canon，不新增 `FIELD_REGISTRY` / `AdoptionSchema`。
- 表生命周期：bundle 为纯派生值，不新增表；Session/Release 生命周期继续从现有 `PROJECT_TABLES` 派生。

## 证据

新增回归 `R-OUTLET1-playable-world-bundle.test.ts` 覆盖：

1. portable records → character/location/item/faction/relation；
2. 同输入重复编译与双层 hash 验证；
3. Canon parser 接受 0-based 便携来源；
4. 同名地点、悬空关系、重复 sourceKey 反例；
5. 真实 WorldRelease → TTRPG Session；
6. 删除草稿后仍从冻结发布恢复；
7. Session 分支与完整项目导出/导入后实体、Canon hash 不变。

验证结果：

- 定向 OUTLET/SIM/WORLD 回归：3 files / 9 tests passed；
- 完整 coverage：438 files / 2053 tests passed；
- 覆盖率：statements 83.64%、branches 73.75%、functions 81.61%、lines 83.64%；
- `check:required-tables`、`check:ai-manual`、`check:ai-entry-registry`、`check:architecture`、
  `check:source-reachability`、`check:roadmap`、`check:agent-context`、`check:agent-freshness`、
  `check:canon-coverage`、`check:project-metrics`、生产依赖审计均通过；
- 改动文件定向 ESLint 与 `tsc --noEmit` 通过；
- 生产 build 与 bundle size 通过。

完整 `npm run ci` 未宣称全绿：它在 ESLint 扫描用户工作区中未跟踪的
`docs/pitch/build-roadshow-html.mjs` / `build-roadshow-ppt.mjs` 时，被 `URL/process/console no-undef`
阻断。这两份脚本不属于 OUTLET-1，未擅自修改。此前一次把五个游戏投影测试并行运行时，AVG 单测达到 30 秒
超时；该用例单独复跑通过，并在完整 2053 测试中再次通过。

## 迁移、回滚与可见性

- DB migration：无。
- 数据重写：无。
- 回滚：恢复旧 Canon wrapper 和 instance fallback 即可；已创建会话保持可读。
- feature flag：无新增用户入口，属于默认不可见的内部派生/适配层，因此没有可被误开放的半成品 UI。
- 真实 UI：本单元没有新 UI；玩家/GM 体验验证归下一阶段 RuntimePackage/Preview 和 TTRPG 产品入口。

## 已知边界与下一依赖

`PlayableWorldBundleV1` 只归一化世界语义，不猜测 HP、AC、DC、技能、行动经济或成长数值。现有 legacy TTRPG
仍保留原兼容默认值；正式 TTRPG GameRelease 必须等待 RulePack/CampaignPack 编译门，缺少 required 数值时阻断发布。

下一施工入口：`GAME-PROD-1 A0` 的 `GameRuntimePackageV2 + GameReleaseManifestV2 + PlayableGameSource`，随后才落
生产六表和 Preview。
