# task_092 · HUD v3.4 · Z2b 单位联动（world 侧）

> 契约来源：task_091（commit e5acf33）已定义 `focus.unit` 命令 / 同名 WorldEvent 并发送。
> 本任务只做**消费端**：world 侧收到事件 → 描边高亮 + 引导弧线；导演模式开启 → 中屏取景框。

## 1. 交付边界

| 交付物 | 位置 | 说明 |
|---|---|---|
| 描边高亮（霓虹 + 呼吸） | `src/world/objects/unit-layer.ts` | 单位层新增 `focusOutline` Graphics + `setFocused(unitId)` |
| 引导弧线（屏幕空间） | `src/world/objects/focus-link.ts`（纯逻辑）+ `focus-link-layer.ts`（渲染层） | 起点锚 HUD 事件轨，终点为单位屏幕坐标 |
| 导演取景框（L3） | `src/world/objects/director-frame.ts` + `director-frame-layer.ts` | 四角括号 + 「🎬 导演」标注，呼吸 |
| 世界 → 屏幕换算契约 | `src/core/camera.ts` 的 `worldToScreen` + `src/core/types.ts` 的 `CameraState` / `ViewportSize` | 两侧共用的换算公式，冻结在 core |
| 度量（唯一事实源） | `src/core/theme/visual-spec.ts` 的 `FOCUS_LINK_METRICS` / `DIRECTOR_FRAME_METRICS` / `STAGE_METRICS` | world 门面 `src/world/theme.ts` / `src/world/visual-spec.ts` 转发 |

**不动**：HUD 侧事件轨组件（091 交付）、任何 hud 文件、依赖清单。

## 2. 关键取舍

1. **弧线画在屏幕空间（scrollFactor = 0）**，不是世界坐标。
   起点钉在 HUD 事件轨（一个屏幕位置），终点是单位；若整条线画在世界坐标里，起点会随镜头
   一起漂，就从「事件轨」变成了「地图上的某个点」。每帧用 `worldToScreen` 把单位的世界坐标
   换算成屏幕坐标 → 镜头一动线跟着走。
2. **换算公式冻结在 core**：`屏幕 = 视口/2 + (世界 - 相机中心) × zoom`。
   相机写回 `scroll = center - 视口/2`，Phaser 的 `midPoint = scroll + 视口/2` 且与 zoom 无关；
   可见世界区间 `center ± 视口/(2·zoom)` 铺满视口 ⇒ 相机中心恒在屏幕正中。
   ⚠️ 不可写成 `(世界 - scroll) × zoom`：zoom = 1 时碰巧对，zoom ≠ 1 时弧线端点会漂。
3. **焦点裁决在 world 侧的板子里**（`FocusLinkBoard`），不在 core：core 只转发
   （联动是瞬态表现，不写 WorldState，与 `camera.shake` 同口径）。「再点一次 = 取消」
   是一条规则 → 必须有单测 → 故规则不散在渲染层里。
4. **描边画在单位层、弧线画在屏幕空间**：描边是「这个单位被点了」的本体提示，要跟着单位走；
   弧线是连线。两者职责不同、生命周期不同（描边跟单位，弧线跟镜头）。
5. **取景框框的是「中屏」而非整块画布**：HUD 的顶栏 / 左右栏 / 底栏是覆盖在画布上的浮层，
   框在整个画布上四角会藏在侧栏底下。world 不能 import hud（铁律）→ 在 core 里按同一组
   口径复算（`STAGE_METRICS`，含显式的耦合声明：改 HUD 分区尺寸时要同步改这里）。
6. **取景框用括号而不是整圈边框**：整圈边框把中屏切成「窗」，观感是遮挡；四角括号是取景器
   的传统语言 —— 提示「这里在被拍摄」，不遮内容。
7. **描边两圈（外发光 + 亮线）**：粗线只有一种亮度，读作「粗边框」；辉光 + 实亮线才读作「霓虹」。

## 3. 取消 / 失焦语义

| 动作 | 结果 |
|---|---|
| 再次点击同一条目 | 解锁（弧线收、描边褪）—— `FocusLinkBoard.focus` 同 id → clear |
| 点选另一条目 | 改锁（弧线重画 + 重新淡入） |
| 被锁定单位离场 | 失焦（`syncUnits` 的 removed 分支 + 每帧同步兜底） |
| 目标单位不在场 | 失焦（`syncFocusLink` 检出后一并收掉弧线与描边） |

## 4. 验收对照

| 验收标准 | 落点 | 测试 |
|---|---|---|
| hud/integration：发 focus.unit → world 收到并高亮 | `bus-adapter.ts` 的 `case 'focus.unit'` → `syncFocusUnit` → `unitLayer.setFocused` | `src/world/__tests__/focus-unit-wiring.test.ts`（真实总线 + 真实 core runtime） |
| 弧线 800ms 内出现且跟随镜头 | `FOCUS_LINK_METRICS.arcFadeInMs = 800` + 每帧 `focusLink.sync(...)` | `focus-link.test.ts`（淡入口径 / 弧线几何 / 换算公式） |
| 再点击 / 失焦可取消 | `FocusLinkBoard` + 场景的两处失焦分支 | `focus-link.test.ts`（板的语义）+ `director-frame.test.ts` |
| 导演取景框开合正确 | `camera.director` → `syncDirectorMode` → `directorFrame.setEnabled` | `focus-unit-wiring.test.ts`（事件送达）+ `director-frame.test.ts`（中屏几何） |
| `npx tsc --noEmit` 零错 | — | 见提交说明 |
| world 目录级 jest 全绿 | — | 30 套件 / 477 用例 |

## 5. 验证

```
npx tsc --noEmit                       → 零输出（零错）
npx jest src/world --maxWorkers=2      → Test Suites: 30 passed, 30 total / Tests: 477 passed
npx jest src/core  --maxWorkers=2      → Test Suites: 38 passed, 38 total / Tests: 807 passed
npx eslint --cache <改动文件>           → 零输出
```

> 注：`src/world/appearance/__tests__/brand-presets.test.ts` 需要构建产物
> `dist/frontend/spritesheets/item-metadata.json`（本 worktree 未构建，从主仓 dist 拷入即可，
> dist/ 已被 .gitignore 忽略，不进提交）。

## 6. 与主仓并行编辑的处理

`src/core/theme/visual-spec.ts` 是**共享文件**（task_090 的 agent 同时在改它：
`CONTROL_ISLAND_METRICS`）。本任务只提交自己的三块（`FOCUS_LINK_METRICS` /
`DIRECTOR_FRAME_METRICS` / `STAGE_METRICS`），用 `git hash-object` + `git update-index
--cacheinfo` 定点写索引，别人那部分改动原样留在工作区（unstaged），由他们自己提交。
