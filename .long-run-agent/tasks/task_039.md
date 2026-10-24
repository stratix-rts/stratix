# task_039: 任务结果回流 + exp 事件发射

## 描述
任务完成结果回流到对话流/报告，发射经验事件供养成消费。

## 需求
1. 结果回流：task.completed → 结果摘要进 chat-drawer（该角色会话内 system/assistant 消息，带「任务报告」标记样式）
2. exp 事件：core 总线定义 `exp.gained`（source: task_completed/chat_round/task_failed 部分经验等），app 层在对应时机发射（chat_round 在 035 基础上补发射点）
3. 通知：单位完成时战场侧 toast/气泡（轻提示，不打断）
4. 单测：回流消息注入/事件发射时机/失败也发事件

## 依赖
- 037/038（任务生命周期）、035（chat 写入路径）

## 验收标准
- [ ] tsc 零错误；npx jest --silent 全绿
- [ ] 完成任务后对话流可见报告 + exp.gained 事件可观测（单测断言）

## 验证方式
npm run typecheck && npx jest --silent

## 验证结果（2026-10-24，执行者：task_039 编码 agent）

- `npm run typecheck`：零错误（含新增文件 toast-host / task-report / exp-config，以及 WorldEvent 扩展的下游穷举 switch 修补 world/dev/main.ts）
- `npx jest --silent`：**123 套件 / 2775 通过 + 6 跳过**（基线 2737 → +38 新用例，零回归）
- 新增/扩展测试：
  - `src/app/__tests__/task-report.test.ts`（19）：报告文案格式（前缀/摘要 40 截断/输出 2000 截断/失败文案）/ toast 文案 / 注入裁决（内存超集保护）/ 三路副作用 / 一路抛错不绑架其余
  - `src/app/__tests__/task-service.test.ts`（+6）：completed 回调带全文 + exp(task_completed,50)；error/守门/外部 task.failed 各恰好一次 + exp(task_failed,10)；注入权重换算；权重 0 不发；回调抛错不绑架执行
  - `src/app/__tests__/chat-service.test.ts`（+7）：done 轮发 chat_round(5)、多轮每轮一条、注入权重、error 轮/守门拒绝/中断轮不发、空回复占位轮照发
  - `src/hud/__tests__/toast-host.test.ts`（5）：上屏/语气 data-tone/textContent 直写（XSS）/3s 自动消失/堆叠各自过期/挂卸清计时器
  - `src/core/__tests__/runtime.test.ts`（+1）：exp.gained 接地（不进 onUnhandled、不改状态）
- 落地说明：
  - core：`WorldEvent` 增 `exp.gained`（characterId/source/amount）+ `ExpSource` 词表；runtime 显式接地
  - 权重：`src/app/services/exp-config.ts`（task_completed=50 / task_failed=10 / chat_round=5），发射点经注入 `expWeight` 取数 —— **040 progression 接管时换注入件即可**（types.ts / exp-config.ts / task-service.ts / chat-service.ts 四处文件头已互相注明交接）
  - 回流：`src/app/services/task-report.ts`（纯函数 + createTaskReportHandler），完成报告=「📋 任务报告：」+ 指令摘要 40 + 输出全文/2000 截断（role=assistant）；失败=「⚠ 任务失败：原因」（role=error，错误气泡样式）；经抽屉 addMessage 注入（条件注入保 036 回填不被孤报告挡住，裁决与已知窄窗见该文件头）+ 落 character_chat_messages（与聊天共用 persister）
  - 轻提示：`src/hud/components/toast/toast-host.ts`（`<strat-toast-host>` WebComponent，右上角、3s 自动消失、皮肤 token、textContent 直写防注入）；组合根挂载并接 task-report 的 toast 口
  - 发射点：task-service 终态发 exp（failed 挂 handleEvent 的 task.failed 分支 —— 总线是失败相位唯一真相源，恰好一次不双发）；chat-service done 收束后发 chat_round（error/守门/中断/防御流尾不计）
- 未尽事项 / 交接：
  - task_040：progression 模块接管权重（替换组合根注入的 expWeight），消费 exp.gained 做等级累计；可考虑 WorldState.characters.experience 的写入面
  - 已知窄窗（接受，与 036 回填竞态同口径）：抽屉正看某角色且回填在途时报告注入 → 旧历史本轮不可见，重启恢复（库全量）
