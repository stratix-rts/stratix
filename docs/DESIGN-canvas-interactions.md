# DESIGN-canvas-interactions —— 画布交互盘点与事件矩阵（IX-00）

> 状态：**设计稿（未冻结）· 2026-11-06**
> 任务：task_215（IX-00，纯设计，零代码改动）｜规格来源：task_214（IX-01，单击=选中 / 双击=开聊天框，用户 21:28 原话）
> 分支 / 基线：`demo/v3.3` @ `73cc13f`（worktree `/Users/kingj/code/Stratix-demo`）
> 既有语义参考：task_045（右击短按=移动选中编队 / 拖远=平移）、task_079（ESC 回全景）、task_187（仪式消费输入）
> 原则出处：`docs/REFACTOR_PLAN_V3.md` §1 通信铁律（world 只认 core/types 与 core/bus；HUD 不直调 world；world 不直调 hud）｜`docs/SERVICE-SPLIT-PLAN.md` 铁律 1（真相唯一）｜`docs/PERFORMANCE_GUIDELINES.md`
> **本任务未修改任何 `src/` 代码**（纯设计文档；§1 的结论全部来自读码取证，每条带 path:line）

---

## 0. 决策摘要（TL;DR）

**一句话**：画布上今天**有**一套完整的 RTS 手势（框选 / 右击移动 / 双击跟随 / ESC 归位），但**没有**一套「agent 交互」的统一语义 —— 用户看到的「右击后 agent 回『收到』」其实是**世界层自己画的假气泡**，真正的移动指令在**远程模式（缺省模式）下走不到客户端**，所以**没有移动动画**。

四条关键决策：

| # | 决策 | 依据 |
|---|---|---|
| **D1** | **P0 缺口 = 右键移动的「位置事实」在远程模式下**单向丢失**（client → service 通，service → client 不通）**。修复方向 = **补一条下行事件通道**（service → client 推 `unit.position`），而不是让客户端乐观自演 | §1.2 逐段解剖；§4 拆单 IX-02 |
| **D2** | **「收到」不是 agent 说的** —— 是世界层在下达指令时**本地伪造**的气泡文案（`src/world/objects/task-fx.ts:361`）。右击移动链路上**从头到尾没有任何 agent 参与**（不发 `chat.send`、不派任务、不经 agent-link） | §1.2.4；这正是用户「以为 agent 回了、其实没动」的认知来源 |
| **D3** | **双击 agent 的目标态 = 打开该 agent 的单独聊天框**（task_214 规格优先）；**现有「双击 = 跟随镜头」必须让位**，跟随镜头降级改绑（推荐「双击空白地面 = 回全景」） | §2 表 2.2 行 P3×O1；§3 冲突对 C-02 |
| **D4** | **单击选中已经自带一个隐藏副作用**：HUD 聊天抽屉监听 `selection.revision`，**单选一个已关联角色的单位就会自动顶开抽屉**（`src/hud/components/chat-drawer/chat-drawer.ts:578`）—— 与「双击才开聊天框」的规格**语义重叠且时机相反**，必须裁决（推荐：取消「单选自动开抽屉」，改由双击 / HUD 卡片点击触发） | §3 冲突对 C-03；§4 拆单 IX-03 |

**明确不做的**：不做多选拖拽复制、不做右键菜单、不做单位编队拖拽重排、不做触屏手势扩展、不在本任务实现任何代码。

---

## 1. 现状全量盘点（读码实证）

### 1.1 画布输入面 —— `BattlefieldScene` 的**全部**输入挂钩

**结论：world 层的输入面只有 5 个指针钩子 + 2 个键盘钩子，没有任何其它入口**（`grep setInteractive src/world` 无命中 ⇒ 没有任何 GameObject 参与拾取，命中判定全部走注册表的坐标计算）。

| 挂钩 | 位置 | 语义 |
|---|---|---|
| `pointerdown` | `src/world/scenes/BattlefieldScene.ts:458` | 分流：右键/中键 → 平移候选；左键 → 点击 or 框选候选 |
| `pointermove` | `src/world/scenes/BattlefieldScene.ts:459` | hover 态（空闲时）/ 平移增量（pan 中）/ 框选预览（box 中） |
| `pointerup` | `src/world/scenes/BattlefieldScene.ts:460` | 四条出口：pan 收尾 / 框选收尾 / 单击收尾 |
| `pointerupoutside` | `src/world/scenes/BattlefieldScene.ts:461` | 与 pointerup **同一条处理函数**（拖出画布松手也要收尾，防状态残留） |
| `wheel` | `src/world/scenes/BattlefieldScene.ts:462` | 缩放（0.6–1.6x，步长 1.12） |
| `keydown-ESC` | `src/world/scenes/BattlefieldScene.ts:464` | 回全景（task_079） |
| `keydown`（任意键） | `src/world/scenes/BattlefieldScene.ts:468` | **只**用于「跳过进副本仪式」（task_187） |
| `disableContextMenu()` | `src/world/scenes/BattlefieldScene.ts:471` | 关浏览器右键菜单（否则右键短按判定被菜单吃掉） |

**手势细分（`onPointerDown` → `onPointerUp`）**

| 阶段 | 位置 | 事实 |
|---|---|---|
| 按下分流 | `BattlefieldScene.ts:860` | `rightButtonDown() \|\| middleButtonDown()` → `dragMode='pan'`，并记 `panButton`（`'right' \| 'middle'`） |
| 按下分流（左键） | `BattlefieldScene.ts:886` | `hitTest` 命中单位 → `dragMode='click'`；命中空地 → `dragMode='box'`（**起点在单位上就永远不会拖出框**） |
| 拖拽阈值 | `BattlefieldScene.ts:155` | `DRAG_THRESHOLD_PX = 4`（屏幕位移） |
| 平移中位移累计 | `BattlefieldScene.ts:908` | 超过阈值 ⇒ `draggedFar = true`（右键短按判定的前提） |
| 右键短按出口 | `BattlefieldScene.ts:933` | `panButton === 'right' && !draggedFar` ⇒ `issueMoveCommand(pointer)` |
| 中键短按 | `BattlefieldScene.ts:933` | **无任何出口**（中键短按 = 空操作，只有拖动才平移） |
| 框选收尾 | `BattlefieldScene.ts:938-955` | `queryBounds` 算命中 → `bridge.selectionBox(bounds, hits, additive)`（`Shift` = 加选） |
| 单击收尾 | `BattlefieldScene.ts:957-980` | 命中单位 ⇒ `bridge.unitClick(hit.id, mods)`（`:962`）；命中空地 ⇒ 清 `lastClick` |
| 双击判定 | `BattlefieldScene.ts:970` | `isDoubleClick(lastClick, stamp)`（同单位 + 同窗口 + 同容差） |
| 双击的**唯一**语义 | `BattlefieldScene.ts:972` | `toggleFollow(hit.id)` = **跟随镜头**（再双击解除） |
| hover | `BattlefieldScene.ts:892-897` | 悬停单位 ⇒ 放大 1.1x + pointer 光标 + 喷口微光（`unitLayer.setHovered`） |

**命中判定（不在场景里算，住在注册表）**

