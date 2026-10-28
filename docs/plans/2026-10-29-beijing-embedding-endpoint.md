# 北京向量接口兼容修复

用户填写官方公共地址 `https://dashscope.aliyuncs.com/compatible-mode/v1` 时，被仅允许工作空间域名的校验拒绝。本次以最小兼容修复处理：保留原北京工作空间入口，同时精确允许北京公共主机，不自动迁移地址或模型。

## 官方依据与设计

[Embedding 官方文档](https://help.aliyun.com/zh/model-studio/embedding-interfaces-compatible-with-openai) 明确说明现有域名仍可使用，并列出 `qwen3.7-text-embedding-flash`。工作空间专属域名是推荐迁移地址。[地域文档](https://help.aliyun.com/zh/model-studio/regions/) 将 `dashscope.aliyuncs.com` 列为北京接入域名；旧入口用于存量兼容，自 2026-09-30 起不再支持新特性。

仅调整 `validate_embedding_url` 的主机允许列表。HTTPS、标准端口、固定 `/compatible-mode/v1` 路径、无 user info/query/fragment、拒绝占位符和海外域名等规则保持生效。地址变化仍要求重新输入密钥，实际 URL 继续参与索引命名空间，不假定不同地址下的向量可混用。Web 提示与占位地址同步修正；没有新增表、迁移、依赖或测试用例。

## 验证

- 真实 PostgreSQL 现有后端测试：51 passed；Ruff 通过。
- 现有完整 Web/API E2E：最终复验 1 passed（18.3s）；TypeScript、ESLint 通过。
- 独立 QA 账号真实设置 API：公共北京地址、合法北京工作空间格式保存均为 200；伪造后缀、新加坡入口与 HTTP 均为 422。工作空间格式保存成功不代表该示例工作空间真实存在。
- 使用独立无效 Key 对真实公共百炼入口调用，收到上游 401、应用 502。证明该地址已通过本地校验并到达供应商认证，不代表模型权限或有效向量调用成功；未保存这个无效 Key。
- 真实浏览器确认公共地址的说明、占位地址、表单输入与缺 Key 提示；原用户配置未保存或修改。[页面证据](../evidence/beijing-embedding-endpoint.png)。

有效 Qwen 向量调用仍待用户在设置页填入对应北京地域授权并检测；没有伪造向量或将认证失败冒充模型成功。
