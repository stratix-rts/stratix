# task_095 hud: 会话面板——列表/筛选/状态徽标/中断按钮/历史抽屉

## 描述

v3.2a S5：会话管理的 UI 入口（用户点名的「看不到多会话管理」）。方案 docs/SESSION-PLAN.md 第 4 节 HUD 段。依赖 S3（task_093）。

## Requirements

1. 新面板 `src/hud/panels/session-panel.ts`（严格遵循 hud/panels 既有模式——先读 mission 面板与 chat-drawer 的结构惯例；WebComponents+双 token 皮肤）：
   - 会话列表：kind 筛选 chips（全部/聊天/互聊/任务/编队/连接）+ 状态徽标（active 绿/idle 灰/interrupted 橙红/closed 暗淡）
   - 数据源：WorldState.sessions 订阅（实时刷新零轮询）；title 显示自动起名
   - 进行中（active/interrupted→可恢复提示）会话行内「中断」按钮 → emitCommand session.interrupt
   - 历史抽屉：点击会话行展开，kind 路由到对应读取器——character_chat 走 chat-history API、peer_chat/task_run 走 session-events API（S2 REST）、mission_run 显示 mission 详情引用、shell_link 显示 messages 投影；分页（滚动到顶加载更早）
2. 总线铁律：hud 只依赖 core/types 契约 + app 服务层；不 import world/gateway 内部。
3. 空态/边界：无会话（引导文案）、事件缺失（未附着语义，绝不显示假空数据）、长 title 截断。
4. 入口：HUD 侧栏按钮（照现有面板入口模式，常驻可见——这就是「多会话管理」的入口）。

## Acceptance

- [x] 面板组件单测：列表渲染/筛选/徽标/中断命令发出/空态
- [x] 历史抽屉 kind 路由单测（mock 数据源）
- [x] git diff src/world 为空（总线铁律）
- [x] npx tsc --noEmit 0 错 + npx jest 全绿

## deliverables

- src/hud/panels/session-panel.ts（+样式走双 token）+ 入口接线 + 单测

---

## 实现记录（2026-11-02）

### ① 交付物

| 文件 | 职责 |
|---|---|
| `src/hud/panels/session-catalog.ts` | 面板的**纯逻辑层**：kind 筛选档表 / 中文标签 / 能不能中断 / 可恢复提示 / 可见会话（筛选 + 排序）/ 标题截断 / 相对时间 / 历史条目形状 / 任务单引用投影 / 命令行消息投影（无 IO 无 DOM，可单测） |
| `src/hud/panels/session-panel.ts` | 面板组件 `<strat-session-panel>`：列表 / kind 筹码 / 状态徽标 / 行内「中断」钮（发 `session.interrupt`）/ 历史抽屉（kind 路由 + 分页 + 竞态守卫） |
| `src/app/services/session-history/session-history.ts` | **app 层读面**：会话历史的两路真 IO（角色对话历史经 preload 通道 / 会话事件流经 service 只读 REST）+ 与 hud 侧结构同形的 `SessionHistoryPort` |
| `src/hud/screens/main-screen.ts` | 入口接线：右栏挂会话面板槽位 + 顶栏「会话面板」按钮（toggle）+ `MainScreenOptions.sessionHistory` 可选注入口 |
| `src/app/main/main-entry.ts` | 组合根接线：`createSessionHistoryPort({ baseUrl: 远程 ? world-sync 端点换协议 : 本机 7524 })` 注入主屏 |
| `src/hud/__tests__/session-panel.test.ts` | 面板单测 29 例（列表渲染 / 筛选 / 徽标 / 中断命令 / 空态三档 / 历史抽屉四路 kind 路由 / 未附着 / 读取失败 / 分页 / 竞态 / 卸载退订 / 主屏装配） |
| `src/app/__tests__/session-history.test.ts` | 读面单测 20 例（事件信封→条目 / 库行→条目 / ws→http 换算 / 两路 IO 的调用形状与失败口径） |

### ② 关键设计决策