- 点击命中：`src/world/objects/unit-registry.ts:298`（`hitTest`，**反向遍历**取最上层单位，`hitRadius` 容差）
- 框选命中：`src/world/objects/unit-registry.ts:283`（`queryBounds`，**相交**即命中，非包含 —— RTS 惯例）
- 场景侧调用：`src/world/objects/unit-layer.ts:465`（`hitTest`）/ `:470`（`queryBounds`）

**双击判定参数（唯一事实源）**

- 判定函数：`src/world/camera/camera-nav.ts:124`（`isDoubleClick`，纯函数、零 Phaser 依赖）
- 窗口 / 容差：`src/core/theme/visual-spec.ts:609`（`doubleClickWindowMs: 320`）/ `:611`（`doubleClickSlopPx: 8`）
- **注意**：这是**相机策略**模块里的常量，但已被战场场景借用于「双击跟随镜头」；task_214 的「双击开聊天框」应复用同款判定（同一常量、同款语义），**不要另立一套窗口**。

**仪式输入消费（task_187）**

- 消费点：`BattlefieldScene.ts:857`（pointerdown）/ `:923`（pointerup）/ `:1050`（wheel）/ `:1247`（ESC）/ `:1262`（任意键）
- 判定：`BattlefieldScene.ts:1271`（`consumeCeremonyInput`）—— 仪式在演就**吃掉整次输入并返回 true**，调用方立即 return
- 语义：仪式期间的一次点击**只**用于跳过仪式，**不会**顺手选中单位 / 框选 / 发移动指令

**键盘面（world 侧）**：**只有 ESC 一条**（`BattlefieldScene.ts:1245` → `overviewPose` + 解除跟随 + 导演让位）。ESC 在 world 侧的语义是**镜头归位**，**不是**取消选择。

### 1.2 命令链：右击移动逐段解剖 + **P0 根因定位**

#### 1.2.1 完整链路（本地直连模式 `STRATIX_REMOTE=0` 下它是通的）

```
pointerup(右键短按)
  └─ BattlefieldScene.ts:933   issueMoveCommand(pointer)
      └─ BattlefieldScene.ts:1004  issueMoveCommandAt(target)
          ├─ BattlefieldScene.ts:1009  集火判定：命中「卡住(error)」的单位 ⇒ focus 气泡，否则 command 气泡
          ├─ BattlefieldScene.ts:1016  bridge.unitBubble(unitId, '收到')   ← 世界层本地伪造气泡（不是 agent！）
          ├─ BattlefieldScene.ts:1020  目标点双重涟漪 + :1022 信号弹特效
          └─ BattlefieldScene.ts:1024  bridge.unitMove(selectedUnitIds, x, y)
                └─ world/bridge/bus-adapter.ts:437   emitWorldEvent({type:'unit.move', …})
                      └─ core/runtime.ts:937          handleWorldEvent 'unit.move'
                          └─ core/runtime.ts:355      applyUnitMove()
                              ├─ :356  过滤未知单位（不在 WorldState.units 的 id 静默丢弃）
                              ├─ core/unit/formation.ts:46  computeFormationSlots()（网格编队，间距 50）
                              └─ core/runtime.ts:359  emitWorldEvent({type:'unit.position', unitId, x, y})  ← 逐单位广播
                                    └─ world/bridge/bus-adapter.ts:372  case 'unit.position' → syncUnitPosition
                                          └─ BattlefieldScene.ts:592 → unit-layer.ts:666 applyUnitPosition
                                                └─ unit-layer.ts:686  300px/s 的 tween（Sine.easeOut）← **动画在这里**
```

> 落库链路（task_033）：`unit.position` → `src/app/services/persistence/game-save-coordinator.ts:214`（防抖缓冲）→ `saveUnitPositions` → `unit_positions` 表。

#### 1.2.2 用户实测现象的**根因**（缺省 = 远程模式）

**现象**：右击某位置 → 屏幕上冒出「收到」→ **单位纹丝不动**。

**关键事实：缺省是远程模式。** `src/app/main/main-entry.ts:419` 读 `isRemoteModeEnabled()`（task_153 起**缺省即开**）：连上 `ws://127.0.0.1:7524/ws/world-sync` 后，**渲染进程不再启动本地 core runtime**（`src/app/main/main-entry.ts:1579`：`const stopRuntime = remote ? () => undefined : runtime.start();` —— 铁律 1「真相唯一」）。

远程模式下链路的**真实走向**：

| 段 | 位置 | 远程模式下的实际行为 |
|---|---|---|
| ① 画布发指令 | `world/bridge/bus-adapter.ts:439` | 事件发到**浏览器进程内**的总线 |
| ② 上行转发 | `src/app/main/main-entry.ts:442` | `onWorldEvent(...)` ⇒ `remote.emitWorldEvent(event)` |
| ③ 白名单过滤 | `src/app/services/remote-store/remote-store.ts:424` | `unit.move` **在**白名单内 ⇒ 包成 `event.forward` 上行 |
| ④ service 收 | `world-sync/session.ts:190` → `endpoint.ts:406` | 投进 **service 进程**的 core 总线（`stratix-gateway/index.ts:371` 的 `dispatchEvent: emitWorldEvent`） |
| ⑤ service 裁决 | `core/runtime.ts:937` → `:355` | 编队算完 ⇒ **在 service 侧**逐单位广播 `unit.position` |
| ⑥ **位置回传** | — | **❌ 断在这里** |

**断点（第一优先缺口）**：**world-sync 协议只有「客户端 → service」方向的世界事件通道（`event.forward`），没有「service → 客户端」方向的事件通道。**
- 协议消息型全集只有六种：`hello` / `snapshot` / `command.forward` / `command.ack` / `event.forward` / `error`（`src/stratix-gateway/api/websocket/world-sync/protocol.ts:129-240`）
- service → 客户端只回两种东西：**全量快照**（`snapshot`）与**命令回执**（`command.ack`）—— 端点里唯一的服务端广播是 `broadcastSnapshot()`（`endpoint.ts:479`）
- 而**坐标根本不在快照里**：`WorldState.units` 的 `UnitView` **不含坐标**（`src/core/types.ts:228` 起，`UnitView` 只有 id/name/status/missionId/power/characterId/skinId/appearance/capabilities/online），位置真相按契约住在 world 层 `UnitObject`

⇒ **`unit.position` 这条「位置事实」在 service 侧发出来之后，无人可收：既不回客户端（无下行通道），也不进 service 的落库订阅者（service 侧没有 `unit.position` 的持久化订阅者 —— 全仓唯一的 `createGameSaveCoordinator` 调用点在渲染进程 `src/app/main/main-entry.ts:1308`）。**

**因此**：
- 客户端的 world 层收不到 `unit.position` ⇒ `unit-layer.ts:666` 的 tween 从不触发 ⇒ **没有移动动画**；
- 客户端的小地图位置表也停在原地（`src/app/main/main-entry.ts:1365` 同样只吃**本地**总线上的 `unit.position`）；
- `unit_positions` 表也**不会**被更新（渲染进程的落库订阅者同样只听本地总线）—— 这次移动**连持久化都没留下**；
- 而「收到」气泡是**世界层自己画的**（`world/objects/task-fx.ts:361` 的 `command: '收到'`），它在第 ③ 步之前就已经在本地播出了 ⇒ **用户看到的是「假回执」**。

