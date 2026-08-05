# PLATFORM-1 · 本地世界发布包

## 交付边界

本阶段把“世界可以被别人引用”落成一个不依赖服务器的本地闭环：作者在世界引擎页生成 JSON 发布包，接收方读取包的发布信息和完整性校验，确认后导入为新的本地世界项目。原项目不覆盖，导入副本拥有新的本地 `worldCode`，并通过 `communityOrigin` 保留来源编号、版本、署名和许可。

这不是线上社区，也不提供账号、云同步、评论、协同编辑、发现排序或访问控制。浏览器不会因为导入一个文件就假装它已经发布到平台。

## 数据契约

`PROJECT_TABLES` 新增 `communityShare: 'world'` 元数据。世界发布范围只从这一个注册表声明派生，当前包含：

- 世界组、世界组关系、世界观、地理、历史、世界节点、世界规则、力量/修炼体系。
- 重要地点、Codex 分类与词条、角色及角色关系。

未登记的可导出表默认禁止进入发布包，尤其是 `chapters`、`outlineNodes`、`notes`、`agentConversations`、`agentEvents`、`nodeFlows`、`nodeRuns`、`simulationSessions`、`simulationEvents`、`simulationCheckpoints`、`references`、`userStyleProfiles` 和 AI 用量记录。发布包也不携带 API Key 或 PAT。

## 发布与导入流程

```text
世界引擎
  -> exportProjectJSON（现有注册表导出）
  -> communityShare='world' 过滤 + 去除写作状态
  -> manifest（编号/版本/署名/许可/用途/内容警告）
  -> SHA-256
  -> 本地 JSON 文件

本地 JSON
  -> 格式/版本/世界表/私有表预检
  -> SHA-256 完整性检查
  -> 作者确认
  -> importProjectJSON（现有注册表导入事务）
  -> 新 worldCode + communityOrigin
```

`inspectWorldPackage()` 是纯只读检查；任何错误都在 `importProjectJSON()` 写库前返回。导入仍由现有三注册表生命周期负责，不新增分享包表、旁路数据库或第二套导入器。

## 后续线上阶段的前置条件

真正的社区服务必须另立后端边界：身份与设备密钥、发布版本不可变存储、权限/撤回、内容举报与审核、隐私删除、增量同步冲突、评论与通知。客户端只能提交经过作者确认的发布包和明确的可见性策略，不能把本地 Gist、任意 URL 或 OAuth 登录态当成社区后端。任何远程读取/写入都必须有来源、域名白名单、取消/超时、审计和失败回滚设计。

当前可验收证据：`R-PLATFORM1-world-package` 覆盖私有表不泄漏、篡改拒绝、新编号导入与来源保留；Chromium 覆盖真实下载、预检、确认导入和页面刷新后的副本显示。
