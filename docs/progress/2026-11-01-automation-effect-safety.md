# AUTO-01 自动化副作用与安全重试 · 2026-11-01

## 交付与基线

接续10月31日未提交的工作，本轮完成Agent/API整合、调度防绕过、实际故障验收和发布准备。dd1e3a9真实PG基线：实际create_task提交后注入后续失败，执行标failed，重试使任务由1条变2条；较旧unknown也被较新failed遮住。[基线证据](../evidence/automation-retry-baseline.json)是前一轮复现，不冒充本轮新验证。

复用Execution.extra及原claim/token/CAS，业务写前提交无正文intent，完成后仅保存产物/审批UUID；错误不清除既有引用。新增服务不替代LangGraph。所有写工具默认受保护，明确只读工具除外；直接简报落库也有写前标记。运行早期持久关联原会话。

可能已有动作的失败、未完成动作或工具错误后模型继续回复，均归outcome_unknown；只有新版证明未开始业务写的failed可重试。检查全部live历史，不只看latest；旧failed无证明不能补写none。成功执行不能通过/retry再跑。重试及执行定义/时间/激活变更持父NOWAIT锁，保留原CAS，错误rollback；暂停、取消、标题编辑及仅恢复原队列仍可用。unknown终态/过期恢复暂停active周期计划，Scheduler也阻止不安全旧记录继续排程。

## 本轮新验证

临时隔离PostgreSQL、真实HTTP/Worker/LangGraph节点与内部工具；模型阶段使用明确标记的确定性QA计划/失败fixture，零供应商调用，不证明真实工具选择或简报质量。未复制主账号Key或修改其业务数据，所有临时schema实际清理。

| 场景 | 新读回 |
| --- | --- |
| 真实任务提交后失败 | unknown、真实task UUID和原session保留，active周期父计划paused |
| 重试/PATCH绕过 | retry409、激活并改时间409；标题编辑200，实际任务数量不变 |
| 无业务写的失败 | none证明、failed/retry_safe=true；HTTP retry200，同版本409，独立Worker实际执行安全重试并如实失败 |
| 工具错误后继续回复 | 有最终QA回复仍unknown，不冒充完整成功 |
| 完成写且流程成功 | succeeded；/retry409，不重新执行成功动作 |
| 全历史/兼容 | 205条新安全failed后旧unknown仍409；legacy failed也409；Scheduler暂停目标，不建立新occurrence |
| 正常控制/并发 | 原queued恢复200；父锁冲突409；两个同版本重试200/409，拒绝后释放锁 |
| 范围/对账 | 错owner/旧token409；后续错误保留原产物引用 |
| 真实进程退出 | 专用子进程在Graph create_task提交后立即exit73；任务1条、intent possible；新Session租约恢复unknown/paused/session，旧token后续写409 |
| 容量边界 | 64条事件后第65条intent409，不清旧记录继续执行 |

[本轮HTTP/Graph/Worker读回与源码Hash](../evidence/automation-effect-safety.json)、[进程退出/恢复](../evidence/automation-effect-crash.json)。首次手工Scheduler场景误选另一正常到期QA计划，命令失败；修正隔离选择后完整重新执行，不把失败运行计为通过，应用源码未因此改动。

实际全历史查询使用既有ix_executions_owner_id，过滤后206行排序，0.320ms、11 shared hits、0 reads；未强制索引，无JOIN。仅本地小数据暖缓存观察，不是生产性能承诺。200批次和64事件限制客户端元数据，历史扫描/排序总成本仍随运行数增长。

现有后端 **51 passed（6.76s）**、完整真实Web/API E2E **1 passed（18.6s）**，Ruff/diff通过。未新增或修改测试用例、表、迁移或依赖；只读复审无阻塞P1/P2。浏览器流程证明现有UI/API无回归，不替代故障证据或真实模型验收。远程CI/镜像/Compose结果记录在本轮PR，不预填。

## 发布与剩余边界

发布前发现远程main已到fe1981d（本地日历/提醒、原生代码托管/浏览器工具、MCP OAuth），已整合并保留全部上游改动；worker导入冲突保留双方，恢复本轮简报需要的uuid导入。上表PG/HTTP/Graph、exit73/64事件证据已在整合后的源码重新执行；现有51项、E2E、Ruff、Web类型检查/lint重新通过。86c8941旧基线检查不冒充整合后证据。代码托管/浏览器复合工具默认视为可能写；其只读子动作失败也可能保守要求对账，尚未做子动作级安全证明。

开发运行升级前确认无running执行，停止旧API/Worker，实际生成本机0600数据库备份，核对已有迁移头0002并成功执行upgrade head，再以同一整合源码启动API/Worker，健康检查通过。本轮没有新增数据库迁移，备份及凭据不提交GitHub。

运行中执行数为0后，同批停止旧API/Worker，再以同一源码启动；开发API健康。镜像同样必须同一不可变构建：新Worker搭旧Agent会错误保留none，旧API仍可绕过守卫，因此禁止混用。

旧failed和unknown需人工核对Activity及业务对象；本轮阻止不安全整份prompt重放，不自动撤销已提交动作或自动结案。核对后可明确创建新计划；辅助对账/显式结案UI仍是可后续开发项，不能伪装成已能自动恢复。无迁移，但不可回滚到旧盲重试API继续执行；保留安全标记，维护时停止旧重排入口。账户/记忆删除fence保持。

本轮不恢复暂停的模型网络检测，不换Flash配置；Hy/Jev待授权，Google可选。真实LLM简报/供应商工具调用未验收。AUTO-01按roadmap“阻止整单重放并要求对账”的条件收敛，其余完整需求继续；下一步优先CHAT-01及MEM-01/03。