> **一句话根因**：右击移动的**指令**在远程模式下完整抵达了 service 并被裁决，但**裁决产物（每单位终值坐标）所在的 `unit.position` 事件没有任何回程通道** —— **client → service 通，service → client 断**。用户看到的「收到」是世界层本地伪造的固定文案，**agent 全程未被惊动**（移动链路上没有任何 `chat.send` / 派单 / agent-link 交互）。

#### 1.2.3 本地直连模式（`STRATIX_REMOTE=0`）下这条链是通的

`runtime.start()` 照常启动 ⇒ `unit.move` 在**同一进程**被裁决 ⇒ `unit.position` 在**同一总线**回到 world 层 ⇒ tween 正常 + 落库订阅者正常（`game-save-coordinator.ts:214` 在同进程能收到）。

> ⚠️ **证据边界**：本条为**读码推断**，未做运行时实测 —— 本单受「零代码改动 / 不碰运行中进程」约束，无法启服务复现。**实测步骤见 §4 拆单 IX-02 的验收标准**（该单必须实测复现 + 修复后回归）。

#### 1.2.4 顺带查实：**agent 在移动链路上完全不在场**

| 事实 | 位置 |
|---|---|
| 右击移动只发 `unit.move` + `unit.bubble`，**不发** `chat.send` / `task.assign` | `BattlefieldScene.ts:1016`、`:1024` |
| 气泡文案是**世界层常量**（`'收到'` / `'来了来了'`），不是 agent 的回复 | `world/objects/task-fx.ts:359-364` |
| `unit.bubble` 只是让世界层按原话冒泡（**world 只消费不生产**） | `world/bridge/bus-adapter.ts:388-391` |

⇒ 「agent 收到指令」在当前代码里**不存在**。若产品语义是「右击 = 给 agent 下达移动指令（agent 自己走位）」，那是一条**尚未实现**的能力（§4 IX-06 标注为 OPEN）。

### 1.3 选中 / 编队现状

| 能力 | 现状 | 位置 |
|---|---|---|
| 单击选中 | `unit.click` 事件 → core 按修饰键判 `set` / `toggle` | `BattlefieldScene.ts:962` → `core/runtime.ts:917` → `isAdditiveClick`（`core/runtime.ts:214`：`shift \|\| ctrl \|\| meta`） |
| 框选 | 左键拖 ⇒ `selection.box`（带 `unitIds` + `additive`） | `BattlefieldScene.ts:948` → `core/runtime.ts:926` |
| 拖空框 / 点空地 | = **清空选择**（明确动作，不是 no-op） | `BattlefieldScene.ts:944-948` |
| Shift 拖 / Shift 点 | = 加选（框选 `additive` / 点击 `toggle`） | `BattlefieldScene.ts:947`、`core/runtime.ts:214` |
| 选择集真相 | `WorldState.selection`（`core/types.ts:540`），core 侧对账已知单位 | `core/runtime.ts:244`（`applySelection`） |
| 编组（存） | `unit.group.assign`（Ctrl/⌘+1..9） | `hud/components/shortcuts/shortcut-manager.ts:192` → `core/runtime.ts:662` |
| 编组（召回） | `unit.group.recall`（裸数字 1..9） | `shortcut-manager.ts:195` → `core/runtime.ts:663` |
| 全选 / 清选 | `Ctrl/⌘+A` / `Esc` ⇒ `unit.select` | `shortcut-manager.ts:184` / `:189` |
| 编队落位（移动） | `computeFormationSlots`（纯函数，间距 50，网格中心对齐） | `core/unit/formation.ts:46`、常量 `:24` |
| **无**的东西 | 拖拽重排编队、复制粘贴编队、选择集持久化（编组只在会话内）、单位「血条/选中血条」 | — |

### 1.4 键盘现状（**两套并存的键盘面**）

| 层 | 监听 | 键 | 行为 | 位置 |
|---|---|---|---|---|
| **world（Phaser）** | `keydown-ESC` | ESC | 回全景 + 解除跟随 + 导演让位 | `BattlefieldScene.ts:464`、`:1245` |
| **world（Phaser）** | `keydown` | 任意键 | 仅「跳过仪式」 | `BattlefieldScene.ts:468`、`:1261` |
| **HUD（window）** | `window keydown` | `Ctrl/⌘+A` | 全选 | `shortcut-manager.ts:184`、`:243` |
| **HUD（window）** | 同上 | `Ctrl/⌘+1..9` | 存入编组 | `shortcut-manager.ts:192` |
| **HUD（window）** | 同上 | `1..9` | 召回编组 | `shortcut-manager.ts:195` |
| **HUD（window）** | 同上 | `Space` | 居中选中（无选中回世界中心） | `shortcut-manager.ts:202` |
| **HUD（window）** | 同上 | `?` | 开关快捷键帮助浮层 | `shortcut-catalog.ts:187` |
| **HUD（window）** | 同上 | `Esc` | 浮层开着先关浮层，否则 **取消选择** | `shortcut-catalog.ts:172-175` |
| **HUD（window）** | 同上 | `⌘K` | 命令面板（组合根装，`main-entry.ts` 的 `mountCommandPalette`） | — |

**输入框让路**：HUD 侧靠 `isEditableTarget`（`shortcut-manager.ts:223`）在**输入框聚焦时放行**（聊天框 / 命令行 / contenteditable 打字不被快捷键劫持）；**world 侧没有任何焦点判定** —— Phaser 的键盘插件挂在 window 上，**聊天框打字时 ESC 仍会触发回全景**（§3 冲突对 C-04）。

### 1.5 HUD 反向交互 与 bridge 命令面清单

**HUD → core 的命令出口（全部经 `hud/bridge/bus-adapter.ts:87` 的 `dispatch`）**

| 交互 | 发的命令 | 位置 | core 是否落地 |
|---|---|---|---|
| 事件轨条目点击 | `focus.unit` | `hud/components/marquee/marquee.ts:427` | ✅ `core/runtime.ts:697` → world 侧描边 + 引导弧线 |
| 小地图点单位 | `unit.select` | `hud/components/minimap/minimap.ts:343` | ✅ |
| 小地图点地面 | `camera.center` | `minimap.ts:367` | ✅ `core/runtime.ts:669` |
| agent 卡片「选中」 | `unit.select` | `hud/panels/agent-catalog.ts:496`/`:500` | ✅ |
| agent 卡片「聚焦」 | `unit.focus` | `agent-catalog.ts:498` | ❌ **死命令** —— `core/runtime.ts` 无 `case 'unit.focus'` ⇒ 落 `reportUnhandled`（`core/runtime.ts:911`），**点了没反应** |
| 快捷键 | `unit.select` / `unit.group.*` / `camera.center` | `shortcut-manager.ts:184-202` | ✅ |
| 顶栏「🎬 导演」 | `camera.director` | `hud/screens/main-screen.ts:876` | ✅ |
| 里程碑 / 回放占用 | `hud.layer.hold` | `hud/components/marquee/milestone.ts:229` | ✅ |
| 层级切换 | `hud.layer.set` | `hud/layers/layer-switch.ts:206` | ✅ |
| 屏位 / 主题 | `ui.navigate` / `theme.set` | `main-screen.ts:896-903` 等 | ✅ |
| 角色档案编辑 | `character.*` | `character-screen.ts:1109`/`:1184` | ✅ |
| 任务 / 使命 / 会话 / 项目 | `task.*` / `mission.*` / `session.*` / `project.*` / `pipeline.start` | 各面板 | ✅ |

