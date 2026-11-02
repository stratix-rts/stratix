# agent_task_095 —— 会话面板（S5）工作文档

> 任务：v3.2a S5（task_095）—— 会话管理的 UI 入口：列表 / kind 筛选 / 状态徽标 / 中断命令 / 历史抽屉。
> 方案：docs/SESSION-PLAN.md §4（HUD 会话面板段）。
> 前置：S1 域模型（task_091，9a750c4）、S2 存储 + 读 API（task_092，015f2d2）、S3 组合根接线（task_093，2db46b0）、
> S4 互聊接入会话域（task_094，e81b328）。
> 日期：2026-11-02。

## 1. 交付物

| 文件 | 职责 |
|---|---|
| `src/hud/panels/session-catalog.ts` | 面板**纯逻辑层**：kind 筛选档表 / 中文标签 / 可中断判定 / 可恢复提示 / 可见会话（筛选+排序）/ 标题截断 / 相对时间 / 历史条目与读取口形状 / 任务单引用投影 / 命令行消息投影 |
| `src/hud/panels/session-panel.ts` | 面板组件 `<strat-session-panel>`：列表 / kind 筹码 / 状态徽标 / 行内「中断」钮（发 `session.interrupt`）/ 历史抽屉（kind 路由 + 分页 + 竞态守卫 + 卸载退订） |
| `src/app/services/session-history/session-history.ts` | **app 层读面**：两路真 IO（角色对话历史走 preload 通道 / 会话事件流走 service 只读 REST）+ 与 hud 侧结构同形的 `SessionHistoryPort` |
| `src/hud/screens/main-screen.ts` | 入口接线：右栏会话面板槽位 + 顶栏「会话面板」按钮 + `MainScreenOptions.sessionHistory` 注入口 |
| `src/app/main/main-entry.ts` | 组合根接线：`createSessionHistoryPort({ baseUrl })` 注入主屏（远程 → world-sync 端点换协议；本地 → 127.0.0.1:7524） |
| `src/hud/__tests__/session-panel.test.ts` | 面板单测 29 例（真组件 + 真 Shadow DOM + 真事件链，只替总线与读取口） |
| `src/app/__tests__/session-history.test.ts` | 读面单测 20 例（注入假 fetch 与假 chatHistory 口） |
| `.long-run-agent/tasks/task_095.md` | 验收勾选 + 实现记录 + 验证输出（原样贴入） |
| `docs/rubric/agent_task_095.md` | 本工作文档 |

## 2. 关键设计决策

1. **纯逻辑抽 catalog，组件只负责画**：`session-catalog.ts` 无 IO 无 DOM（与 command-catalog / log-catalog
   同一惯例），可单测的判断（能不能中断 / 筛出哪几条 / 标题怎么截 / 时间怎么写）全在这里；
   组件文件只剩「模型 → Shadow DOM」。hud 的纯逻辑零 IO 是分层铁律的延伸，不是风格偏好。
2. **历史读取口用「结构同形」注入**（仓库既有做法，如 core/session 的 `SessionPersistPort` ↔ app 层同款）：
   hud 侧声明 `SessionHistoryPort`，app 侧另写一份**形状相同**的接口，组合根接线 → 类型系统替我们守住
   不兼容。**app 不 import hud、hud 不 import app**（依赖方向不倒挂），hud 仍只依赖 core/types 契约。
3. **四路 kind 路由按「真相在哪」分流**（不是按「哪个好写」）：
   - character_chat → 历史在 `chat_messages` 表（渐进迁移铁律：旧表不搬）→ preload 通道读；
   - peer_chat / task_run → 历史在 `session_events` 表（S2 落的）→ service 只读 REST 读；
   - mission_run / shell_link → 真相**就在 WorldState 里**（任务单视图 / messages 投影）→ 直接投影，
     不发 IO（再走一遍 IO 就是多一份可能过期的真相）。
4. **空态五档，互不混同**：无会话（引导文案）/ 该筛选下没有（是筛选结果）/ 读取器未附着（"未附着"）/
   读取失败（"失败" + 重试）/ 读到空（"没有可读的历史记录"）。**绝不显示假空数据** —— 读不到就说读不到。
5. **中断钮只给 active/idle**：interrupted / closed 是不可再来一次的相位（core 状态机会拒绝重复中断并回
   Notice）—— 按钮点不动的事实不该由用户点一次才知道。interrupted 改给「已中断 · 恢复续聊待上线」的提示
   （恢复属 2b）。
6. **抽屉竞态守卫 + 滚动锚**：切会话时丢弃旧请求结果（否则上一条会话的历史会画到新会话下）；
   前插更早一页后把滚动视口锚回原处（否则新内容一进来就把用户顶走）。
7. **面板常驻右栏 + 顶栏按钮双入口**：折叠时只留标题栏（不占布局），顶栏「会话面板」按钮与面板自身的
   「展开/收起」chip 都能切换 —— 入口常驻可见（这正是用户点名要的「多会话管理」的入口）。
8. **零轮询**：面板只订阅 `WorldState.sessions` 广播（core 一改就刷新）；历史只在用户点开抽屉时读一次。
9. **双 token 皮肤**：全部视觉走 `--srf-*` 变量（面板里 grep 不到颜色字面量）；状态色用
   `--srf-success` / `--srf-text-muted` / `--srf-warn` / `--srf-text-disabled` 对应任务书的
   「绿 / 灰 / 橙红 / 暗淡」。
10. **不动 core / world / gateway**：本单只在 hud + app 两层落代码，`git diff src/world` 为空。

## 3. 验证

- `npx tsc --noEmit` → 0 错（无输出）
- `npx jest src/hud --silent` → `Test Suites: 37 passed, 37 total / Tests: 791 passed, 791 total`
- `npx jest --silent`（全量）→ `Test Suites: 202 passed, 202 total / Tests: 6 skipped, 4096 passed, 4102 total`
- `git diff src/world` → 空

## 4. 未尽事项

- **本地直连模式下会话事件不在渲染侧库里**（组合根 sessionManager 无 persist 口，两张表的写口在 service
  进程的 storage.ts）→ 本地模式下 peer_chat/task_run 的抽屉如实显示"没有可读的历史记录"（不是假数据）；
  补齐需 IPC 落库通道，属 S7。
- **远程模式**读 service 的只读 REST（`GET /api/storage/sessions/:id/events`），基址由 world-sync 端点换协议得出。
- **恢复续聊（interrupted → active + 上下文回灌）**按方案放 2b；本单只落提示与徽标。
- **MCP 工具（S6）**未做。
- **任务单详情引用**目前只给「标题 · 相位」一行（WorldState.missions 目前没有更多可展示字段）；
  将来任务单正文进广播后投影可再丰富。
