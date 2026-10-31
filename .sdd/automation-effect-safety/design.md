# 技术方案

| 证据 | 原行为 | 复用与改动 |
| --- | --- | --- |
| worker.execute_claim/finish_run/recover_expired | 非timeout异常failed；终态token fence | 保留claim/lease，终态新Session读持久标记并CAS；unknown暂停active父调度 |
| agent.build_graph.invoke_tools | 工具独立commit后才写审计 | 写前intent提交，完成后仅保存UUID引用；工具错误被模型处理也不能掩盖未知写 |
| agent._run_automation/_generate_briefing | 会话/简报持久化 | 运行绑定会话，简报落库前同样记录intent |
| main.retry_automation/update_automation | latest守卫，PATCH可重排 | 使用父Automation NOWAIT锁、原CAS和共享全历史守卫，异常rollback |
| accounts.account_lease/records.cas_update | 跨await owner fence和乐观锁 | 保持不变，不用内存标记代替数据库事实 |

DES-01→REQ-01/02：新增execution_safety服务只是运行副作用边界，不替代LangGraph。Worker绑定ContextVar(owner,id,token)，条件UPDATE检查运行中/未删/版本；extra.effect_safety schema1保存state none/possible/completed、单调uncertain与最多64个无正文动作事件。未绑定的交互式调用不记录运行标记；绑定错owner/旧token拒绝写。每次intent先提交再执行；失败不能擦已有引用。

DES-02→REQ-02/04：none+空事件+uncertain=false才证明未开始业务写。异常且有任何动作、非法/缺失marker、未完成动作或timeout均不安全；最终模型有回复也不能把uncertain动作记完整成功。result包含retry_safe/reconciliation_required及已绑定session_id。会话/Message是执行记录，不因此把纯模型失败当业务副作用。

DES-03→REQ-03：守卫stream所有同owner/automation live运行，不取latest后才检查未知状态。旧版failed缺证明拒绝自动重试。retry仅最新failed且明确none；普通恢复原有队列可允许inflight，改变时间/周期/时区/prompt/handler仍严查；暂停/取消及元数据编辑不受对账阻止。Worker对未知或旧不安全失败暂停active父调度，下一周期不盲目重排。

DES-04→REQ-03/04：HTTP仅锁父，不锁执行；Scheduler原父锁+SKIP LOCKED保持，claim原执行锁与父只读保持。父锁冲突409并rollback，CAS仍校验用户version。终态/恢复暂停父只条件更新active，不覆盖cancelled/deleted。无数据库迁移；查询计划与IO实际记录。

验证：隔离真实PG与实际LangGraph节点/内部工具，明确标注确定性模型fixture/失败注入，绝不当供应商验收；检查提交后失败、工具错误后正常回复、未知历史、PATCH/周期绕过、并发、stale token和取消，运行现有51项及E2E/CI。

发布必须协调同一构建的API/Agent/Worker：先停止/排空旧Worker及旧重排入口，再更新并恢复。新Worker配旧Agent会错误留下none，旧API会绕过守卫，不能混用。回滚不得回到会重放旧failed的API；保留标记，旧数据不回填none。不含自动对账结案，已未知运行需人工检查，之后明确创建新计划；原未知结果不会伪装成安全重试。