**HUD ← core 的反向通道**：HUD **只有两条**入向 —— `onState`（WorldState 广播，`hud/bridge/bus-adapter.ts:107`）与**本地** `theme.set` 直落（`:90`）。**没有**「world 直接叫 HUD 打开某个面板」的通道（这是 §5 的扩展点要解决的问题）。

**world → HUD 的既有事实**：目前**零条**。world 发的事件一律回到 world（`unit.position` / `unit.bubble` / `fx.sound` …）或回 core 写状态（`camera.director`）。

**canvas ↔ HUD 的隐性耦合（本次盘点新发现，重要）**：HUD 聊天抽屉订阅 `selection.revision`，**单选一个已关联角色的单位就自动顶开抽屉**（`hud/components/chat-drawer/chat-drawer.ts:565-580`，`:578` 调 `this.open(characterId)`）；**恰选两个且都关联角色**时进入「互聊」候选态（`:581` 起）。⇒ 画布单击（→ `unit.click` → `selection` 变）会**直接操纵 HUD 抽屉开合**。

---

## 2. 目标态事件矩阵

### 2.1 命中对象词表（**先收窄对象集**）

用户诉求里提到的「己方 / 他方 / 地形 / 障碍」在 Stratix **当前不存在** —— 画布上只有：agent 单位、任务建筑 / 区域（**纯绘制物，不参与拾取**）、副本名牌（**覆盖层**）、地面网格（纯装饰）。因此矩阵的对象列按**代码里真实存在**的对象收窄，缺席的对象显式标注 N/A 并给出理由（不留未定义组合）：

| 代号 | 对象 | 可命中？ | 依据 |
|---|---|---|---|
| **O1** | agent 单位（`UnitObject`） | ✅ | `unit-registry.ts:298` `hitTest` |
| **O2** | 空白地面 | ✅（= 未命中任何单位） | `hitTest` 返回 null |
| **O3** | 任务建筑 / 区域 | ❌ N/A | 建筑层只绘制不拾取（`world/objects/building-layer.ts` 无 hitTest 出口）；点击建筑**等同**点击 O2 |
| **O4** | 副本名牌 / 仪式遮罩 | ❌ N/A | 仪式期输入被**整次消费**（`BattlefieldScene.ts:1271`）；名牌是覆盖层，不参与拾取 |
| **O5** | 己方单位 | ❌ N/A | Stratix **无阵营概念** —— 场上所有单位都是自己的角色（`UnitView` 无 faction 字段，`core/types.ts:228`） |
| **O6** | 他方单位 | ❌ N/A | 同 O5：不存在 |
| **O7** | 地形 / 障碍 | ❌ N/A | 世界是**无碰撞平面**（`unit-registry.ts:283` 框选只做相交判定，无遮挡/寻路概念） |

### 2.2 主矩阵：交互原语 × 命中对象

**原语词表**

| 代号 | 原语 | 判定 |
|---|---|---|
| **P1** | 左键短按（位移 ≤ 4px） | `BattlefieldScene.ts:155` |
| **P2** | 左键拖拽（位移 > 4px） | 同上 |
| **P3** | 双击（窗口 320ms / 容差 8px / 同一单位） | `camera-nav.ts:124` + `visual-spec.ts:609`/`:611` |
| **P4** | 右键短按（位移 ≤ 4px） | `BattlefieldScene.ts:908`/`:933` |
| **P5** | 右键拖拽 | 同上 |
| **P6** | 中键拖拽 | `BattlefieldScene.ts:860` |
| **P7** | 滚轮 | `BattlefieldScene.ts:462` |
| **P8** | ESC | `BattlefieldScene.ts:464` |
| **P9** | 任意其它键 | `BattlefieldScene.ts:468` |
| **P10** | 修饰键点击（Shift / Ctrl / ⌘ + 左键短按） | `readModifiers`（`BattlefieldScene.ts:1460`） |

**目标态矩阵**（`现状` 列 = 今天真实行为；`目标` 列 = 本设计裁决后的行为）

| 原语 | 对象 | 现状 | **目标** | 备注 / 裁决 |
|---|---|---|---|---|
| **P1** | O1 单位 | 选中（`unit.click`）+ 涟漪 + squash 演出 | **选中**（`unit.click` 锚点） | task_214 规格；**取消**「单选自动顶开聊天抽屉」（§3 C-03） |
| **P1** | O2 空白 | 清空选择 | **清空选择** | 保持 |
| **P1** | O3/O4 | ≡ O2 | ≡ O2 | 仪式期被消费 |
| **P2** | O2 起手 | 拖框 → 预览弱色圈 → 松手上报命中 | **不变** | 框选是 RTS 惯例，不动 |
| **P2** | O1 起手 | **不可能**（起点在单位上 ⇒ click 模式） | **不变**（保持「点单位不可拖框」） | 但见 §3 C-05：建议后续单独立项 |
| **P3** | O1 单位 | **跟随镜头**（`toggleFollow`，`BattlefieldScene.ts:972`） | **打开该 agent 的单独聊天框**（task_214） | **D3：跟随镜头让位**，改绑见 §3 C-02 |
| **P3** | O2 空白 | 无（`lastClick` 置空，`:978`） | **回全景**（等价 ESC） | 跟随镜头的「去处」 |
| **P3** | O3/O4 | ≡ O2 | ≡ O2 | — |
| **P4** | O2 空白 | 对选中编队发 `unit.move`（有选中才发） | **不变**（选中为空 ⇒ 无操作） | 与 §1.2.4 的「agent 语义」分开（§4 IX-06 OPEN） |
| **P4** | O1 单位 | 同上；**且**若命中单位处于 `error` 态 ⇒ 气泡换「来了来了」（集火） | **不变** | `BattlefieldScene.ts:1009` |
| **P5** | 任意 | 平移（橡皮筋回弹） | **不变** | — |
| **P6** | 任意 | 平移 | **不变** | 中键**短按 = 空操作**（保持现状，§3 C-06 记录） |
| **P7** | 任意 | 缩放 0.6–1.6x | **不变** | — |
| **P8** | 任意 | world：回全景；**HUD 同时**：取消选择 | **裁决**：ESC = **关闭最上层浮层 / 取消选择**，**不再**回全景（镜头归位改绑 P3×O2 与「空格」以外的独立键） | §3 C-01 |
| **P9** | 任意 | 仅「跳过仪式」 | **不变**（仪式期吞掉；非仪式期**不拦截**任何键） | — |
| **P10** | O1 单位 | 加选/减选（`toggle`） | **不变** | `core/runtime.ts:214` |
| **P10** | O2 空白 | 框选 `additive`（Shift 拖框加选）；点空地 = 清空（**Shift+点空地也清空**） | **不变**（记录为已知口径） | `BattlefieldScene.ts:947` |
| **P10** | O3/O4 | ≡ O2 | ≡ O2 | — |
| **P1+P10** | O1 | 同一 tick 内先 `toggle` 再走双击判定 | **不变** | — |

