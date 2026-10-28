# 2026-10-29：真实自动化聊天历史修复

## 问题与改动

独立 Worker 对真实 DeepSeek 执行一次性只读验收任务：执行成功、attempts=1、实际回复长度23，返回的聊天会话却没有任何 Message。聊天列表能看见 Automation execution，打开后为空。该问题与外部凭据缺失无关。

本次复用现有 Message 表和交互聊天的持久化方式：在模型工作前提交用户输入；完整流结束后才提交助手回复。保留会话字符串ID，避免工具回滚影响ORM对象；两次写入都检查账户状态，并位于既有账户lease内。模型失败或取消不会把部分文本写成成功回复，也不会自动重放已发生的工具效果。原返回的 session_id/content/tools 合同不变。

## 本轮真实证据

输入是明确标记的只读QA请求，要求只返回唯一验收标记，不调用工具或修改业务数据。成功用当前账号已有的DeepSeek配置，未读取或复制其Key到其它账号；负例使用独立QA账号及明确无效的Key。所有模型调用均到真实DeepSeek入口，没有模拟模型响应。

| 阶段 | 新取得的结果 |
| --- | --- |
| 修复前基线 | Worker succeeded，attempts=1，response length=23，session messages=0 |
| 修复后成功 | Worker succeeded，attempts=1，messages=2，roles=user/assistant；输入与执行prompt相同，回复与执行结果相同；tool events=0 |
| Worker重启后 | 同一任务completed、同一occurrence仍仅1个execution、attempts=1，messages仍为2 |
| 同会话交互续问 | 响应session header正确，9个真实token chunk，done存在、无error；准确返回原验收标记；messages=4、角色交替 |
| 真实鉴权失败负例 | 上游401（Worker日志仅检查状态与异常类型），Worker failed、attempts=1；messages=1且仅user；没有助手成功回复，Execution.result仍为{} |
| 浏览器 | 打开最新自动化会话，实际显示输入与真实回复，[页面证据](../evidence/automation-chat-history.png) |

现有PostgreSQL后端测试51 passed（6.32s）、Ruff通过；现有完整Web/API Playwright 1 passed（18.4s）。未新建或修改测试用例。一次性验收任务已由正常调度标记completed，不会产生后续周期运行；没有为了截图植入假回复或替换模型结果。

## 剩余边界与下一步

该修复针对后续新执行，不承诺回填既有空历史。本轮未验证工具选择/记忆提取/简报质量；未进行外部写入或审批。失败执行的result仍为空，尚未增加Activity到失败会话的直接链接；也没有新增运行中取消能力。超时、取消与工具副作用回滚的完整业务验收继续保留。

Google OAuth应用配置仍缺失；Hy-Memory/Jev仍待用户授权。Qwen沿用此前已确认的云端免费额度限制，未在本轮重复发起向量请求，不能把旧失败当作新检测，也不能把本轮DeepSeek成功当作Qwen成功。

后续独立范围已记入.sdd任务清单：本地日历时间窗漏显、Google分页漏冲突，以及OAuth token与账户擦除的生命周期审计。本次feature PR只修自动化历史；按本heartbeat要求不合并main。
