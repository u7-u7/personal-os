export const configurationMessages: Record<string, string> = {
  "Qwen3.7 Embedding turns text into memory retrieval vectors. Choose the standard or Flash model with an official Beijing endpoint and a separate embedding API key. Chat remains available without embeddings.":
    "Qwen3.7 Embedding 将文字转换为记忆检索向量，可选择标准版或 Flash，使用官方北京接口与独立 API 密钥。尚未配置不会阻止聊天。",
  "Choose qwen3.7-text-embedding or qwen3.7-text-embedding-flash":
    "请选择 qwen3.7-text-embedding 或 qwen3.7-text-embedding-flash。",
  "qwen3.7-text-embedding supports 2560, 2048, 1536, 1024, 768, 512, 256 dimensions":
    "qwen3.7-text-embedding 支持 2560、2048、1536、1024、768、512、256 维。",
  "qwen3.7-text-embedding-flash supports 1024, 768, 512, 256 dimensions":
    "Flash 模型支持 1024、768、512、256 维。",
  "Qwen3.7 Embedding requires an official Beijing endpoint":
    "Qwen3.7 Embedding 需要官方北京接口，可使用公共域名或北京工作空间专属域名。",
  "Add a Beijing workspace Base URL or the official Beijing public endpoint, and a separate Bailian embedding API key in Settings":
    "请在设置页填写官方北京接口地址和独立的百炼向量 API 密钥。",
  "Qwen3.7 Embedding Flash turns text into memory retrieval vectors. Use an official Beijing Model Studio endpoint and a separate embedding API key. Chat remains available without embeddings.":
    "Qwen3.7 Embedding Flash 将文字转换为记忆检索向量，使用百炼官方北京接口与独立的向量 API 密钥。尚未配置不会阻止聊天。",
  "Beijing embedding base URL": "北京向量接口地址",
  "Beijing Base URL · Separate API key": "北京接口地址 · 独立 API 密钥",
  "Both the Beijing public endpoint and your Beijing workspace-specific compatible-mode/v1 URL are supported. Workspace endpoints are recommended; model access still depends on your API key.":
    "支持下方北京公共接口，也支持北京工作空间专属的 compatible-mode/v1 地址。推荐使用工作空间专属接口；模型能否调用仍取决于 API 密钥的权限。",
  "Enter your Beijing Model Studio API key": "填写百炼北京地域的 API 密钥",
  "Use an official Beijing compatible-mode/v1 Base URL from Model Studio":
    "请使用百炼官方北京地域的 compatible-mode/v1 接口地址。",
  "Qwen3.7 Embedding Flash requires an official Beijing endpoint":
    "Qwen3.7 Embedding Flash 需要官方北京接口：可填写 dashscope.aliyuncs.com 或北京工作空间专属域名。",
  "Provider returned unsupported response compression":
    "供应商未按要求返回未压缩响应，无法安全读取；请检查接口兼容性。",
  "Provider response exceeds the 1 MiB size limit":
    "供应商响应超过 1 MiB 安全上限，已停止读取。",
  "Test the current fields, then save to apply them. Saving embedding settings does not enable Hy-Memory indexing.":
    "可以先测试当前表单，再保存使配置生效。保存向量模型配置不会开启 Hy-Memory 索引。",
  "Choose an available model": "选择可用模型",
  "Choose main model": "选择主模型",
  "Test current configuration": "测试当前配置",
  "Fetch available models": "获取可用模型",
  "Check provider balance": "查询供应商余额",
  "These actions use the fields above without saving. Re-enter the key when changing the endpoint. The connection test sends a short message and may incur a small charge; model discovery and balance checks do not run inference.":
    "这些操作直接使用上方表单，不会自动保存。修改地址后请重新输入密钥。连通检测会发送固定短消息，可能产生少量费用；获取模型列表和查询余额不会执行推理。",
  "Choose fast routing model": "选择快速路由模型",
  "Choose reasoning routing model": "选择推理路由模型",
  "The current {model} returned real text. The chat connection check passed.":
    "当前配置的 {model} 返回了真实文本，聊天连接验证通过。",
  "Retrieved {count} available models. Choose one above or enter a model ID manually.":
    "已获取 {count} 个可用模型，可在上方选择，也可手动填写模型 ID。",
  "The provider returned no available models. You can still enter a model ID manually.":
    "供应商未返回可用模型，你仍可手动填写模型 ID。",
  "This provider does not offer a supported balance API.":
    "当前供应商没有已支持的余额查询接口。",
  "Provider account is available.": "供应商账户余额可供 API 调用。",
  "Provider account is unavailable.": "供应商账户余额不足以支持 API 调用。",
  "Total balance": "可用总余额",
  "Granted balance": "未过期赠金",
  "Topped-up balance": "充值余额",
  "The provider returned no balance details.": "供应商未返回余额明细。",
  "Chat configuration is not ready.": "聊天配置尚未就绪。",
  "Enter a valid chat provider base URL.": "请填写有效的聊天服务接口地址。",
  "Enter a chat model ID before testing.":
    "请先填写聊天模型 ID，再测试连通性。",
  "Settings changed. Refresh before testing":
    "配置已变更，请重新读取最新设置后再检测。",
  "Complete the Base URL and API key in Settings before querying the provider":
    "请先在设置页填写接口地址与 API 密钥，再查询供应商。",
  "Provider timed out or could not be reached; check Base URL and network":
    "供应商连接超时或不可达，请检查接口地址和网络。",
  "Provider authentication failed; check the API key":
    "供应商认证失败，请检查 API 密钥。",
  "Provider balance is insufficient; top up the provider account":
    "供应商账户余额不足，请充值后再试。",
  "Provider denied access; check API key permissions":
    "供应商拒绝访问，请检查 API 密钥的权限。",
  "Provider endpoint was not found; check Base URL and API support":
    "未找到供应商接口，请检查地址以及是否支持该 API。",
  "Provider rate limit reached; try again later":
    "供应商请求频率受限，请稍后重试。",
  "Provider returned an invalid response": "供应商返回了无效响应。",
  "Enter a new API key when changing the endpoint":
    "修改聊天接口地址后，请重新填写 API 密钥。",
  "Enter a new embedding API key when changing the endpoint":
    "修改向量接口地址后，请重新填写向量模型 API 密钥。",
  "Test current embedding configuration": "测试当前向量配置",
  "Test the current fields without saving. A blank key reuses your saved key only when the endpoint is unchanged. The fixed text check may incur a small charge and never sends your memories.":
    "直接测试当前表单，无需先保存。密钥留空时，仅在地址未变化的情况下复用已保存的密钥。检测使用固定文本，可能产生少量费用，不会发送你的记忆。",
  "The current endpoint returned a valid {dimensions}-dimension embedding from {model}. Save to apply any changes.":
    "当前接口返回了 {model} 的有效 {dimensions} 维向量；修改后的配置仍需保存才会生效。",
  "Loading your AI settings…": "正在读取你的 AI 配置…",
  "Unable to load AI settings. AI features are temporarily unavailable. {error}":
    "无法读取 AI 配置，AI 功能暂不可用。{error}",
  "Reload settings": "重新读取设置",
  "Chat model": "聊天模型",
  "Embedding model": "向量模型",
  "Model ID · Base URL · API Key": "模型 ID · 接口地址 · API 密钥",
  "Beijing workspace Base URL · Separate API key":
    "北京工作空间接口地址 · 独立 API 密钥",
  "YOUR AI, CONNECTED BY YOU": "连接属于你的 AI",
  "AI configuration entered": "AI 配置已填写",
  "Connect your AI in two steps": "连接你的 AI，先完成这两步",
  "Chat and AI briefings need a chat model; embeddings support memory retrieval. Tasks, calendar and manual memory management are ready to use.":
    "聊天和 AI 简报需要聊天模型；向量模型用于记忆检索。任务、日历和手动记忆管理可直接使用。",
  Entered: "已填写",
  "Not configured": "待配置",
  "Save each step when ready, then test each saved connection to verify it. Saving embedding settings does not enable Hy-Memory indexing.":
    "可以分步保存，再分别测试已保存的连接，验证真实可用性。保存向量模型配置不会自动开启 Hy-Memory 索引。",
  "1. Your AI model": "1. 聊天模型",
  "Enter an OpenAI-compatible model, endpoint and key for conversations, task understanding and daily AI briefings.":
    "填写 OpenAI 兼容服务的模型、接口地址和密钥，用于对话、任务理解和每日 AI 简报。",
  "Quick setup": "快速配置",
  "The preset fills fields only. Add your key, then save.":
    "预设只填写表单，补充密钥后再保存。",
  "Model ID": "模型 ID",
  "Chat model name · required": "聊天模型名称 · 必填",
  "The model ID from your provider": "供应商提供的模型 ID",
  "Provider base URL": "模型服务接口地址",
  "Chat API endpoint · required": "聊天 API 地址 · 必填",
  "API key": "API 密钥",
  "Key configured; leave blank to keep it": "密钥已配置，留空保留",
  "Required for first setup": "首次配置必填",
  "Leave blank to keep the current key": "留空保留当前密钥",
  "Enter your chat provider API key": "填写聊天模型供应商的 API 密钥",
  "Keys are encrypted on the server and never returned to the browser.":
    "密钥仅在服务端加密保存，不会返回浏览器。",
  "Currently using the server default configuration.":
    "当前使用服务端默认模型配置。",
  "Currently using your personal configuration.": "当前使用你的个人配置。",
  "No complete chat connection has been configured.":
    "尚未完整配置聊天模型连接。",
  "Fast routing model": "快速路由模型",
  optional: "选填",
  "Leave blank to use the main model": "留空使用主模型",
  "Reasoning routing model": "推理路由模型",
  "How to route requests": "请求路由方式",
  "Fast rules · default": "快速规则 · 默认",
  "Your language model": "使用你的语言模型",
  "Jev · requires server authorization": "Jev · 需要服务端授权",
  "Routing only selects models; sensitive actions still need your approval.":
    "路由只选择模型；敏感操作仍需要你的审批。",
  "Test saved chat connection": "测试已保存的聊天连接",
  "Remove the chat API key? Chat and AI briefings will become unavailable.":
    "移除聊天模型 API 密钥？聊天和 AI 简报将不可用。",
  "Remove chat key": "移除聊天密钥",
  "Save before testing. The check sends a fixed short message to the saved model and may incur a small provider charge. It never sends your conversations or memories.":
    "请先保存再测试。检测会向已保存的模型发送固定短消息，可能产生少量供应商费用，不会发送你的对话或记忆。",
  "Saved chat settings changed on the server. Refresh this page and test again.":
    "服务端聊天配置已变更，请刷新页面后重新测试。",
  "The saved {model} returned real text. The chat connection check passed.":
    "已保存的 {model} 返回真实回复，聊天连接验证通过。",
  "Remove the embedding API key? Future embedding calls will become unavailable.":
    "移除向量模型 API 密钥？后续向量调用将不可用。",
  "2. Your embedding model": "2. 向量模型",
  "Qwen3.7 Embedding Flash turns text into memory retrieval vectors. Use a separate endpoint and API key from your Beijing Model Studio workspace. Chat remains available without embeddings.":
    "Qwen3.7 Embedding Flash 将文字转换为记忆检索向量，使用百炼北京工作空间的独立接口地址与 API 密钥。尚未配置不会阻止聊天。",
  "Embedding model ID": "向量模型 ID",
  "Vector dimensions": "向量维度",
  "1024 · default": "1024 · 默认",
  "Beijing workspace base URL": "北京工作空间接口地址",
  "Copy the OpenAI-compatible Base URL from your Beijing Model Studio workspace, including its real workspace ID. The chat model endpoint is not reused.":
    "从百炼北京工作空间复制 OpenAI 兼容接口地址，需包含真实工作空间 ID；不会自动使用聊天模型的地址。",
  "Embedding API key": "向量模型 API 密钥",
  "Separate key configured; leave blank to keep it": "独立密钥已配置，留空保留",
  "Leave blank to keep the current embedding key": "留空保留当前向量模型密钥",
  "Enter your Beijing Model Studio workspace API key":
    "填写百炼北京工作空间 API 密钥",
  "Keys are encrypted on the server and never returned to the browser. A DeepSeek key is never used for embeddings.":
    "密钥仅在服务端加密保存，不会返回浏览器。DeepSeek 密钥不会用于向量模型。",
  "Test saved embedding connection": "测试已保存的向量连接",
  "Remove embedding key": "移除向量密钥",
  "Save before testing. The check sends only fixed text, never your memories, and may incur a small provider charge.":
    "请先保存再测试。检测仅发送固定文本，不会上传你的记忆，可能产生少量供应商费用。",
  "Embedding connection check failed": "向量模型连接检测失败",
  "Saved embedding settings changed on the server. Refresh this page and test again.":
    "服务端向量配置已变更，请刷新页面后重新测试。",
  "The saved endpoint returned a valid {dimensions}-dimension embedding from {model}.":
    "已保存的接口返回了 {model} 的有效 {dimensions} 维向量。",
  "Saving or testing this configuration does not enable Hy Memory indexing. Its data storage and authorization still need separate setup.":
    "保存或测试此配置不会开启 Hy-Memory 索引，其数据存储和授权仍需单独配置。",
  "Complete the chat model, Base URL and API key in Settings before using AI":
    "请先在设置页填写聊天模型、接口地址和 API 密钥，再使用 AI 功能。",
  "Chat provider timed out or could not be reached; check Base URL and network":
    "聊天服务连接超时或不可达，请检查接口地址和网络。",
  "Chat provider returned no text; verify model access and compatibility":
    "聊天服务未返回文本，请检查模型权限与接口兼容性。",
  "Chat provider returned an invalid response": "聊天服务返回了无效响应。",
  "Add the Beijing workspace Base URL and a separate Bailian embedding API key in Settings":
    "请在设置页填写官方北京接口地址和独立的百炼向量 API 密钥。",
  "Embedding provider timed out or could not be reached; no vectors were saved":
    "向量服务连接超时或不可达，未保存任何向量。",
  "Embedding provider returned an invalid response": "向量服务返回了无效响应。",
  "Embedding provider returned an incomplete or misindexed batch":
    "向量服务返回的批次不完整或索引不匹配。",
  "Embedding provider returned invalid vectors or a mismatched dimension":
    "向量服务返回了无效向量或维度不匹配。",
};