**键盘面（world 侧只占 ESC 一格，其余键位属 HUD 层）**

| 键 | 现状 | 目标 | 备注 |
|---|---|---|---|
| `Esc` | world 回全景 + HUD 取消选择（**同时**） | **单一语义**（§3 C-01） | 优先级：模态浮层 > 取消选择 > 镜头归位 |
| `Ctrl/⌘+A` | 全选 | 不变 | HUD 层 |
| `Ctrl/⌘+1..9` / `1..9` | 编组存 / 召回 | 不变 | HUD 层 |
| `Space` | 居中选中 | 不变 | HUD 层 |
| `?` | 帮助浮层 | 不变 | HUD 层 |
| `⌘K` | 命令面板 | 不变 | HUD 层 |
| 其余 | 无 | **留白**（不做「未定义键」兜底动作） | — |

### 2.3 判定窗口与修饰键优先级（冲突消解的**规则**，不是个案）

1. **判定窗口**：所有双击判定统一用 `CAMERA_METRICS.doubleClickWindowMs = 320ms` / `doubleClickSlopPx = 8px`（`core/theme/visual-spec.ts:609`/`:611`）—— **唯一事实源**，任何新增双击语义都从这里取，不另立常量。
2. **单击先落、双击后叠**：双击的第一击**照常**执行 P1（选中），第二击若命中双击判定则**追加**双击语义；**双击不撤销、不改写**选中集（task_214 明文：「双击后选中态与单击一致」）。
3. **修饰键优先级**：`Shift/Ctrl/⌘` 只影响**选择集语义**（`set` vs `toggle`），**不影响**双击判定 —— 即 `Shift+双击` 仍是「加选 + 开聊天框」。
4. **输入优先级（自上而下，先命中者独占该次输入）**：
   ① **仪式在演**（整次输入被吃掉）→ ② **HUD 模态浮层开着**（浮层自己处理 ESC）→ ③ **输入框聚焦**（打字不被劫持）→ ④ **画布手势**（本矩阵）→ ⑤ **HUD 全局快捷键**。
5. **一次输入只产出一个业务动作**（唯一例外：P1+P10 的选择语义与 P3 的叠加，见 §2.2）。

---

## 3. 撞车检查（潜在冲突对逐条消解）

| # | 冲突对 | 今天的事实 | 撞车后果 | **消解设计** |
|---|---|---|---|---|
| **C-01** | **ESC：world 回全景 vs HUD 取消选择** | world：`BattlefieldScene.ts:1245`；HUD：`shortcut-catalog.ts:172-175`（浮层开着先关浮层，否则 deselect）。两者**监听同一个 window keydown 且互不知情**（HUD 只 `preventDefault`，不 `stopPropagation`；`shortcut-manager.ts:237`） | **按一次 ESC 同时「镜头归位」+「清空选择」** —— 两个毫不相关的动作同时发生，用户以为是 bug | **ESC 收归单一语义链**：① 模态浮层开着 → 关浮层（HUD 现有口径）；② 否则 → **取消选择**（HUD 现有口径）；③ **镜头归位不再绑 ESC**，改绑 **P3×O2（双击空白地面）**（新）。world 侧**移除** `keydown-ESC` 的回全景分支 |
| **C-02** | **双击 agent：task_214「开聊天框」 vs 现状「跟随镜头」** | 现状 `BattlefieldScene.ts:970-975` → `toggleFollow`（`:1154`） | 两者直接争抢同一个手势 | **规格优先（D3）**：双击 agent = 开单独聊天框；**跟随镜头降级**到「双击空白地面 = 回全景」+ 保留 `toggleFollow` 的「再双击解除」语义（跟随态下双击同一单位仍解除跟随） |
| **C-03** | **单击选中的隐藏副作用：HUD 抽屉自动顶开 vs task_214「双击才开」** | `chat-drawer.ts:565-580`：单选一个已关联角色的单位 ⇒ `open(characterId)` | ① 单击就开抽屉 ⇒ 「双击开聊天框」规格**永远轮不到**；② 抽屉滑出**盖住右侧画布**；③ 用户想「只选中、准备右击移动」时抽屉已经开了 | **取消「单选自动开抽屉」**：抽屉只由 **P3 双击单位** 与 **HUD 侧显式点击（agent 卡片 / 头部按钮）** 打开；`selection.revision` 订阅保留，但**只在 `revoke` 语义下不触发**（改为：双击动作经 core 写一个显式字段，见 §5） |
| **C-04** | **聊天框聚焦 vs 画布键盘** | HUD 有 `isEditableTarget` 让路（`shortcut-manager.ts:223`）；**world 侧没有**（Phaser 键盘挂 window，`BattlefieldScene.ts:464`） | 聊天框里打字按 ESC ⇒ **画面同时回全景**；打字按任意键 ⇒ 若在仪式期会**跳过仪式** | world 侧键盘处理**统一先问焦点**：新增一个「当前是否有输入焦点」的判定（DOM 侧提供，world 通过契约读 —— 见 §5 扩展点 E-3）；命中输入焦点 ⇒ world 键盘**不处理** |
| **C-05** | **框选 vs 平移：起点语义** | 起点在单位上 ⇒ 只能 click（`BattlefieldScene.ts:886`）；起点在空地 ⇒ box | 想「框选一片」时如果起点压在某个单位上，**框选失效**（变成点击选中） | **本期不动**（RTS 惯例亦然：点在单位上就是点它）。记录为已知摩擦；如要改，走「起点在单位上 + 拖动 > 阈值 ⇒ 转为框选」的独立单（不在本轮范围） |
| **C-06** | **中键短按 = 空操作** | `BattlefieldScene.ts:933` 只有 `panButton === 'right'` 分支 | 用户以为「中键点一下 = 居中到某点」但没反应 | **本期保持空操作**（明确记录，避免下轮重复争论） |
| **C-07** | **仪式期输入消费 vs 正常交互** | `consumeCeremonyInput` 吃掉 pointerdown/up/wheel/ESC/任意键（`BattlefieldScene.ts:857`/`:923`/`:1050`/`:1247`/`:1262`） | 仪式期间点击**既不选中也不开抽屉**（符合 task_187） | **不变**；但注意：若 §5 的「双击开聊天框」走 WorldEvent，**仪式期不得发出该事件**（在 world 侧判定，不在 core 侧） |
| **C-08** | **右键短按 vs 右键拖动的分流** | 阈值 4px（`BattlefieldScene.ts:155`）；拖动即平移 | 抖手 5px ⇒ 变成平移而不是移动指令 | **本期不变**（阈值可调常量，后续单议） |
| **C-09** | **小地图点击 vs 画布点击** | 小地图点单位 ⇒ `unit.select`；点地面 ⇒ `camera.center`（`minimap.ts:343`/`:367`） | 小地图点单位**不**开聊天框（与画布双击语义不同源） | 建议统一：小地图**双击**单位也开聊天框（§4 IX-03 附带项）；**本期不改** |
| **C-10** | **`unit.focus` 死命令** | HUD agent 卡片「聚焦」发 `unit.focus`（`agent-catalog.ts:498`），**core 无 case** ⇒ 落 `reportUnhandled`（`core/runtime.ts:911`） | 点了没反应（静默失败） | **两条路二选一**（§4 IX-05）：① core 落地 `unit.focus` ⇒ 转发为 `camera.center`（与 `focus.unit` 的「描边+弧线」区分：前者动镜头、后者做联动）；② 删命令、HUD 改发 `camera.center`。**推荐 ①**（保留卡片语义完整） |
| **C-11** | **`camera.moved` 每 120ms 上行** | 远程模式**不上行**（白名单不含，纯视图事件） | 无 | 记录：视图事件不上行是**刻意**的（省带宽），不要为「顺手修移动」把它加进白名单 |

