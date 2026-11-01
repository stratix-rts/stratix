# task_034: chat-drawer 右侧抽屉 UI

## 描述
右侧抽屉聊天组件：消息列表、输入框、点战场单位切上下文、流式渲染接口。本任务纯 UI，transport 打桩。

## 需求
1. `src/hud/components/chat-drawer/`（WebComponents + 皮肤 token，风格对齐现有 hud）
2. 结构：头部（当前角色名+关闭钮）/消息列表（user/assistant 气泡，滚动到底）/输入框+发送钮
3. 点战场单位 → 打开抽屉并切到该角色会话（经总线事件或 hud 内部状态，hud 不 import world）
4. 流式接口：组件暴露 `appendStream(chunk)`/`finalizeStream()`/`addMessage(msg)` 公开方法——本任务用定时器假流演示（仅测试/演示路径，正式数据走 035）
5. 单测：开关/切角色/消息追加/流式 append/finalize

## 上下文
- hud WebComponents 惯例看 `src/hud/` 现有组件；皮肤 token 用 CSS 变量（8 套皮肤已注册）
- 点单位事件：world→core 总线→hud 订阅（看 BattlefieldScene 现有选中事件链路）

## 验收标准
- [ ] tsc 零错误；npx jest src/hud 全绿
- [ ] 组件不 import world/core 渲染层（总线隔离）
- [ ] 文件头契约注释

## 验证结果（2026-10-24，执行者回填）

### 交付物
- `src/hud/components/chat-drawer/chat-catalog.ts` —— 纯逻辑：多角色会话存储（characterId → 独立消息数组，100 条截尾）、流式缓冲（appendStream 增量 / finalize 收束，流归属发言角色不随视图串台）、头部派生（resolveCharacterHeader，kind 词表复用 onboarding-catalog 的 AGENT_KIND_LABELS 单一真相源）、发送闸门（sendableDraft）
- `src/hud/components/chat-drawer/chat-drawer.ts` —— Web Component `<strat-character-chat-drawer>`：右侧滑入滑出（transform 220ms + visibility 过渡）、头部（角色名 + kind 徽标 + 关闭钮）、消息列表（user 右 / assistant 左，自动滚底）、输入框 + 发送钮（Enter 发送 / Shift+Enter 换行）。公开方法：open(characterId?)/close()/setCharacter()/addMessage()/appendStream()/finalizeStream()/setSending(bool) —— 035 组合根桥接面。点战场单位链路：组件订阅注入的 subscribe（Pick<HudBusAdapter,'subscribe'>，不 import world/core 渲染层），selection.revision 变化且单选单位带 characterId → 打开并切上下文；流式增量只改流式气泡节点不重建列表；皮肤 token 全部 --srf-* CSS 变量
- `src/hud/components/chat-drawer/demo-fake-stream.ts` —— ⚠️ DEMO-ONLY 定时器假流（文件头三重标记，不进生产链路）；正式数据流 task_035 的 chat-service 用同一组公开方法接线
- `src/hud/__tests__/character-chat-drawer.test.ts` —— 31 条测试（纯逻辑 12 + 组件 17 + DEMO 假流 2），沿用 hud 现有 harness/DOM 断言模式
- `src/hud/dev/hud-dev-entry.ts` —— dev 页挂 DEMO 抽屉（假流可肉眼验证）；`src/hud/README.md` —— Layout 补 components/chat-drawer/ 一行

### 验证输出
- `npm run typecheck` → 零错误
- `npx jest src/hud --silent` → Test Suites: 18 passed；Tests: 412 passed（基线 381 + 新增 31，无回归）
- 全量兜底 `npx jest --silent` → Test Suites: 113 passed；Tests: 2598 passed, 6 skipped

### 设计说明 / 与既有 panels/chat-drawer 的关系
- `panels/chat-drawer.ts`（`<strat-chat-drawer>`）服务外部 agent 会话（WorldState.links/messages 驱动、禁止本地回显）；本组件（`<strat-character-chat-drawer>`）服务本地角色对话，消息真相在组件会话存储（036 落库后由 chat-service 加载历史回填），“发送 → 立即 user 气泡 → 流式回显”是 task_035 定义流程，两个文件头均已写明差异。
- 约束遵守：零新依赖；未 import world/；未经 core/bus（仅注入 subscribe）；未 mock 数据绕过功能（假流仅演示路径且 DEMO 标记）；git 选择性 add。

### 未尽事项（归后续任务）
- 组合根接线（正式入口挂载 + onSend → CliTransport 桥接）→ task_035
- 会话历史 SQLite 落库 / 加载回填 → task_036

## 验证方式
npm run typecheck && npx jest src/hud --silent
