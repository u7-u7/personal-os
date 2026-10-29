# 任务、记忆与自动化可靠性

沿用已有SDD，用户授权自主优化、真实验证、检查通过后合并main。采用小范围服务与UI修复，无新表/迁移/依赖。首批列表截断、隐式记忆重新确认、一次性任务编辑误改频率均属于既有链路错误，不改外部授权策略。

- tasks：Record查询先按owner/deleted/open过滤，再稳定按created_at/id分页。API数组/100默认/200上限不变；默认Agent工具与简报全量开放任务，历史工具显式受约束分页；首页开放任务前5条。
- Web：共享apiAllPages按200条顺序读取，传AbortSignal，Map去重，全部成功才返回；满页无新增ID时明确失败，防旧服务忽略offset死循环。Tasks、Memory及主题冲突、Automations和每个任务的历史复用它；错误与成功空态严格分开。offset不承诺并发快照。
- memory：只有显式status=confirmed触发确认。编辑默认为pending；显式pending可以撤回当前召回资格。验证用户可写extra与服务端index/provider元数据分开，保留后者且禁止客户端注入。确认/删除仍走现有服务和审批；Hy/Jev待授权。
- automations：列表/执行历史开放兼容limit/offset，先owner/deleted再稳定排序；页面可展开单个任务的完整历史。编辑cron=null保持一次性，新建仍默认每日；不改变Worker claim/租约/重试的状态机。

验证：不写测试用例，运行现有PG安全与并发检查、静态检查、真实Web/API与容器E2E。独立QA输入覆盖265条任务（60开放+205关闭）、记忆与冲突超过200、206条自动化与225条明确标记的历史元数据；真实LangGraph Store验收记忆显式确认/编辑。一次性编辑通过浏览器读回及隔离PG调度验证。种子数据绝不当作模型执行成功；模型DNS阻塞按用户选择不重试。权限/删除恢复风险单列，不伪称完整Hy清理验收通过。