---

## 4. 拆 loop 建议（每单可独立验收 + 依赖）

> 拆单原则：**一个单只解决一类冲突**；每个单自带**可观测的验收判据**；被依赖的单先做。**P0 = IX-02（用户实测的那个洞）。**

### IX-02（P0）· 右键移动在远程模式下无动画 —— 补「service → client」下行事件通道

| 项 | 内容 |
|---|---|
| **问题** | `unit.position` 事件在 service 侧发出后**无人可收**（协议只有 `event.forward` 上行，`protocol.ts:129-240`）⇒ 无 tween、无小地图更新、`unit_positions` 不落库（§1.2.2） |
| **方案 A（推荐）** | ① 协议新增消息型 `event.push`（service → 客户端，载荷 = 白名单化的视图事件，**首批只放 `unit.position`**）；② service 端点订阅自身 core 总线的 `unit.position` ⇒ 广播给所有已 hello 的连接；③ 客户端 `remote-store` 增加 `case 'event.push'` ⇒ **把事件喂回本地 core 总线**（复用既有 world 通道语义）⇒ world 桥接层 `case 'unit.position'` 照旧驱动 tween；④ 客户端既有落库订阅者（`game-save-coordinator.ts:214`）与小地图累积表（`main-entry.ts:1365`）**自动恢复**，无需新代码 |
| **防回环（硬要求）** | 下行推的 `unit.position` **不在**上行白名单内 ⇒ `remote-store.emitWorldEvent` 直接返回 false（`remote-store.ts:425`）⇒ 不会被回灌给 service。**新增任何下行事件时必须复核这条不变式** |
| **方案 B（备选，不推荐）** | 客户端乐观自演：world 层本地调用纯函数 `core/unit/formation.ts:46` 算落位并立即 tween。**代价**：位置出现两个来源（本地预测 vs service 裁决），与服务端不一致时需要额外对账；且**不修落库**（除非客户端再本地发一条 `unit.position` 事件，语义更脏）。仅当协议改造被阻塞时作为临时方案，且必须显式标注「位置真相临时双源」 |
| **验收** | ① **实测复现**：远程模式（缺省）下右击移动 ⇒ 单位**不动**（贴当前缺陷截图/录屏）；② 修复后同场景 ⇒ 单位**平滑移动**到目标点（tween 可见）；③ **多单位**：框选 3 个 ⇒ 右击 ⇒ 三者按编队落位散开；④ **落库**：移动后查 `unit_positions` 表 ⇒ 行已更新（带 `instance_id` 归属）；⑤ **小地图**：移动后小地图光点同步移动；⑥ **本地直连模式回归**（`STRATIX_REMOTE=0`）行为不变；⑦ 协议新增消息型后，`protocol.ts` 的判定函数有对应单测 |
| **依赖** | 无（**最先做**） |
| **风险** | 协议面扩一个消息型 ⇒ 需同步 `docs/WORLD-SYNC.md`；多客户端时 `unit.position` 会广播给所有客户端（正确：位置是共享真相） |

### IX-03 · 画布 agent 点击语义落地（task_214）

| 项 | 内容 |
|---|---|
| **范围** | ① 双击 agent → 打开该 agent 的**单独聊天框**（走 core 契约，§5 的 E-1 路径）；② **取消**「单选自动顶开聊天抽屉」（C-03）；③ 双击空白地面 = 回全景（跟随镜头的去处，C-02）；④ 小地图双击单位同样开聊天框（C-09 附带） |
| **验收** | ① 画布双击一个已关联角色的单位 ⇒ 单独聊天框打开且**上下文切到该角色**；② 单击单位 ⇒ **只**选中（抽屉不开）；③ 框选 2 个 ⇒ 不进互聊候选态（随 ② 一并回归）；④ 双击空白 ⇒ 镜头回全景；⑤ 双击判定复用 `CAMERA_METRICS.doubleClickWindowMs`（320ms），跨窗口两次点击**只**算单击；⑥ 仪式期双击**不**开框（task_187 语义不变）；⑦ core 契约新增的字段/事件有单测；⑧ world 桥接层有「双击 → 发命令/事件」的断言 |
| **依赖** | **IX-02**（否则「打开聊天框」在远程模式下同样要跨进程，工作量翻倍 —— 建议先修通道再接语义）；§5 的 E-1 扩展点先定稿 |

### IX-01（= task_214 原单）· 见 IX-03

> task_214 的 requirements 与 IX-03 的 ①③ 一致；建议 **task_214 并入 IX-03 执行**（避免两个单抢同一个手势），task_214 保留编号、验收项并入 IX-03 的 ① 与 ⑤。

### IX-04 · 键盘面统一（ESC 收权 + 输入焦点让路）

| 项 | 内容 |
|---|---|
| **范围** | ① ESC 语义收归单一链（C-01）：模态浮层 → 关浮层；否则取消选择；**镜头归位改绑双击空白**；world 侧移除 `keydown-ESC` 的回全景分支；② world 侧键盘**尊重输入焦点**（C-04）；③ 快捷键帮助浮层的键位表同步更新（`shortcut-catalog.ts:83-138` 加一条「双击空白 = 回全景」） |
| **验收** | ① 按一次 ESC ⇒ **只**清选择，镜头**不动**；② 聊天框聚焦时按 ESC ⇒ 抽屉关、镜头不动、**不**清选择；③ 双击空白 ⇒ 镜头回全景；④ 帮助浮层里的键位表与实际行为一致；⑤ 快捷键现有单测全绿（`shortcut-manager` / `shortcut-catalog`） |
| **依赖** | IX-03（③ 依赖双击语义改绑） |

### IX-05 · HUD 命令面清理（`unit.focus` 死命令）

| 项 | 内容 |
|---|---|
| **范围** | core 落地 `unit.focus`（推荐：转发为 `camera.center`，把镜头对到该单位 —— 卡片「聚焦」的本来语义），或删除命令 + HUD 改发 `camera.center`。**推荐前者**：保留「聚焦=动镜头」与「联动=描边+弧线」（`focus.unit`）的分工（`core/types.ts:1543-1556` 已写明这个分工） |
| **验收** | ① agent 卡片点「聚焦」⇒ 镜头对到该单位（可见）；② `reportUnhandled` 里不再出现 `unit.focus`；③ `unit.focus` 与 `focus.unit` 行为**不混淆**（前者动镜头、后者描边 + 弧线）；④ core 单测覆盖 |
| **依赖** | 无 |

