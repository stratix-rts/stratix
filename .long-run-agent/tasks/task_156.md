# task_156: P0 回归：远程模式下画布鼠标交互全哑——世界事件无转发通道

## 现象（用户 10:47 报告 + playwright 实证）

浏览器直开 7523（153 后默认远程模式）：
- hover 单位光标变 pointer ✓（hitTest 活着）
- 点击单位：无涟漪、无选中环、业务态面板永远「未选中单位」✗
- 框选、右键移动指令同样全哑 ✗
- HUD 面板按钮（HUD 命令）全部正常 ✓
- `__srfApp.snapshot()` 点击前后 selection.unitIds 恒 []、revision 恒 0

## 根因（已确诊，勿重复诊断）

153（0112d70）把远程模式翻为默认。远程模式语义（main-entry.ts:380-395, 1413-1419）：
- 本地 core runtime **不启动**（`stopRuntime = remote ? () => undefined : runtime.start()`）
- 写 = HUD 命令 → `command.forward` → service 侧 core 裁决 → snapshot 全量回推
- **但 world-sync 协议（world-sync/session.ts:170-186）客户端→service 只认 `hello` 和 `command.forward`（HudCommand）两种消息**
- 画布交互走的是 WorldEvent（unit.click / selection.box / unit.move）：bridge → 本地 `emitWorldEvent` → 本地总线上**零消费者**（runtime 未启动）→ 静默丢弃
- 事件类型根本不在 HudCommand 词表里，`command.forward` 也装不下它
- service 侧 core runtime 是跑着的（stratix-service.ts:289 `runtime.start()`），handleWorldEvent 消费 unit.click → applySelection 链路完好——缺的只是「事件从客户端到 service 总线」这一段管道

083 时代此断链只存在于 STRATIX_REMOTE=1 显式开启；153 翻默认后暴露给所有用户。B 轮验收只在本地模式跑 playwright（?stratix-remote=0），没验远程模式画布交互——同「验收环境≠使用环境」教训。

## requirements

1. world-sync 协议新增客户端→service 的世界事件转发消息型（如 `event.forward`，载荷 = WorldEvent），协议版本裁决按既有规则处理（版本范围见 protocol.ts）
2. service 侧 session 处理该消息型：校验后把事件发到 service 的 core 总线（等价 emitWorldEvent），由 service 侧 runtime 裁决（选中/移动落 store → snapshot 回推全体客户端）
3. 客户端 main-entry：远程模式下世界事件改走转发——**白名单只上行状态语义事件**（unit.click / selection.box / unit.move / camera.director）；纯视图事件（camera.moved、replay.beat 等）保持本地不上行（service 不需要相机姿态，别拿视图态污染真相）
4. 本地模式（?stratix-remote=0）行为零改动
5. 点击→选中环出现的延迟容忍一次 WS 往返；本地即时反馈（点击涟漪等 world 侧 FX）不受影响
6. 协议测试、session 测试、远程模式 e2e 断言（真实点击选中）齐全

## acceptance

- [ ] 浏览器直开 7523（默认远程模式）点击单位：选中环出现 + 业务态面板显示该单位（snapshot 回推后 revision 递增）
- [ ] 框选多单位、右键移动指令在远程模式同样生效
- [ ] HUD 命令（command.forward 既有路径）不受影响
- [ ] 本地模式（?stratix-remote=0）画布交互回归全绿
- [ ] 协议非法消息型（客户端发 snapshot 等）仍被拒
- [ ] typecheck 通过；协议/session/远程相关 jest 全绿
- [ ] playwright 远程模式真实点击断言（非本地模式代验）

## design

- 协议扩展参考既有 command.forward 的受理-回执模式；世界事件是否需要 ack 由实现评估（fire-and-forget 可接受——快照是最终一致口径）
- 端点若缺 emitWorldEvent 口子，参照 issueSnapshot/handleCommandForward 的转交模式补

## deliverables

- `src/stratix-gateway/api/websocket/world-sync/protocol.ts` —— 新增 `event.forward` 消息型 + 白名单守卫 `isForwardableWorldEvent` / `createEventForwardMessage`；协议版本升 2（MIN 仍 1）
- `src/stratix-gateway/api/websocket/world-sync/session.ts` —— 会话受理 `event.forward` → 转交端点（未注册连接拒；无回执，fire-and-forget）
- `src/stratix-gateway/api/websocket/world-sync/endpoint.ts` —— 新增 `dispatchEvent` 投递口 + `dispatchWorldEvent`（投 service 的 core 总线，不改 store）
- `src/stratix-gateway/index.ts` —— 端点接线 `dispatchEvent: emitWorldEvent`（与 dispatch 同源同实例）
- `src/app/services/remote-store/remote-store.ts` —— 新增 `emitWorldEvent`（白名单外事件不上行；未连接不排队）
- `src/app/main/main-entry.ts` —— 远程模式订阅世界事件总线 → 转发；本地模式零改动（不订阅）；卸载时退订
- `docs/WORLD-SYNC.md` —— 协议文档升 v2（消息表 / 字段明细 / 版本裁决 / 方向语义）
- 单测：`world-sync/__tests__/{protocol,endpoint,session}.test.ts` + `remote-store/__tests__/remote-store.test.ts`
- e2e：`tests/e2e/world-sync-event-forward.spec.ts` + `tests/e2e/playwright.world-sync-event.config.ts`（远程模式真实点击 + 本地模式回归）
