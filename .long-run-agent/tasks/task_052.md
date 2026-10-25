# task_052 agent 互聊
## 需求
选两个角色开对谈（互相以对方输出为输入），用户旁听可插话。
## 要点
1. chat-service 扩展 A2A 回合：发起者 prompt=议题 → B 收到「与 A 讨论：议题+A 的观点」→ 循环 N 轮（默认 3，可调）
2. 抽屉多角色视图：同屏双方气泡（A 左 B 右变体），用户消息注入双方上下文
3. 每轮超时与中断（复用 abort）；记录落双方 character_chat_messages（role 标注对方 id）
4. UI 入口：选中两单位（框选 2 个）→ 抽屉「让它们聊聊」+议题输入
## 验收
- 两 agent 实测互聊 3 轮，历史可回看
- typecheck/jest 全绿

## 验证结果（task_052，2026-10-25）
- `npm run typecheck`：通过（零错误）。
- `npx jest --silent`：144 suites / 3219 passed + 6 skipped（基线 3182 passed → +37 新用例，无回归）。
  - 新增 `src/app/__tests__/agent-chat-service.test.ts`（18 用例）：回合编排（正常 3 轮 6 回合、prompt 链、persona 仅首发、会话隔离 A/B session 各归各）/ 超时中断 / 停止（AbortSignal → aborted → 「（已中断）」）/ 插话注入（双方下一轮各一次「用户补充：」前缀）/ 落库约定（开题 user 双份 + 每轮 assistant 原文与 [peer:id] 前缀副本双份）/ exp chat_round 每回合一发不双计 / 守门（未检出 / 未绑定 / 不在档）与单飞 / 轮数钳位。
  - `src/hud/__tests__/character-chat-drawer.test.ts` +15 用例：框选 2 入口条件（双方角色 → 开抽屉亮「让它们聊聊」；单角色 / 三选 / 同角色不算）/ 议题表单（3/5/8、空议题禁开始）/ onPeerChatStart / 双方气泡区分（A=assistant 左、B=peer 右带名字行，流式同侧）/ 轮次进度「第 2/3 轮」/ 插话（Enter → onPeerInterject + user 气泡，不走 onSend）/ 停止钮 → onPeerChatStop / endPeerChat 复位 / running 中单选切走抑制、ended 后恢复 / 联合 id 不走历史回填 / 单角色历史 peer 气泡渲染；catalog 追加 peerChatSessionId / appendStreamAs（显式归属+角色、冲突收束、peer 流补 peerId）纯逻辑 3 用例。另按 052 新语义更新既有「多点不动抽屉」用例。
  - `src/app/__tests__/persistence/chat-history.test.ts` +4 用例：[peer:id] 前缀解析（role=peer + peerId + 剥前缀）/ 普通行与缺空格前缀不受影响 / error 与 user 行不解析。
- 决策记录：库表 role 三词表（user|assistant|error）不动，peer 身份走 content 前缀 `[peer:{发言者id}] `（chat-history 翻译层解析）——036 的 CHECK 约束与 DAO/IPC 校验零迁移；HUD 内存会话词表扩 'peer'（第四个渲染角色，不落库）。
- 未尽事项：联合会话为运行时视图（重启后经双方各自历史回看，不重建联合流）；讨论中「退出互聊」仅离开视图不停止讨论（停止走停止钮）；062 战场说话气泡未动（按需求④）。
