# task_004

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_004.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

V3骨架: world/ Phaser战场骨架-模块

## requirements

依据 `docs/REFACTOR_PLAN_V3.md`（V3.1 冻结版）第 1/2 节建立 Phaser 世界层 `src/world/`：

1. `src/world/scenes/BattlefieldScene.ts`：**唯一主场景**，装配相机、单位渲染层、框选框与总线桥，处理鼠标交互。
2. `src/world/camera/`：镜头控制（平移 / 缩放 / 边界钳制）。钳制规则必须是**零 Phaser 依赖的纯函数**，才能在 jest 的 node 环境下单测。
3. `src/world/objects/`：最小 Unit 渲染对象，读 `WorldState.units` 渲染单位（业务态文字/徽标留给后续任务）。
4. `src/world/bridge/bus-adapter.ts`：订阅 core 的 state 变更驱动场景对象同步；把场景交互转成 `WorldEvent` 发回 core。
5. 另建 dev-only 最小挂载入口（独立 HTML），不接入现有主 UI。
6. Phaser 沿用项目现有 3.90 依赖，不升级；旧 `stratix-rts` 是 legacy，不动不引。
7. 每个新文件头部写契约注释（职责 / 输入输出 / 禁止事项）。
8. 铁律：world 只通过 bus-adapter 与 core 通信，**禁止 import 任何 hud/vue 代码**。

## acceptance

- [x] `build` 通过
- [x] 相机控制逻辑有单测覆盖（边界钳制）
- [x] bus-adapter 双向联通可测（state→场景同步、场景事件→WorldEvent）
- [x] `src/world/` 零 hud/vue 引用
- [x] 不引入新依赖（Phaser 3.90 / mitt 均为既有依赖）

## 交付物

新增 `src/world/`（Phaser 3.90），无任何旧文件改动：

| 文件 | 职责 |
|------|------|
| `src/world/camera/camera-math.ts` | 相机钳制**唯一事实源**，纯函数零 Phaser：`clampZoom` / `clampCameraCenter` / `resolveCameraPose` / `panCameraPose` / `zoomCameraPose` / `isSamePose`。先钳 zoom 再钳 center（半视口 = 视口 / (2·zoom)，顺序反了会算错活动范围）；视口比世界还大时该轴锁死世界正中 |
| `src/world/camera/camera-controller.ts` | 把钳制结果写进 Phaser 相机。对相机只用结构类型 `CameraTarget { scrollX, scrollY, width, height, zoom }`，因此本文件同样可单测。位姿无实质变化时不触发 `onChange` |
| `src/world/camera/index.ts` | camera 目录出口（零渲染依赖） |
| `src/world/objects/unit-object.ts` | 单个单位的最简对象：世界层自治的位置 + `UnitView` 业务态镜像。**`sync()` 只更业务态绝不碰坐标** —— core 的 `UnitView` 根本不含坐标 |
| `src/world/objects/unit-registry.ts` | 单位集合唯一持有者：`UnitView[]` 全量对账（新增/移除/更新）、网格落位（槽位回绕，不落在战场外）、`queryBounds` 框选命中、`hitTest` 顶层命中 |
| `src/world/objects/unit-layer.ts` | Phaser 渲染层：按 id 增删改显示对象，按 status 着色，选择集/预览集分别渲染 |
| `src/world/objects/selection-box.ts` | 框选矩形的显示对象（拖拽期间可见，松手即隐藏） |
| `src/world/objects/index.ts` | objects 目录出口（⚠️ 会连带拉入 Phaser，纯逻辑单测须从具体模块直导） |
| `src/world/bridge/bus-adapter.ts` | **双向总线桥**：`onState` → `WorldScenePort.syncUnits/syncSelection`；场景调 `WorldEventSink` → `emitWorldEvent`。`camera.moved` 带 120ms 合并窗口（拖拽/滚轮逐帧广播会打爆总线），`flushCamera()` 补发末位姿；`destroy()` 退订 |
| `src/world/scenes/BattlefieldScene.ts` | 唯一主场景。实现 `WorldScenePort`，自建桥接层；左键拖空地=框选、左键点单位=`unit.click`、右键/中键拖拽=平移、滚轮=缩放；shutdown 统一清理监听与显示对象 |
| `src/world/dev/world-dev.html` + `src/world/dev/main.ts` | dev-only 独立入口，vite 不把它打进正式产物。两块 DOM 观测面板**不属于 world 层**（world 只画战场不画 HUD） |
| `src/world/__tests__/{camera,bus-adapter,unit-registry}.test.ts` | 55 条单测，见下 |

