export const configurationMessages: Record<string, string> = {
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
    "请在设置页填写北京工作空间接口地址和独立的百炼向量 API 密钥。",
  "Embedding provider timed out or could not be reached; no vectors were saved":
    "向量服务连接超时或不可达，未保存任何向量。",
  "Embedding provider returned an invalid response": "向量服务返回了无效响应。",
  "Embedding provider returned an incomplete or misindexed batch":
    "向量服务返回的批次不完整或索引不匹配。",
  "Embedding provider returned invalid vectors or a mismatched dimension":
    "向量服务返回了无效向量或维度不匹配。",
};
