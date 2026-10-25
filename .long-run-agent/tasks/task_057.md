# task_057 小地图
## 需求
战场缩略图：单位点+视口框+点击跳转（RTS 标配）。
## 要点
1. hud 右下角 minimap 组件（WebComponents+canvas）：世界边界→缩放映射，单位点（kind 色）、视口矩形
2. 相机事件（已有 camera flush）驱动视口框刷新；点击 minimap→core camera.focus 命令（或既有 focus 通路）
3. 单位点点击=选中单位；拖拽 minimap=平移
4. 可折叠（记忆上次状态 localStorage）
## 验收
- 小地图实时反映单位位置与视口；点击跳转准确
- typecheck/jest 全绿

---

## 验证结果（2026-10-26，执行者：task_057 编码代理）

- `npm run typecheck`：**通过**（零错误）
- `npx jest --silent`：**155 suites / 3463 tests 全绿**（3457 passed + 6 skipped；3427 基线不回归，净增 30 例：core/camera 4、runtime 3、world bridge 3、hud minimap 20）

### 落地内容

**core（契约 + 钳制 + 转发）**
- `src/core/types.ts`：`WORLD_BOUNDS` 冻结常量（3200×2400，三侧共用的唯一真相）；HudCommand / WorldEvent 各增 `camera.center {x,y}`（泛化新命令；同名不同向，unit.move 同一先例）
- `src/core/camera.ts`（新）：`clampWorldPoint` 纯函数（四向收边 + 非有限值回落世界中心）
- `src/core/runtime.ts`：camera.center 命令 → 钳制 → 转发 world 通道；world 回环事件显式接地（不进 onUnhandled）

**world（桥 + 场景）**
- `src/world/camera/camera-math.ts`：`DEFAULT_WORLD_BOUNDS` 改为别名 core 的 `WORLD_BOUNDS`（数值单一来源，不破既有导入）
- `src/world/bridge/bus-adapter.ts`：端口可选钩子 `syncCameraCenter(x,y)` + camera.center 转发
- `src/world/scenes/BattlefieldScene.ts`：`syncCameraCenter`（保持 zoom 落位 + 补排 camera flush，视口框停在终帧而不是倒数第二帧）；相机初始位姿补报（场景 create 时上报一声，小地图无需等首次交互就有视口框）
- `src/world/dev/main.ts`：观测面板新增 camera.center 行

**hud（组件）**
- `src/hud/components/minimap/minimap.ts`（新）：`<strat-minimap>` 右下角 200×150 可折叠；canvas 绘制（letterbox 等比映射 / 单位点：皮肤徽标色经 core/theme 皮肤登记表与战场染色同源，无皮肤中性灰，离线 `--srf-text-disabled` 灰显与 054 同语义 / 视口半透明框）；点击单位点 = `unit.select(set)`、点击/拖拽任意处 = `camera.center`（命令经注入 ports.dispatch，组件零 import core/bus/world）；折叠记忆 `stratix.minimap.collapsed`（localStorage，读写异常回落默认展开）；映射/命中纯函数独立导出可测

**app（组合根接线）**
- `src/app/main/main-entry.ts`：mountMinimap 挂 hud-root；单位快照 = WorldState（皮肤/在线位）× 位置累积表（恢复站位起步 + unit.position 事件）；视口矩形 = camera.moved（center+zoom）× battlefield 容器尺寸换算；pagehide 退订 + 卸载

### 数据流（一句话版）
小地图点击/拖拽 → `adapter.dispatch(camera.center)` → runtime `clampWorldPoint` 钳进 WORLD_BOUNDS → world 通道同名事件 → bridge `syncCameraCenter` → 场景 `view.apply`（camera-math 视口钳制）→ `camera.moved`（合并窗口上报）→ 组合根换算视口矩形 → `minimap.setViewport` 重绘画布。

### 未尽事项（如实记录）
1. 小地图未高亮选中集（WorldState.selection 未喂入 —— 规格未要求，接线位已具备：setUnits 快照可扩 selected 位）
2. 画布按 CSS px=canvas px 绘制，未做 devicePixelRatio 高分屏倍率（200×150 的点阵视觉影响极小）
3. 拖拽小地图时命令按 pointermove 逐条直发（进程内 mitt，成本可忽略；相机侧合并窗口已限流上报）
