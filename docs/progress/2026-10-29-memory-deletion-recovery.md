# 记忆删除中断恢复 · 2026-10-29

## 结果与范围

旧代码先提交软删除，再清Store及checkpoint；失败后普通owned读取会404，审批failed/executing也不能重试。旧检查点循环还只取10000个未删除会话。新实现复用Record.extra持久化原审批ID/冻结版本、Store/checkpoint/provider阶段和批次游标；删除正文、来源及用户extra后，即刻停止正常召回，但只有必要阶段全部完成才显示完整清理完成。

新增原审批resume入口及Activity继续清理。审批认领到最终回写持exclusive账户租约，确认本地与异步索引写持shared；本地清理中断期间新Agent/索引写被409阻止，避免游标前缀被重写；本地已完成而Hy待授权时不阻塞本地AI。Store缺失读回、checkpoint官方SDK清理和批次提交可重放；包含已软删会话，移除总量10000上限。完成操作重放只返回持久回执，不扩展到完成后新写的会话。

无新增业务表、迁移、依赖、SQL JOIN或测试用例。旧失败仅在唯一匹配授权、原version+1与旧墓碑形状都符合时收养；歧义不显示恢复按钮且后端409。可写memory.extra仍不允许客户端注入服务端journal。

## 本轮真实验收

独立QA owner，未复制用户Key、未修改原账号的记忆或会话。使用实际PostgreSQL、LangGraph Postgres Store/Saver和应用审批函数/API；故障包装只在真实SDK调用边界抛出明确QA异常或让专用子进程os._exit，不返回假的成功数据。实际图写入是无模型的确定性QA输入，不是LLM结果。

| 场景 | 本轮观察 |
| --- | --- |
| 旧方法边界 | 446f6df原删除方法对真实tombstone仍404；候选已用原审批恢复该QA目标 |
| Store删除前失败 | canonical已擦除、Store仍存在；审批failed、journal store pending；后续原审批可继续 |
| Store删除后失败 | 实际Store已不存在但marker尚pending；新进程重复delete/readback后完成，不把不确定阶段假标成功 |
| 检查点部分失败 | 在第105个真实SDK线程删除后抛错，第一批100进度已提交；Store complete、checkpoints pending |
| 大容量与软删除 | 真实10001条持久化会话含1条软删；首轮恢复后三个表为0。完成重放前另写合法后续QA状态，重放保留9/9/9；独立新授权全范围擦除再次读回0/0/0 |
| 跨owner哨兵 | 外owner三个检查点表始终6/6/6，无越界清理 |
| 进程中断 | 审批claim后直接exit74、Store实际删除后直接exit73；新进程均通过原审批200完成，不依赖进程内缓存 |
| 确认/删除竞争 | 真实aput屏障期间删除409且审批未认领；确认完成后旧target版本409，live记忆不被误删；exclusive清理期间shared Agent409 |
| 中断间隙 | 本地journal未完成时shared409；本地阶段全complete且仅provider待授权时shared允许 |
| 过期与绑定 | 未开始且已过期恢复409；已开始且原审批过期，真实Web点击继续清理200完成；换审批/歧义legacy409，非memory403，跨owner404，旧version409，body额外target422 |
| 页面及分页 | 205条较新rejected QA元数据将原审批放到第二页；200+15完整读取，旧恢复卡及四阶段可见；完成后原卡消失，后台Store和三个表都为空 |
| 未授权provider | 明确标记的QA外部ID元数据（非真实Hy记录）走真实应用状态机：202/cleanup_pending，local phases complete、provider authorization_required，页面明确尚未验证；未发任何Hy调用 |
| 手机 | 审批引用和四阶段/按钮在390px下scrollWidth=clientWidth=390 |

[阶段事件](../evidence/memory-cleanup-journal-events.json)、[HTTP读回](../evidence/memory-cleanup-http-readback.json)、[授权边界](../evidence/memory-cleanup-authorization-guards.json)、[租约](../evidence/memory-cleanup-lease-readback.json)、[10001会话独立读回](../evidence/memory-cleanup-full-session-sweep.json)、[旧方法](../evidence/memory-cleanup-legacy-baseline.json)。CLI事件里的completed_replay是写入新QA状态后的幂等重放观察，不代表初次清理遗漏。

正常planner下，checkpoint游标分页形状0.104ms、实际shared guard SQL0.138ms，使用既有索引且shared-read0；只是本地暖缓存小数据观察，非生产负载基准。[查询计划](../evidence/memory-cleanup-query-plans.json)。SDK源码核对adelete_thread分别删除checkpoints/checkpoint_blobs/checkpoint_writes，最终也用独立SQL计数核实。

[恢复前](../evidence/memory-cleanup-pending.png)、[手机](../evidence/memory-cleanup-mobile.png)、[外部待授权](../evidence/memory-cleanup-provider-pending.png)。临时QA标签页/API/Web已停止；临时凭据仅在本机600权限文件中。现有E2E截图与Next临时类型路径已恢复。

现有后端51 passed（29.02s）、完整Web/API E2E 1 passed（38.4s），Ruff/TypeScript/ESLint通过。三agent按独占文件/只读审阅分工，最终安全复审通过。OpenAPI快照已更新；远程CI、生产镜像和Compose验收结果按本轮PR回执记录，不预填。

## 保留边界

Hy-Memory真实删除、进程中断后的provider回读，以及底层索引/缓存完整清除仍待授权；SDK ID不存在不等于完整外部清理。Jev/真实模型联调本轮未执行，原完整需求保留。恢复仅针对memory.delete，不为邮件/MCP/外部写入添加自动重放。可见聊天消息历史按原设计保留，清理的是可恢复Graph状态；备份依部署保留策略到期。

回滚：无迁移，保留journal；旧API不能恢复新进度，须先完成进行中本地清理或保留此API版本，不能通过删除journal伪造完成。
