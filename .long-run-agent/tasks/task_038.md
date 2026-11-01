# task_038: 战场工作状态表现 + 派发表单

## 描述
单位工作时战场可视化 + 任务派发 UI 入口。

## 需求
1. 战场表现：working 状态动画（做 2 个变体：头顶进度环 / 头顶工具气泡+身体动画加速，用户验收时挑，先实现进度环默认）+ done 短暂打勾提示 + failed 红色叹号
2. 派发表单：点单位 → 单位卡片/菜单加「派任务」→ 弹出自由文本框（textarea+提交）→ task.assign
3. 队列可见性：单位卡片显示当前任务摘要+排队数
4. 单测：表单提交→命令发射；状态→表现映射（world 层桩测试）

## 依赖
- 037（命令+状态事件）

## 验收标准
- [ ] tsc 零错误；npx jest 全绿
- [ ] hud 不 import world（经总线事件）
- [ ] dev 手测：派任务→单位动起来→完成提示

## 验证方式
npm run typecheck && npx jest --silent

## 验证结果（task_038 执行完成后补记）

**验证输出（2026-10-24）**：`npm run typecheck` 零错误；`npx jest --silent` 121 suites / 2737 passed + 6 skipped（基线 2700+，新增 37 项全绿无回归）。

### 交付清单

**world 侧（表现）**
- `src/world/objects/task-fx.ts`（新）：任务生命周期→单位表现的纯映射层 —— `TaskFxBoard` 状态板（started→working / completed→done（1.5s 淡出，注入时钟）/ failed→failed（驻留到下次状态变化））、`visibleMarker` 裁决（**busy 派生永远画环**：读档恢复无事件重放也能画；无 busy 支撑的 working 视为陈迹不画）、`applyTaskFxEvent`（characterId→单位集合落地）、`TASK_FX_STYLE` 样式常量（**变体钩子**：variant='ring' 全部参数集中一处，后续 'bubble' 换绘制分支即可，状态板零改动；色值镜像 hud token：✓=srf-success、!=srf-danger、环=busy 态色）
- `src/world/objects/task-fx-layer.ts`（新）：Phaser 绘制层 —— 旋转缺口环 / ✓+底衬圆淡出 / !驻留；全场共用一个 tick 定时器（同 unit-layer 纪律）；换相复用节点不销毁重建
- `src/world/bridge/bus-adapter.ts`（改）：桥接层新增订阅 world 通道，筛 task.started/completed/failed 三条转可选端口钩子 `syncTaskEvent`（可选成员：老桩不破）；destroy 双退订
- `src/world/scenes/BattlefieldScene.ts`（改）：接线 board+layer；syncUnits 对 removed 单位清浮标（表现不悬空）；syncTaskEvent 落地；shutdown 销毁
- `src/world/objects/index.ts`（改）：barrel 补导出（node 单测仍直连 task-fx 绕开 Phaser）

**hud 侧（表单+队列）**
- `src/hud/panels/agent-catalog.ts`（改）：`resolveCharacterTaskQueue`（running 优先、否则 FIFO 队首；40 字截断+排队数）、`buildTaskAssignCommand`（空指令/无角色→null 不发）、UnitDetailModel 增 characterId+taskQueue、渲染签名纳入队列读数（任务离队/排队数变化才重画）
- `src/hud/panels/agent-panel.ts`（改）：单选详情增「队列」行（摘要+`+N` 徽标）与「派任务」按钮（仅有关联角色的单位）；表单挂**外壳**不随 body 重建（无关广播不冲草稿），textarea 2-4 行 + maxlength=MAX_TASK_PROMPT_LEN + Ctrl/Cmd+Enter 快捷派发；提交经注入的 adapter.dispatch 发 task.assign（hud 不 import core runtime，同现有命令发射模式）；切换单位/编组/清空选择时表单自动收起清空

### 单测覆盖（37 个新测试）

- `src/world/__tests__/task-fx.test.ts`（15）：board 三类落点/done TTL 惰性剔除/failed 驻留/换相顶替/clear；visibleMarker 裁决（busy 压过 ✓!、无 busy 的 working 不画）；applyTaskFxEvent 0/1/N 命中；**桩场景全链路**（真总线+真桥+真 registry：started→busy 环 / 读档恢复仅 busy 也画环 / completed→✓ / failed→!驻留+离场清除 / queued 不产生表现）
- `src/world/__tests__/bus-adapter.test.ts`（+4）：三条任务事件转发原样带快照、queued 不转发、port 不实现钩子不炸、destroy 退订
- `src/hud/__tests__/agent-catalog.test.ts`（+10）：队列读数（running 优先/FIFO 队首/角色隔离/40 字截断）、命令构造守门、详情字段、签名对队列敏感且不被别人任务误触发
- `src/hud/__tests__/agent-panel.test.ts`（+8）：入口渲染条件（无角色无按钮无队列行）、打开→提交→命令端口收到 task.assign（trim）+关闭清空、取消零命令、空指令不发保持开、Ctrl+Enter、切换单位自动收起、无关广播/队列变化不冲草稿、+N 徽标与空闲态渲染

### 验收对照

- [x] tsc 零错误；npx jest 全绿（2737 passed，无回归）
- [x] hud 不 import world（hud 只发 task.assign 命令；world 只订阅 task.* 事件，两侧经总线）
- [ ] dev 手测：派任务→单位动起来→完成提示 —— **留待人工验收**（需 Electron+真实 CLI agent 环境；表单→命令→事件→表现的每一环已有单测桩链路覆盖，绘制层的环/✓/! 形状需肉眼确认）

### 遗留事项（归 039+）

- 'bubble' 工具气泡变体（身体动画加速需单位精灵动画层配合）：TASK_FX_STYLE.variant 词表与绘制分支已预留位，状态板零改动即可接
- failed 任务的「一键重派」入口（037 遗留，随表单）：表单在，重派按钮未做（failed 任务摘要只在 ! 浮标与卡片队列读数中，无点击动作）
- 任务历史回填 UI（loadTasks IPC 已就绪）：卡片只显示在办队列，终态任务历史不展示
