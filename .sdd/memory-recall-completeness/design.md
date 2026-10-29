# 设计

复用 `MemoryService.recall`，仅修改查询/选择过程；三个生产入口和账户shared lease不变，删除恢复fence保持原行为。

比较过数据库每词CASE求和及全量ORM排序。前者随20000字符长查询膨胀SQL/规划表达式，后者让大账户内存随所有正文增长。本轮选择现有SQLAlchemy/psycopg服务端游标，每批200条投影 `id/content/data`，标准库 `heapq.nlargest` 仅保留调用者所需的top-k；不自行实现索引或Agent框架。

SQL先过滤owner/kind/status/deleted，按updated_at DESC、id DESC稳定输入；Python沿用原lower/split/子串规则评分。每批将已有top-k与下一批合并后再次选top-k，同分始终保留较早输入。空白查询无词，无需完整扫描，SQL直接limit。非正limit返回空列表。结果仍只有id/content/source，不暴露extra或provider标识。

每批后让出事件循环，公共扫描具有30秒协作式预算，覆盖在模型调用预算之前的聊天/简报预召回。超时、取消及数据库错误均向上传播；with关闭实际游标，不返回部分事实或伪装空列表。同步数据库调用与单批CPU仍不能被asyncio强行抢占，因此不是严格30秒墙钟保证。

时间和读取量仍随本owner有效确认记忆及词项数增长；游标客户端内存按批次和top-k有界，数据库可能需要排序。无全文/向量索引性能承诺。现有owner索引应缩小扫描范围，实际EXPLAIN和Buffers单独记录。用户主动withdraw/删除记录以及外owner不能进入候选。可见聊天历史、Store/Hy删除状态机不变。

回退：无迁移，恢复此方法即可；会重新引入500条缺口，不改存储数据。
