# 删除恢复设计

## 代码证据

- services/memory.py::delete 先commit墓碑，再adelete；owned排除已删除，失败后404。
- main.py::resolve_approval 只接pending；先执行CAS再进入tools.execute_approval独占lease，允许重入会产生失败回写覆盖风险。
- tools.py::_execute_approval 的checkpoint循环限10000且不含软删会话；完成标志未独立落库。
- MemoryService.confirm提交后异步aput没有shared lease，可能晚于删除而复活。
- accounts.account_lease、records.cas_update/owned、审批/Record.extra均可复用。新恢复入口复用POST resolve的version与结果投影风格，不接受新目标。

## 决策

DES-01→REQ-01/02：Record.extra.memory_deletion保存approval_id/requested_version、store/checkpoints/provider/state、checkpoint_cursor与安全error_type。首次CAS原live version并同时擦除正文/来源/用户extra。续做可读取同owner的软删memory，严格匹配journal绑定；重复阶段删除为幂等。只有Store和全部检查点成功且provider无需求/被完整核实才标deleted/complete。

DES-02→REQ-03：按Record.id升序分批读全部owner chat_session（不排除软删），SDK逐条删除；整批成功后保存cursor，中途失败允许重放该批。SDK删除前缀始终owner:session_id，无固定总数上限。会话历史消息保留，UI回执说明。

DES-03→REQ-04：memory删除resolve/resume外层lease覆盖认领与最后commit，execute嵌套复用；确认方法全程shared lease。中断间隙的shared lease还检查未完成Store/checkpoint journal，暂拒绝新Agent/确认写入，防止已扫游标前缀被填回；仅provider待授权而本地已完成不阻塞。恢复执行中的操作时先拿exclusive lease，忙时409且不改审批。CAS保护版本；完成后的重放返回原回执，不再次清理新增会话。

DES-04→REQ-01/05：POST /approvals/{id}/resume仅memory.delete，body正version；failed/outcome_unknown/executing/cleanup_pending可恢复，已完成同版本返回持久回执。未开始仍遵守到期及live version；已绑定墓碑可过期继续。旧失败墓碑只在原version+1、旧删除形状、唯一匹配的已授权审批时兼容收养；歧义fail closed。GET approvals支持分页并投影恢复资格及持久阶段，避免被最新100条隐藏。

DES-05→REQ-06：本地擦除成功不等于provider完成。Hy未授权provider=authorization_required；仅SDK成功/ID不存在不足以验证索引缓存。202 pending回执不成为approved成功。外部无授权不发请求。

发布：API/Worker后Web；无迁移。回滚代码保留extra journal，旧代码不能恢复新journal，需完成进行中清理后回滚或保留API版本。故障验收仅独立QA owner和临时schema，注入失败不伪造provider响应。
