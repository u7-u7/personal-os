# PersonalOS 可执行任务

所有需求保留；“有代码”“已本地验证”“外部验收通过”分开标记。

后续执行入口：[2026-10-30后续开发与验收任务](../../docs/roadmap.md)，包含18项任务、优先级、依赖、完成条件与授权阻塞。继续开发时先按该清单核对当前代码和新证据；以下保留原任务及历史进展，不把历史成功当新验收。

| TASK | 路径/产物 | 关联 | 完成条件与验证 | 状态 |
|---|---|---|---|---|
| TASK-01 | .sdd/personal-os、AGENTS.md、Git | PLAN-01/DES-06/REQ-K | 文档齐全，独立 feature 分支 | 已完成：独立仓库、设计和feature分支 |
| TASK-02 | apps/api/personalos/{main,models,services,auth} | PLAN-01/03/05、DES-02、REQ-C/D/E/H/I | 注册、隔离、CRUD/CAS、真实 DB 集成 Pytest | 本地API/安全验证通过；第三方授权待验收 |
| TASK-03 | apps/api/personalos/agent.py、memory service | PLAN-02/DES-01、REQ-A/B | 真 SSE、历史、持久 graph、确认记忆 | 已真实DeepSeek验证只读Worker→聊天续问与持久上下文；工具选择/记忆/简报质量仍待验收 |
| TASK-04 | apps/api/personalos/integrations | PLAN-02/04/DES-01/04、REQ-B/G/J | 官方 SDK 核查，provider 可替代，外部授权测试 | SDK核查与provider契约通过；Hy数据面/Jev服务待授权 |
| TASK-05 | apps/web | PLAN-01/03/05/DES-05、REQ-L | 9 路由真实 API、响应式/明暗/状态、Playwright | 九页代码、生产build和真实API浏览器流程通过 |
| TASK-06 | apps/api/personalos/worker.py | PLAN-04/DES-03、REQ-F/E | 独立进程、claim/租约/失败恢复测试 | 6项PG事务测试及既有进程/容器检查；新增真实DeepSeek Worker历史、重启与失败保留输入验收 |
| TASK-07 | compose.yaml、Dockerfile、CI、tests | PLAN-06/DES-06/NFR | 一键运行、后端安全测试与 UI 实测 | API/Web镜像、全Compose浏览器及PR #1–3远程CI已通过；授权集成验收仍待完成 |
| TASK-08 | docs、README、截图、GitHub PR | PLAN-07/DES-06/REQ-K | 可重复启动、课程、完整验收矩阵和 PR 链接 | 文档/截图/报告已生成，PR #1–3已合并；完整外部验收与候选发布门槛保留 |

前置：TASK-01→其余；TASK-02 与 TASK-05 共享设计契约并行；TASK-03 依赖 TASK-02 和 provider 接口；TASK-06 依赖 TASK-02 数据契约；TASK-07/08 最终收敛。授权不足的真实外部测试标 blocked，不用 mock 替代通过。

## 外部验收门槛（保留完整需求）

- [ ] 用户的DeepSeek/OpenAI兼容Key：真实流式/工具选择/记忆提取与简报质量。
- [ ] 可选Google OAuth应用配置与用户consent：真实日历查询/改删/撤销/冲突读回。2026-10-29用户选择自带日历、不需Google；此项延后，不作为当前本地候选版前提，也不再请求凭据。
- [ ] Hy Memory完整数据面和embedding授权：Chat/Working真实读写、冲突、跨进程持久化、所有索引缓存历史删除。
- [ ] Jev真实System One服务与标注评测；当前规则/普通LLM为显式替代。
- [ ] 管理员allowlist的受控public HTTPS MCP：真实工具发现/审批/执行。
- [x] GitHub Actions远程通过、全Compose Web业务验证（PR #1–3及实际容器证据）。
- [ ] 完成当前使用路径的授权集成门槛后进行候选版最终验收；未启用的可选集成逐项注明未验收。

最新状态与命令证据见 `docs/verification.md`，不能把adapter实现或fixture通过当外部集成完成。

## 模型配置诊断补充 · 2026-10-29

- [x] 聊天/向量连接检测支持当前未保存表单、版本冲突和独立密钥绑定。
- [x] 兼容 SDK 读取真实模型列表；保留手动输入，主模型与路由模型可选择。
- [x] 官方 DeepSeek 余额查询，按币种显示总余额/赠金/充值，不支持的供应商明确提示。
- [x] 用户已保存 DeepSeek 配置：真实模型发现、余额、最小非流式推理均通过；错误 Key/模型、过期版本与换端点缺 Key 均真实验证。
- [x] 用户已明确选择Flash；前一轮API和网页真实验收取得1024维向量。标准版曾遇FreeTierOnly是独立结果，不用Flash成功替代；Hy索引验收仍保留。

以上不是完整 Agent 流式/工具/记忆提取/简报质量验收；原有外部验收门槛全部保留。

## 2026-10-29 Worker 历史验收与后续缺陷

