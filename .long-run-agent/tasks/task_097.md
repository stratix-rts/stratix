# task_097 e2e: 会话域验收剧本——互聊超时→面板可见 interrupted→历史可查

## 描述

v3.2a S7 收口单：v3.2a 的总验收。依赖 S4/S5/S6（task_094/095/096）。模式参考 e2e-tests/service-resident.e2e.mjs（2026-11-02 已沉淀的启动/断言/清理惯例）。

## Requirements

新剧本 `e2e-tests/session-domain.e2e.mjs`（node 直跑可重复，exit code 语义）：

1. 起 service（备用端口，⚠️ 不碰 7524/7523/9222 用户实例；清理只杀自记 pid）
2. 剧本链（fake CLI adapter 确定性）：
   - 互聊开场 → session_list（MCP）可见 peer_chat active
   - 制造超时（fake adapter 脚本化 no-output）→ 状态变 interrupted + 事件含中断标记
   - task_assign → task_run 会话 LITE 记录随终态 closed
   - REST session_events 分页读取互聊历史（中断前后事件齐全）
   - HUD 侧：world-sync 快照含 sessions（面板数据源验证，不需要真开 Electron——快照断言即面板输入面；如剧本可轻量拉 Electron 远程模式则加分项非必须）
3. 断言 ≥10 条，全带上下文输出；最后 30 行贴任务 md。
4. README（e2e-tests/）登记新剧本。

## Acceptance

- [x] node e2e-tests/session-domain.e2e.mjs 跑通 exit 0 可重复（连跑两遍）
- [x] 断言覆盖上述五链路
- [x] 无孤儿进程（自记 pid 清点）
- [x] npx tsc --noEmit 0 错 + npx jest 全绿

## deliverables

- e2e-tests/session-domain.e2e.mjs + README 登记 + 实跑输出记录

## 落地记录（2026-11-02）

### 交付物

| 文件 | 职责 |
|------|------|
| `e2e-tests/session-domain.e2e.mjs` | 验收剧本（自起自收，20 条断言） |
| `e2e-tests/session-domain/service-process.ts` | service 进程启动器 + 互聊夹具（生产口径接线 + 一条测试专用路由 `POST /e2e/peer-chat`） |
| `e2e-tests/session-domain/peer-cli.ts` | 静默 CLI adapter（超时制造机；只替最末端那一跳） |
| `e2e-tests/lib/service-harness.mjs` | 公用夹具（起服务 / 断言 / 回收 pid / MCP / world-sync）——端口与进程纪律集中一处 |
| `e2e-tests/README.md` | 剧本登记（用法 / 五链路 / 替身口径 / 端口表 / 环境变量） |

### 设计要点

- **互聊怎么在 headless 进程里跑**：互聊编排服务住在渲染进程（抽屉 DOM 在那儿），service 进程里没有它 ——
  `service-process.ts` 按**生产口径**装起来（视图口 = 记录型空实现，执行环 = 静默 adapter，
  会话写入面 = 绑**同一份 worldStore + 同一个库连接**的 SessionManager，gateway 不暴露组合根的 manager）。
- **超时怎么造**：静默 adapter 让子进程真跑、真的不吭声 → cli-transport runtime 自己的看门狗判超时
  （killTree → `error{code:'timeout'}`）→ agent-chat-service 记中断 → 会话转 `interrupted` + 落 `interrupt` 事件。
  **超时判定 / 杀进程树 / 错误码 / 中断记账 / 状态迁移全是真链路**，替身只造「一直不输出」这个前提。
- **端口纪律**：service 7817 / 状态 WS 7818（备用）；7523 / 7524 / 9222 一个不碰；清理只按自记 pid 精确回收。

### 实跑输出（最后 30 行；第二遍，`exit 0`）

