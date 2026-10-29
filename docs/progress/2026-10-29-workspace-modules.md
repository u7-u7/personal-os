# 任务、记忆与自动化 · 2026-10-29

## 改动

任务与记忆页面过去只读取最新100条，自动化列表固定200条，历史固定100条。筛选/搜索/计数可能漏掉旧记录。现复用共享完整分页读取：200条/页、AbortSignal、稳定ID去重、所有分页成功才发布；第二页失败显示错误/重试，不把部分数据当完整数据。API仍返回数组；自动化增加兼容limit/offset；列表均以created_at/id稳定排序，隔离owner和逻辑删除。没有新增表/迁移/依赖/SQL JOIN或测试用例。

任务服务先筛开放状态，Agent默认全部开放任务，简报全部开放任务，首页开放前5条；历史工具使用显式受约束分页。记忆主题冲突也完整分页，不会被较新的pending挤掉已确认旧事实。记忆API原来会继承confirmed并在隐式编辑时重新确认，现仅显式status=confirmed触发确认，编辑默认pending，显式pending可撤回当前召回资格；服务端extra与可写字段分开验证，成功Store重试通过CAS清理本地索引pending标记。自动化页面可展开单任务完整历史，并修复编辑cron=null一次性任务会被填成每天执行的问题。

## 本轮真实验收

独立QA账号，不修改原用户资料、日历、Key，也不复制模型凭据。数据库种子是明确标记的输入；225条失败历史是元数据输入，不是实际模型执行结果。

| 入口 | 本轮实际结果 |
| --- | --- |
| 修复前API | task100且旧开放任务不可见；memory100且旧goal不可见；topic200不含旧confirmed；automation200；runs100；content-only记忆编辑返回confirmed |
| 修复后真实API | tasks265，旧开放存在；memory228（删除前），旧goal与topic旧confirmed存在；automation206；runs225且唯一225 |
| 开放任务 | 真实工具返回60条、全部开放；历史第二页65条；首页stats60、preview5且均开放 |
| 记忆API与Store | 编辑pending且不召回；显式确认后真实Postgres Store内容一致；pending撤回有效；过期版本409，服务端元数据注入422，其余server字段保留 |
| Store重试 | 实际Store aput/aget；CAS清理pending标记后version3，其余server元数据保留；临时记录清理后aget为空 |
| 审批删除 | 经真实DELETE→审批→执行后，列表不含目标，真实Store aget为空；不代表Hy外部索引/缓存验收 |
| 隔离与参数 | 另一账号tasks/memories/automations为空，读取他人runs与修改他人任务/记忆404；limit201与offset-1为422 |
| 任务Web | 待办60/完成103/总数265；旧任务可搜索、完成至59、重开至60，计数正确刷新 |
| 记忆Web | 删除后227卡；旧goal分类可见；从225条新pending之后找到旧confirmed，明确勾选替换→保存pending→确认成功 |
| 自动化Web | 206卡；225条历史全部呈现；一次性编辑只改标题，API读回cron仍null |
| 独立Worker | 复制该一次性配置到临时隔离PG schema，独立进程两次--once均exit0；状态completed、执行始终1条、attempts1。推理因无模型配置而failed，未触达供应商；不是模型成功 |
| 第二页失败 | 明确标记的本地只失败代理转发真实第一页，第二页503。tasks/memory/automation/history均0部分行、无假空态，错误和重试可见；解除故障后任务恢复60 |
| 手机 | 展开225条历史及长QA结果，390px下clientWidth=scrollWidth=390 |

[API读回](../evidence/modules-api-readback.json)、[UI读回](../evidence/modules-ui-readback.json)、[Worker](../evidence/modules-worker-once.json)、[实际查询IO](../evidence/modules-query-plans.json)。六个实际应用SELECT中，任务/记忆的四项使用现有owner范围索引；自动化/历史两项在本地小表选择顺序扫描。观察耗时0.108–0.339ms、shared-read0；没有强制planner，也未新增索引。这是小数据暖缓存观察，不是生产负载基准。

截图：[任务](../evidence/modules-tasks-complete.png)、[旧记忆](../evidence/modules-memory-older-goal.png)、[冲突候选](../evidence/modules-memory-conflict.png)、[历史](../evidence/modules-automation-history.png)、[手机](../evidence/modules-automation-mobile.png)、[第二页错误](../evidence/modules-second-page-error.png)。临时QA Web/API/只失败代理和标签页已停止，临时schema已删除；QA凭据只在本机600权限文件，没有提交。

现有后端51 passed（9.51s），现有完整Web/API E2E 1 passed（20.5s），Ruff/TypeScript/ESLint通过。三个职责独占agent实施并交叉只读审阅，没有新增/修改测试用例。E2E覆盖的旧截图和Next临时类型路径已恢复。

## 边界

- 本轮按用户选择没有重试模型网络，不用旧DeepSeek成功冒充本轮工具选择/提取/简报质量。Hy-Memory/Jev待授权；Google仍为可选。
- 完整分页对固定数据集成立；offset跨请求不承诺并发写入快照。开放任务全量可能增加模型输入，受既有上下文/超时限制，失败会明确返回。
- 记忆召回既有500条候选上限仍是后续相关性问题；当前记忆页面完整不代表召回算法/向量接入完成。
- 审阅发现既有删除恢复风险：本地删除先提交，后续Store或checkpoint删除失败后普通重试可能404；成功路径本轮验收，失败恢复需独立修复和故障验收，不宣称完整外部索引/缓存清除。
- 自动化历史沿用Query焦点/重新展开刷新，无主动轮询；Worker执行中暂停、未知结果人工对账与重试等既有状态机未改。