### IX-06 · 右击移动的「agent 语义」是否成立（**OPEN，需用户裁决**）

| 项 | 内容 |
|---|---|
| **问题** | 用户原话是「右击某个位置，**agent 回复收到**」—— 暗示「右击 = 让 agent 走到那儿」。但今天的右击移动**不惊动 agent**（§1.2.4），「收到」是世界层伪造的气泡（`task-fx.ts:361`）。两条路：**A. 保持纯表现语义**（右击 = 视觉调度，不惊动 agent；把气泡文案改成不冒充 agent 的措辞，如「移动」）；**B. 真的下达给 agent**（右击 ⇒ 给该 agent 发一条指令 / 派单，agent 自己走位 ⇒ 需要 `chat.send` 或新的 `unit.dispatch` 命令 + agent-link 通道 + 失败回执 UI） |
| **推荐** | **A**（本期）：气泡文案改为**不含 agent 口吻**的措辞，避免「假回执」继续误导；B 作为独立大单（涉及 agent 会话与失败语义，不该混进交互整理） |
| **验收** | ① 右击后单位头顶气泡文案**不再**是「收到」；② 文档与 UI 不再暗示「agent 已确认」；③（若选 B）agent 侧确实收到指令且能回执 |
| **依赖** | IX-02（先把通道修通） |

### IX-07 · 事件矩阵回归测试（矩阵即测试清单）

| 项 | 内容 |
|---|---|
| **范围** | 把 §2 矩阵的**每一行**落成可执行断言：core 侧纯函数（选择语义 / 编队落位 / 双击判定）+ world 桥接层（每个手势 → 对应命令/事件）+ HUD 侧（抽屉开合、快捷键） |
| **验收** | ① 矩阵每一行都有对应测试或明确的「不适用」标记；② 新增交互必须先在矩阵里有行（**矩阵是开发的入场券**）；③ `npx tsc --noEmit` 零错误 + 全量 jest 绿 |
| **依赖** | IX-02 / IX-03 / IX-04 落地后 |

### 依赖图

```
IX-02 (P0 下行事件通道)
   ├──► IX-03 (双击开聊天框 / 单击只选中)  ← 合并 task_214
   │        └──► IX-04 (ESC 收权 + 焦点让路)
   └──► IX-06 (右键气泡措辞 / agent 语义裁决)

IX-05 (unit.focus 死命令) ── 独立，随时可做
IX-07 (矩阵回归测试)      ── 依赖 IX-02 / 03 / 04 落地
```

**建议排期**：IX-02 → IX-03（含 task_214）→ IX-04 → IX-05 → IX-07；IX-06 待用户裁决措辞口径后并入任意一单。

---

## 5. 新命令走 core 契约的扩展点（总线铁律）

### 5.1 三条通道与各自的方向

| 通道 | 方向 | 载体 | 谁能写 |
|---|---|---|---|
| **命令** | hud → core | `HudCommand`（`core/types.ts:1535`） | HUD 组件（经 `hud/bridge/bus-adapter.ts:87`） |
| **事件** | world → core，core → world | `WorldEvent`（`core/types.ts:1967`） | world 层（经 `world/bridge/bus-adapter.ts`）/ core（转发） |
| **状态** | core → hud & world | `WorldState`（`core/types.ts:1404`） | **只有 core 写** |

**铁律三条（`docs/REFACTOR_PLAN_V3.md` §1）**：
1. **world 不直调 hud** —— world 想让 HUD 做点事，只能发事件给 core，由 core 写进 `WorldState`，HUD 订阅 state 消费。
2. **hud 不直调 world** —— HUD 想指挥画布，只能发 `HudCommand` 给 core，由 core 转发成 `WorldEvent` 给 world（`focus.unit` / `camera.center` 就是这条链的样板）。
3. **core 是唯一裁决方**（铁律 2）—— 载荷合法性、目标是否存在、是否越权，全在 core 判。

### 5.2 扩展点 E-1：「world 触发的 HUD 动作」（双击开聊天框走这条）

**问题**：`双击 agent → 开聊天框` 的触发方在 **world**，接收方在 **HUD**，而 HUD 今天**只有 state 一条入向**（§1.5）—— 中间缺一段。

**推荐路径（world → core → WorldState → HUD）**：

```
world 双击命中单位
  └─ world/bridge/bus-adapter.ts   emitWorldEvent({ type: 'unit.chat.open', unitId })
        └─ core/runtime.ts   裁决：单位在不在场？该单位关联的角色是谁？
              └─ core 写 WorldState 新增可选字段：
                   chatTarget?: { characterId: string; nonce: number }
                   （nonce 单调递增 —— 同一角色连点两次也能再次触发，见 §5.4）
                   └─ HUD 聊天抽屉订阅 state（chat-drawer.ts:565 的 handleState）
                        └─ 看到 chatTarget 变化 ⇒ this.open(characterId)
```

**为什么不走「world 直发 HudCommand」**：违反铁律 1（world 不直调 hud），且 world 无权发命令（命令面是 HUD → core 的单向通道，`core/types.ts:1521` 注释写死）。

**为什么不用「core 直接通知 HUD」**：core 不知道 HUD 的存在（core 不 import hud）；HUD 的入向只有 state 与本地 theme 直落（`hud/bridge/bus-adapter.ts:107`/`:90`）⇒ 走 state 是**唯一不破坏分层**的路。

**新增契约的纪律**（沿用既有先例）：
- `WorldState` 的新字段**必须可选**（契约增补不破既有构造点 —— 见 `core/types.ts:1453` 的同款注释）；
- 新字段**必须有界**（perf：广播数据不能无限增长 —— `chatTarget` 是单对象，天然有界）；
- `WorldEvent` 的新类型要进 `core/types.ts:1967` 的联合，并在 `core/runtime.ts:918` 起的 `handleWorldEvent` 里**显式接地**（不接地就会落 `onUnhandled` 噪音 —— 同 `unit.position` 的处理口径，`core/runtime.ts:980`）；
- **远程模式要额外做两件事**：① 若该事件需要 service 裁决 ⇒ 加进 `FORWARDABLE_WORLD_EVENT_TYPES`（`protocol.ts:209`）与形状校验（`protocol.ts:501`）；② 若 core 要把结果**回推**给客户端 ⇒ 需要 IX-02 的下行通道（`event.push`），否则客户端永远收不到。

### 5.3 扩展点 E-2：「HUD 触发的画布动作」（既有样板，照抄即可）

