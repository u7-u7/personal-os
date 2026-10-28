# 模型配置诊断 · 2026-10-29

## 实际功能

- 聊天和 Qwen 向量检测读取当前表单，不自动保存；原有空 body 的已保存配置调用仍兼容。
- 已配置聊天连接在设置页自动发现一次模型；草稿支持手动获取，主模型和两类路由模型支持选择，也保留手动输入。
- 官方 DeepSeek 使用真实 `/models` 和根路径 `/user/balance`。余额按币种分别展示字符串金额，不支持的供应商返回明确结果。
- 省略密钥只在地址未改变时复用服务端凭据；更换地址不能携带旧密钥。密钥不进入缓存键、mutation variables、返回值或审计。
- 诊断有账户隔离、配置版本校验、20 秒总期限、无重试/重定向和脱敏审计；任何成功回执仅证明对应的调用。
- 模型列表及余额响应在 SDK JSON 解析前限制 1 MiB；请求未压缩内容，拒绝意外压缩响应，避免第三方返回超大数据。补上此限制后，真实 DeepSeek 模型/余额再次均返回 200；大小与压缩拒绝分支本次仅代码审阅，未新增测试用例。

## 验证证据

当前用户已保存的 DeepSeek 配置通过应用 API 完成真实授权验收；未读取、打印或复制明文密钥，未改写该用户的配置。以下均非模拟响应。

| 验证 | 结果 |
| --- | --- |
| 真实模型列表 | 200，返回 `deepseek-flash`、`deepseek-v4-pro` |
| 真实余额 | 200，支持查询、CNY 明细；公开证据省略实际余额 |
| 最小固定文本聊天 | 200，返回非空真实文本 |
| 未保存的无效模型 | 502，上游 HTTP 400；已保存模型未改变 |
| 未保存的无效 Key | 502，明确供应商认证失败；应用登录未失效 |
| 过期配置版本 | 409，拒绝使用过期草稿 |
| 换 `/v1` 地址且省略 Key | 503，禁止复用原地址的已保存 Key |
| 非 DeepSeek 官方地址查询余额 | 200、`supported:false`，不查询该供应商 |
| 缺向量地址/Key | 503，明确缺配置 |

真实浏览器验证自动加载两个模型、主模型选择保留列表并清除原推理回执、连接成功、真实余额展示、换地址清除原结果且缺密钥时拒绝调用。手机宽度 390px 的 DOM `clientWidth` 和 `scrollWidth` 均为 390，按钮正常换行。截图不含密钥与实际余额：[桌面](../evidence/provider-diagnostics.png)、[手机](../evidence/provider-diagnostics-mobile.png)。

现有检查：PostgreSQL 后端 **51 passed**；完整 Web/API Playwright **1 passed（18.7s）**；TypeScript、ESLint、Ruff 和生产构建通过。按用户要求未新增或修改测试用例；E2E 使用原有测试，向量字段未编辑时保留“测试已保存连接”语义，编辑后切换为“测试当前配置”。

## 保留边界

本次只确认模型发现、余额和最小非流式推理，不代替完整 Agent 流式、工具调用、长期记忆提取及简报质量验收。Qwen 还缺真实北京工作空间地址/授权；Hy-Memory/Jev、Google OAuth 和受控第三方 MCP 的原有验收门槛继续保留。运行中的开发实例与 Docker 实例使用独立数据库和账号，不复制用户或凭据。

官方依据：[DeepSeek 模型接口](https://api-docs.deepseek.com/api/list-models/)、[余额接口](https://api-docs.deepseek.com/api/get-user-balance/)、[错误码](https://api-docs.deepseek.com/quick_start/error_codes/)、[固定版本 OpenAI SDK 自定义请求](https://github.com/openai/openai-python/tree/v2.54.0#making-customundocumented-requests)。