- [x] 真实复现自动化执行成功但Message历史为空，补齐调用前的输入、完整成功后的回复持久化。
- [x] 真实独立Worker+DeepSeek验证：成功保留两条消息；重启后仍仅一个执行、attempts=1；交互续问返回原标记并保留四条消息。
- [x] 独立负例账号以明确无效Key请求真实供应商，401后Worker失败，仅保留输入，不生成助手成功回复。
- [x] 本地日历按可见42格时间窗完整分页：336条独立QA日程复现，225条窗内事件完整读取，浏览器与索引检查通过；见calendar-window报告。
- [x] ~~后续独立修复：Google列表读取忽略nextPageToken~~ 作废：2026-10-31 用户决策整体移除 Google 日历，相关路径已删除。
- [x] ~~后续独立审计：OAuth完成/token刷新跨await与账户擦除的生命周期fence~~ 作废：OAuth 路径随 Google 日历移除而删除。

自动化历史修复PR #7原按heartbeat保持开放；2026-10-29用户明确要求后已核对CI并合并（93119dd）。其真实证据见 `docs/progress/2026-10-29-automation-history.md`。后续日历范围修复见 `docs/progress/2026-10-29-calendar-window.md`；完整外部验收门槛不变。

## 2026-10-29 自带日历优先

- [x] 用户选择自带日历；Google保留可选，不再要求OAuth作为当前使用前提；每日自动化已同步此选择。
- [x] Agent未来七天、简报未来24小时先按发生时间过滤，避免创建时间100条截断；Dashboard显示未来七天最早四条。
- [x] 独立QA账号336条日程：旧查询100条全在窗口外；本轮真实数据库和Agent工具读回221条窗口内记录，精确匹配，简报24小时范围120条，Dashboard真实API前四条匹配。
- [x] Google未连接为中性说明，无事件请求/红色错误，390px无横向溢出；首页日历加载/失败不误判为空闲。连接快照按provider查询、只暴露id/version，已以101条较新MCP元数据的回滚事务验证不会因列表截断误判。
- [x] 现有51项后端检查和完整Web/API E2E通过，未写新测试；详见local-calendar-workflow报告。
- [ ] 本轮真实模型工具选择/简报质量因本机代理DNS将DeepSeek解析为198.18.*而受SSRF防护阻止，尚未发出供应商请求。用户选择先完成其它开发，暂不重试；不复用旧成功证据。

## 2026-10-29 任务、记忆与自动化

- [x] 任务列表全量分页后筛选/搜索/计数；首页与Agent/简报先过滤开放任务，移除创建时间截断，历史工具保留显式分页。
- [x] 记忆列表及主题冲突候选完整分页；失败不误报空白，支持重试。隐式编辑默认pending，明确confirmed才确认；可撤回pending，服务端extra保留且客户端不能注入；Store重试清理标记走CAS。
- [x] 自动化列表/单任务历史稳定分页及页面展开；一次性cron=null编辑后仍单次。真实独立Worker在隔离DB两次启动只有一条执行，未配置模型的失败不冒充成功。
- [x] 独立QA真实API/UI：265任务含60开放、228记忆输入、206自动化、225条明确标记的历史元数据；实际Store确认/读取/审批删除验证，跨用户404/空列表和409/422边界通过。
- [x] 第二页失败的真实浏览器错误/重试验证，390px长历史无横向溢出；现有51项后端检查和完整E2E通过，未新增测试用例。
- [ ] 模型工具选择、提取/简报质量与Hy/Jev数据面仍按授权/网络条件单列；本轮未重试模型。
- [x] 本地Memory删除中断恢复：原审批绑定journal、阶段持久化、全会话keyset、进程重启和写入fence、Activity继续清理；真实Store/检查点故障及10001会话验收通过。Hy索引/缓存仍待真实授权，不计为完成。见memory-deletion-recovery SDD与报告。

完整证据见 `docs/progress/2026-10-29-workspace-modules.md`。

## 2026-10-30 完整词法候选召回

- [x] 修复MemoryService召回500条预截断，三个调用方共享全owner confirmed/live候选；200批次命名游标、有界top-k、稳定同分、保留来源和原匹配规则。
- [x] 隔离真实PG的10004有效QA事实复现旧缺口并验证修复；实际工具、用户/状态隔离、字面词、回退、取消/超时/数据库错误传播通过，未调用模型或外部provider。
- [x] 公共扫描30秒协作式预算，取消关闭游标不返回partial；大词项实际31.7055秒超时后可继续查询。现有51项后端和完整E2E通过，未新增测试。
- [ ] 中文语义/分词质量、零命中相关性和任务绑定Working Memory生产链路；本轮没有以词法候选完整性替代这些要求。
- [ ] Hy/Jev授权数据面与真实模型工具选择/提取/简报质量继续按原条件保留，未重试暂停的模型网络检查。

证据见 `docs/progress/2026-10-30-memory-recall-completeness.md`；远程CI/合并状态见当前PR。