## 验证证据（完成前必填）

- [x] **实现证明**: 钳制规则与命中判定全部下沉为零 Phaser 依赖的纯函数（`camera-math.ts` / `unit-registry.ts`），Phaser 只出现在 `scenes/`、`objects/unit-layer.ts`、`objects/selection-box.ts`、`dev/`；场景通过实现 `WorldScenePort` 被总线桥驱动，不直接 import core/store；`src/world/` 全部 import 只有 `phaser` + `core/types` + `core/bus` + 层内模块（`core/store` 仅出现在 dev 入口与单测中）
- [x] **测试验证**: typecheck（主 + test 两份 tsconfig）/ build / eslint / jest 全部通过，见下方命令输出
- [x] **影响范围**: 纯新增目录 `src/world/`，无任何旧代码引用它 → 对现有功能零影响；未触碰 `src/stratix-rts` 与任何旧 Vue 代码；未引入新依赖

### 测试步骤
1. `npm run typecheck`（tsc --noEmit）
2. `npx tsc -p tsconfig.test.json --noEmit`（typecheck:tests）
3. `npm run build`（tsc + tsc-alias + vite build）
4. `npx jest src/world src/core --maxWorkers=2`
5. 附加：`npx eslint --cache src/world`（只 lint 改动文件）

### 验收自检
| 项 | 结果 |
|----|------|
| build 通过 | ✅ `✓ built in 2m 9s`，后端 `dist/world/**.js` 11 个产物齐全 |
| 相机单测覆盖边界钳制 | ✅ 11 条 `clampCameraCenter` 用例（四边越界 / zoom 影响半视口 / 视口大于世界 / 视口等于世界 / 非法世界尺寸 / NaN 兜底）+ 控制器 5 条 |
| bus-adapter 双向联通可测 | ✅ state→场景 5 条、场景→WorldEvent 5 条、camera 合并 5 条，打的是**真实 core/bus 单例**而非 mock |
| 零 hud/vue 引用 | ✅ grep 全目录仅命中一条"禁止事项"注释，无实际 import |
| 未引入新依赖 | ✅ 仅用既有 `phaser@3.90.0` |
| lint | ✅ 0 problems |

### 验证结果

```
$ npx tsc --noEmit
exit=0
$ npx tsc -p tsconfig.test.json --noEmit
exit=0

$ npm run build
✓ built in 2m 9s
$ find dist/world -type f -name "*.js" | sort
dist/world/bridge/bus-adapter.js
dist/world/camera/camera-controller.js
dist/world/camera/camera-math.js
dist/world/camera/index.js
dist/world/dev/main.js
dist/world/objects/index.js
dist/world/objects/selection-box.js
dist/world/objects/unit-layer.js
dist/world/objects/unit-object.js
dist/world/objects/unit-registry.js
dist/world/scenes/BattlefieldScene.js

$ npx jest src/world src/core --maxWorkers=2
Test Suites: 6 passed, 6 total
Tests:       106 passed, 106 total
Snapshots:   0 total

$ npx eslint --cache --max-warnings 200 src/world
（0 problems）

$ grep -rhn "from '" src/world --include="*.ts" | sed "s/.*from '//;s/'.*//" | sort -u
../../core/bus
../../core/store
../../core/types
phaser
（其余均为 src/world 层内相对引用）
```