```
HUD 组件 → adapter.dispatch({ type: '<新命令>' })
  └─ core/runtime.ts handleCommand 裁决
        └─ emitWorldEvent({ type: '<同名或异名事件>' })
              └─ world/bridge/bus-adapter.ts switch → port.syncXxx()
```
样板：`focus.unit`（HUD → core → world，`core/runtime.ts:697`）、`camera.center`（`core/runtime.ts:669`）、`camera.shake`（`core/runtime.ts:678`）。
**注意**：`unit.move` 是**反向同名**先例 —— `HudCommand` 与 `WorldEvent` 同名同载荷、方向相反（`core/types.ts:2017-2021`），runtime 两个入口共用 `applyUnitMove`（`core/runtime.ts:355`）。

### 5.4 扩展点 E-3：「world 需要知道 DOM 焦点」（C-04 的前置）

world 现在**不知道**「聊天框正开着、用户在打字」⇒ 它的 ESC 会抢。要让 world 让路，需要一个**跨层的只读事实**。两条路：

| 方案 | 做法 | 代价 |
|---|---|---|
| **E-3a（推荐）** | 在 core 契约上加一个**可选的** `WorldState.inputFocus?: 'canvas' \| 'dialog'`（由 HUD 在焦点变化时发 `hud.input.focus` 命令写入） | 需要一条新命令 + 一个新状态字段；语义正交、不破坏分层 |
| **E-3b** | world 直接读 DOM（`document.activeElement`） | **违反铁律 1**（world 不该认识 DOM / HUD）；且 Electron 与浏览器的 activeElement 语义不同（shadow DOM 需 `composedPath`，见 `shortcut-manager.ts:215-218`） |

**推荐 E-3a**：把「焦点在哪」变成**core 里的事实**，world 与 HUD 读同一份（与 `infoLayer` / `directorEnabled` 同款口径 —— `core/types.ts:1466`/`:1478`）。

### 5.5 新增事件的命名与登记清单（新增交互的「入场券」）

新增任何画布交互前，必须同时产出：

1. **矩阵一行**（§2.2 的原语 × 对象表）—— 没有行 = 不许实现；
2. **契约一条**：`HudCommand` 或 `WorldEvent` 的新成员 + `core/types.ts` 的注释（写清 why：谁发、谁收、为什么不复用已有命令）；
3. **裁决一处**：`core/runtime.ts` 的 `handleCommand` / `handleWorldEvent` 里的 case（**没有 case = 死命令**，见 C-10）；
4. **白名单登记**（远程模式）：上行 ⇒ `FORWARDABLE_WORLD_EVENT_TYPES`（`protocol.ts:209`）；下行 ⇒ `event.push` 的白名单（IX-02 引入）；
5. **接地**：core 侧显式接地，不落 `onUnhandled`（`core/runtime.ts:980` 的同款口径）；
6. **有界**：若进 `WorldState`，必须可选且有界。

---

## 附录 A · 引用自检（path:line 抽查）

> 自检方式：对每条引用执行「文件存在 + 该行确有对应语义」的核对（脚本输出见本单交付记录）。

| # | 引用 | 语义 | 核对 |
|---|---|---|---|
| R01 | `src/world/scenes/BattlefieldScene.ts:458` | `input.on('pointerdown', …)` | ✅ |
| R02 | `src/world/scenes/BattlefieldScene.ts:886` | 起点命中单位 ⇒ `'click'`，否则 `'box'` | ✅ |
| R03 | `src/world/scenes/BattlefieldScene.ts:933` | 右键短按 ⇒ `issueMoveCommand` | ✅ |
| R04 | `src/world/scenes/BattlefieldScene.ts:1024` | `bridge.unitMove(...)` | ✅ |
| R05 | `src/world/scenes/BattlefieldScene.ts:1016` | `bridge.unitBubble(unitId, bubbleText)`（本地伪造气泡） | ✅ |
| R06 | `src/world/bridge/bus-adapter.ts:439` | `emitWorldEvent({ type: 'unit.move', … })` | ✅ |
| R07 | `src/core/runtime.ts:355` / `:359` | `applyUnitMove` → 逐单位 `emitWorldEvent('unit.position')` | ✅ |
| R08 | `src/core/runtime.ts:937` | `handleWorldEvent` 的 `case 'unit.move'` | ✅ |
| R09 | `src/stratix-gateway/api/websocket/world-sync/protocol.ts:191` | 上行白名单类型（`unit.click` / `selection.box` / `unit.move` / `camera.director`） | ✅ |
| R10 | `src/app/main/main-entry.ts:419` / `:1579` | 远程模式缺省开；远程时**不启动**本地 runtime | ✅ |
| R11 | `src/app/services/persistence/game-save-coordinator.ts:214` | `unit.position` → `unit_positions` 落库订阅者（**只在渲染进程**） | ✅ |
| R12 | `src/world/objects/task-fx.ts:361` | `command: '收到'`（世界层常量，**不是** agent 回复） | ✅ |
| R13 | `src/hud/components/chat-drawer/chat-drawer.ts:578` | 单选一个已关联角色的单位 ⇒ `this.open(characterId)` | ✅ |
| R14 | `src/world/camera/camera-nav.ts:124` | `isDoubleClick`（纯函数判定） | ✅ |
| R15 | `src/core/theme/visual-spec.ts:609` | `doubleClickWindowMs: 320` | ✅ |
| R16 | `src/core/types.ts:228` | `UnitView` 定义起点（**不含坐标**） | ✅ |
| R17 | `src/hud/components/shortcuts/shortcut-manager.ts:243` | `window.addEventListener('keydown', …)` | ✅ |
| R18 | `src/hud/panels/agent-catalog.ts:498` | 发 `unit.focus`（core 无 case ⇒ 死命令） | ✅ |
| R19 | `src/app/main/main-entry.ts:1365` | 小地图位置表吃**本地** `unit.position` | ✅ |
| R20 | `src/world/objects/unit-layer.ts:666` | `applyUnitPosition`（tween 动画的落点） | ✅ |

---

## 附录 B · OPEN（待用户裁决 / 待后续单）

| # | 议题 | 本文档给的推荐 | 影响 |
|---|---|---|---|
| O1 | **ESC 的最终语义**（C-01） | ESC = 关浮层 > 取消选择；镜头归位改绑双击空白 | IX-04 |
| O2 | **「双击 = 开聊天框」是否接受取消「单选自动开抽屉」**（C-03） | 接受（否则双击规格无意义） | IX-03 |
| O3 | **跟随镜头的去处**（C-02） | 双击空白地面 = 回全景 | IX-03 |
| O4 | **右击移动的 agent 语义**（IX-06） | 本期保持纯表现语义，气泡文案去掉 agent 口吻 | IX-06 |
| O5 | **`unit.focus` 落地方式**（C-10） | core 落地并转发为 `camera.center` | IX-05 |
| O6 | **下行事件通道的协议形态**（IX-02） | 新增 `event.push` 消息型；是否同时纳入 `docs/WORLD-SYNC.md` 的对外契约 | IX-02 |
| O7 | **多客户端下 `unit.position` 广播** | 位置是共享真相 ⇒ 广播给全部客户端（与快照一致） | IX-02 |

---

> **本任务边界**：零代码改动；未触碰运行中进程；未修改 `HEARTBEAT.md` / `lra.md` / `.long-run-agent/`；§1 结论全部来自读码取证（未做运行时实测 —— 受本单约束），实测复现与回归步骤已写进 §4 各单的验收标准。