```
[e2e] ✓ world-sync 快照含 sessions（面板数据源） — sessions=2 条（含 peer_chat 与 task_run）
[e2e] ✓ 快照里的 peer_chat 状态与库里一致（interrupted） — snapshotStatus=interrupted
[e2e] ✓ 超时后静默子进程已被回收（看门狗杀进程树，不留孤儿） — service 树 1 个后代，静默子进程 0 个
[e2e] 已回收 service（pid 89172，连同 1 个后代）
[e2e] ✓ 剧本拉起的进程全部收干净（无孤儿） — 无残留
[e2e] 收尾完成：只回收了本剧本拉起的 pid，用户实例未受影响
──────────────── 验收摘要 ────────────────
✅ service 进程起来了（gateway 单进程，备用端口） —— pid=89173 port=7817 peerTimeout=10000ms
✅ world-sync 端点可连（观察客户端收到全量快照） —— seq=2
✅ 两个角色建档并绑定 agent（互聊守门的前提） —— E2E互聊甲506257/E2E互聊乙506257 → claude-code
✅ 互聊已开场（测试夹具受理，回合超时按覆盖链生效） —— timeoutMs=10000
✅ 互聊开场可见：MCP session_list 里有 peer_chat 且 active —— session=session_peer_chat_1793593506262_1 status=active title=互聊：E2E 会话域验收议题：超时也要…
✅ peer_chat 会话参与者是互聊双方（开场即建会话） —— participants=character_1793593506257_1,character_1793593506258_2
✅ 互聊超时 → 会话显式 interrupted（不再是静默丢失） —— session=session_peer_chat_1793593506262_1 status=interrupted
✅ MCP session_get 读得到事件流（含中断标记） —— events=created,message,interrupt
✅ 事件流齐全：created → message（议题）→ interrupt —— seq=1,2,3 types=created,message,interrupt
✅ interrupt 事件带中断原因（超时可归因） —— reason=timeout：调用超时，已终止进程
✅ REST 读事件流：中断前后齐全（created/message/interrupt） —— events=created,message,interrupt
✅ REST 分页取窗口：最新两条是 message + interrupt —— window=2:message,3:interrupt
✅ REST 游标翻页：中断之前的事件也能翻到 —— cursor=1:created
✅ 任务 completed（执行走 fake CLI adapter：真链路 + 末端替身） —— task=task_1793593516481_1 status=completed
✅ task_run 会话随终态 closed（LITE 口径） —— session=session_task_run_1793593516512_1 status=closed ref=task_1793593516481_1
✅ task_run 会话事件：created + closed 两条（LITE 不搬执行细节） —— events=created,closed
✅ world-sync 快照含 sessions（面板数据源） —— sessions=2 条（含 peer_chat 与 task_run）
✅ 快照里的 peer_chat 状态与库里一致（interrupted） —— snapshotStatus=interrupted
✅ 超时后静默子进程已被回收（看门狗杀进程树，不留孤儿） —— service 树 1 个后代，静默子进程 0 个
✅ 剧本拉起的进程全部收干净（无孤儿） —— 无残留
断言：20/20 通过
结论：PASS（会话域：互聊超时可见可查）
────────────────────────────────────────────
```

### 验证记录

| 检查 | 结果 |
|------|------|
| `node e2e-tests/session-domain.e2e.mjs`（第一遍） | exit 0 —— 20/20 断言通过 |
| `node e2e-tests/session-domain.e2e.mjs`（第二遍） | exit 0 —— 20/20 断言通过 |
| `npx tsc --noEmit` | 0 错（exit 0） |
| `npx jest --silent --maxWorkers=2` | 203 套 / 4111 通过 / 6 跳过，exit 0 |
| 孤儿进程清点 | 剧本自记 pid 全部回收；静默子进程已被看门狗收掉；7817 / 7818 无残留监听 |

### 五链路对照

| 链路 | 断言 |
|------|------|
| peer_chat 开场可见 | MCP `session_list` 见 `peer_chat` 且 `active`；参与者是互聊双方 |
| 超时 → interrupted + 事件标记 | 转 `interrupted`；`interrupt` 事件带 `timeout：调用超时，已终止进程` |
| task_run LITE 随终态 closed | `task_run` 会话 `closed` + `ref_id` 指向任务；事件 `created` + `closed` |
| REST 事件分页含中断前后 | 全量页 `created/message/interrupt`；窗口页取最新两条；`beforeSeq` 游标翻到 `created` |
| world-sync 快照含 sessions | 快照里 peer_chat / task_run 都在，且 peer_chat 状态与库一致 |

