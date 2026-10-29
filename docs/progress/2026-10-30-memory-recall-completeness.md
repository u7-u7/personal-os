# 长期记忆全候选召回 · 2026-10-30

## 实际完成

本轮沿用七天计划REQ-B/A/E，修复聊天预召回、`recall_memories`工具和每日简报共同使用的 `MemoryService.recall`。旧实现先取最近500条再评分，导致更旧的唯一相关事实永远不能进入候选。真实数据库复现后，改为扫描本owner全部confirmed且未删除的canonical事实，最后取top-k；source保持canonical来源。

沿用原Python `lower().split()`和字面子串计分，重复词去重、零命中按最近更新回退；同分按updated_at/id稳定。查询仅投影id/content/data，200条一批的真实PostgreSQL命名游标和标准库有界top-k避免全量ORM驻留。空白查询直接SQL limit。每批让出事件循环，公共扫描30秒协作式预算；超时/取消/数据库错误关闭游标并传播，不返回部分成功或伪装空列表。原有shared账户租约、删除恢复fence保持不变。

无新增表、迁移、依赖或SQL JOIN，无新增或修改测试用例。两个职责独立的只读agent核查调用链、依赖源码与最终安全边界，主agent独占实现和文档。

## 本轮新验证

使用临时隔离PostgreSQL schema及明确标记的合成QA事实，没有复制用户Key或写入原用户数据。数据库、应用MemoryService和Agent工具实际执行；没有调用模型、Hy或Jev，也没有把这些QA事实称作真实用户记忆或模型结果。所有临时schema均已在finally删除。

| 验证 | 本轮读回 |
| --- | --- |
| 原问题 | 在03457df原方法下，最近500条不含旧目标；最终源码在10004条有效事实中把它排第一 |
| 来源及投影 | 原source完整保留，结果只有id/content/source，不返回extra或provider标识 |
| 权限与状态 | pending/superseded/deletion_pending、软删除、非memory类型、外owner均不混入；空owner为空 |
| 同分与回退 | 相同时间用ID稳定排序；空白、零命中、tieprobe均符合保留语义 |
| 字面边界 | `%`、`_`、反斜线、引号/SQL样文本、重复词、中文原有字面词和Unicode小写均正确，词项不拼SQL |
| 生产共用入口 | 实际Agent工具调用命中旧目标；简报使用的limit20读回20条。未调用LLM，未宣称完整简报质量通过 |
| 流式内存 | 实际ServerCursor、named=true、yield_per=200；约40,964,096字节正文场景，Python tracemalloc峰1,993,310字节，普通top8为0.1814秒（含跟踪开销） |
| 取消与失败 | 任务取消关闭实际游标；数据库失败传播，无部分结果；后续正常查询成功 |
| 长问题 | 15010字符/2501词在小owner完成；大owner触发预算，实际31.7055秒后TimeoutError且游标已关，后续召回成功 |
| 现有检查 | 最终源码后端51 passed（32.11s，和大词项手工验收并行）；完整Web/API E2E 1 passed（19.2s）；Ruff/TypeScript/ESLint通过 |

首次完整扫描版本的长输入耗时63.7563秒，正是补充取消/预算的依据，保存在[早期性能观察](../evidence/memory-recall-before-budget.json)，不是最终源码结果。[最终源码真实读回](../evidence/memory-recall-completeness-final.json)记录源码SHA-256，可区分版本。期间一条手工验收命令因Python异步生成器用法错误退出；临时schema正常清理，修正命令后完整重新执行，不把失败运行计为通过。

实际EXPLAIN：大owner占10010行中的10004行，正常planner选择Seq Scan+Sort，12.266ms、346 shared hits、0 reads，未强制走索引；选择性owner使用现有`ix_records_owner_kind_status_due`，0.038ms、3 hits、0 reads。两者均为本地小规模暖缓存观察，不是生产负载承诺。应用内存有界不等于总IO/CPU恒定；词法召回仍需读取本owner全部有效正文，数据库可能排序或落盘。

Web/API/Worker已从本轮源码重启，重启前运行中执行数为0；健康检查通过。[本轮既有浏览器流程的记忆页截图](../evidence/memory-recall-current-ui.png)只证明现有UI/API流程正常，不用于证明LLM选择或召回质量。原有E2E覆盖截图已恢复。远程CI和容器验收结果按当前PR回执记录，不预填通过。

## 阻塞、后续与回退

- DeepSeek网络问题沿用之前观察：用户选择先做其他开发，本轮未重试、不绕过SSRF。选定Flash配置保持不变。
- Hy-Memory/Jev真实数据面、索引/缓存清除和provider中断恢复仍待授权；本轮没有外部成功声明。
- 中文语义/分词质量、零命中回退相关性、任务绑定Working Memory与完整模型工具选择/提取/简报质量仍是后续工作。不能以本次完整词法候选修复替代它们。
- 同步SQL及每批CPU不能被asyncio强行抢占，30秒预算允许批次延迟；不承诺硬墙钟超时或超大库低延迟。

回退无需迁移，恢复该方法即可，但会重新引入500条缺口。七天计划和自动化仍继续，未宣称完整候选版已完成。