1. **纯逻辑抽 catalog、组件只画画**：筛选 / 徽标 / 截断 / 相对时间 / 两路投影全在 `session-catalog.ts`
   （无 IO 无 DOM）——与 command-catalog / log-catalog 同一惯例；组件文件只剩「模型 → Shadow DOM」。
2. **历史读取口用「结构同形」的注入法**（仓库既有做法，如 core/session 的 `SessionPersistPort`）：
   hud 侧声明 `SessionHistoryPort`，app 侧另写一份**形状相同**的接口，组合根接线时由类型系统对齐。
   app 层不 import hud、hud 层不 import app（依赖方向不倒挂）。
3. **四路 kind 路由按「真相在哪」分流**：character_chat 的历史在 `chat_messages` 表（preload 通道）、
   peer_chat/task_run 的历史在 `session_events` 表（service 只读 REST）—— 两张表是既成的，
   面板按 kind 路由到各自那张表；mission_run / shell_link 的真相**就在 WorldState 里**
   （任务单视图 / messages 投影），再走一遍 IO 就是多一份可能过期的真相 → 直接投影，不发请求。
4. **空态四档，互不混同**：无会话（引导文案）/ 该筛选下没有（是筛选结果）/ 读取器未附着（说"未附着"）/
   读取失败（说失败 + 给重试）/ 读到空（说"没有可读的历史记录"）。**绝不拿假数据充数**。
5. **中断钮只给 active/idle**：interrupted / closed 都是不可再来一次的相位（状态机会拒绝重复中断并回 Notice），
   按钮点不动的事实不该由用户点一次才知道；interrupted 改成给"已中断 · 恢复续聊待上线"的提示（恢复属 2b）。
6. **抽屉竞态守卫**：切会话时旧请求的结果必须丢弃（否则会把上一条会话的历史画到新会话下）；
   前插更早一页后把滚动视口锚回原处（否则新内容一进来就把用户顶走）。
7. **面板常驻右栏 + 顶栏按钮双入口**：面板折叠时只留标题栏（省布局），顶栏「会话面板」按钮与面板自身的
   「展开/收起」chip 都能切换 —— 入口常驻可见（这正是用户要的「多会话管理」的入口）。
8. **零轮询**：面板只订阅 `WorldState.sessions` 广播；历史只在用户点开抽屉时读一次（分页另算）。

### ③ 验证记录

命令（任务书指定）：`npx tsc --noEmit && npx jest src/hud --silent`

```
Test Suites: 37 passed, 37 total
Tests:       791 passed, 791 total
Snapshots:   0 total
Time:        4.872 s
```

`npx tsc --noEmit` → 无输出（0 错）。

本任务新增套件：`npx jest src/hud/__tests__/session-panel.test.ts --silent` → 29 passed；
`npx jest src/app/__tests__/session-history.test.ts --silent` → 20 passed。

全量：`npx jest --silent` → `Test Suites: 202 passed, 202 total / Tests: 6 skipped, 4096 passed, 4102 total`。

总线铁律：`git diff src/world` → 空（无输出）。

### ④ 未尽事项

- **本地直连模式下会话事件不在渲染侧库里**（组合根的 sessionManager 没有 persist 口，两张表的写口在
  service 进程的 storage.ts）→ 本地模式下抽屉对 peer_chat/task_run 会如实显示"没有可读的历史记录"
  （不是假数据）；补齐需 IPC 落库通道，属 S7。
- **远程模式**：会话事件读 service 的只读 REST（`GET /api/storage/sessions/:id/events`，S2 落地的），
  基址由 world-sync 端点换协议得出（ws→http / wss→https）。
- **恢复续聊（interrupted → active + 上下文回灌）**按方案放 2b；本单只落提示与徽标。
- **MCP 工具（S6）**未做；面板的中断命令目前只到 HUD→core 方向（core 侧裁决）。
- **任务单详情引用**目前只给「标题 · 相位」一行（WorldState.missions 里没有更多可展示的字段）；
  若将来任务单正文进广播，投影可再丰富。
