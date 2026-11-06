# agent_task_218 · IX-05「`unit.focus` 死命令」处置

> 任务：task_218（IX-05 unit.focus 死命令清理） · 分支 `demo/v3.3` · 落地于 2026-11-07
> 权威定义：`.long-run-agent/tasks/task_218.md` + `docs/DESIGN-canvas-interactions.md` §4 IX-05

## 一、盘点结论（先看事实，再看处置）

`unit.focus` 是 **HudCommand**（`core/types.ts`），发出方是 HUD agent 卡片的「聚焦」按钮
（`src/hud/panels/agent-catalog.ts:498` → `buildAgentCommand('focus', unitId)`）。

落地前的链路断点：

```
HUD 卡片「聚焦」 → HudCommand unit.focus → core/runtime.ts 的 handleCommand
                                                  └─ 无 case 'unit.focus' → default → reportUnhandled（死命令：点了没反应）
```

证据（落地前）：`core/runtime.ts` 的 `handleCommand` switch 里没有 `case 'unit.focus'`；
文档 §1.5 / §3 C-10 / 附录 A R18 三处都把它记成 ❌ 死命令。

## 二、处置结论：**保留命令 + core 落地接线**（文档 §4 IX-05 的推荐 ①）

### 为什么不是「删命令 / 标 deprecated」

§4 IX-05 给了两条路：**① core 落地**（推荐）或 ② 删命令 + HUD 改发 `camera.center`；
附录 B 的 O5 也把推荐写成「core 落地」。逐条比对：

| 文档结论 | 本单处置 | 理由 |
|---|---|---|
| §4 IX-05 范围「core 落地 `unit.focus`（推荐）」 | ✅ 采纳 | 卡片「聚焦」的语义完整保留（「聚焦 = 动镜头」），且与 `focus.unit` 的「描边 + 弧线」分工不混淆（`core/types.ts` 已写明该分工）。 |
| §4 IX-05 验收 ① 镜头对到该单位（可见） | ✅ 满足 | world 场景按 unitId 查单位并把镜头对过去。 |
| §4 IX-05 验收 ② `reportUnhandled` 里不再出现 `unit.focus` | ✅ 满足 | core 已有 `case 'unit.focus'`；core 单测断言 `unhandled` 为空。 |
| §4 IX-05 验收 ③ 与 `focus.unit` 不混淆 | ✅ 满足 | `unit.focus` 只动镜头；`focus.unit` 只描边 + 弧线。core 单测断言不发 `focus.unit`。 |
| §4 IX-05 验收 ④ core 单测覆盖 | ✅ 满足 | `src/core/__tests__/runtime.test.ts` 新增 4 例。 |
| ② 删命令 + HUD 改发 `camera.center` | ❌ 走不通 | **HUD 侧也没有坐标**：`UnitView` 明文「不含位置 —— 位置由世界层自治，core 与 HUD 都不持有坐标真相」。HUD 无从发出带坐标的 `camera.center`。 |

⇒ **书面保留理由**（替代任务书里「引用清零」的另一半）：`unit.focus` 是「卡片聚焦 ⇒ 镜头对到该单位」
这条交互的**唯一合法载体**；坐标解析只能在 world 侧做（core 与 HUD 都不持有坐标真相），
所以这条命令不是冗余契约，而是**两段式铁律下必需的载体**。

### 与文档字面写法的出入（已在设计文档 §4 写明）

文档写的是「core 落地 `unit.focus` ⇒ **转发为 `camera.center`**」。实际落地**没有**在 core 里转成
`camera.center`，而是转发**同名 WorldEvent** `unit.focus` → world 场景解析坐标 → 移镜头。原因：
core 手里只有 `unitId`，**换不出世界坐标**（`UnitView` 无坐标字段），`camera.center` 需要 x/y。
两段式（命令 hud → core、事件 core → world）与 `camera.center` / `focus.unit` 完全一致。

## 三、改动清单

| 文件 | 改动 |
|---|---|
| `src/core/types.ts` | `HudCommand unit.focus` 的契约注（接线落地 + 与 `focus.unit` 的分工 + 保留理由）；新增 WorldEvent 变体 `unit.focus` |
| `src/core/runtime.ts` | `handleCommand` 新增 `case 'unit.focus'` → 转发同名 WorldEvent；`handleWorldEvent` 显式接地（回环不报未处理）；文件头接线记录 |
| `src/world/bridge/bus-adapter.ts` | `WorldScenePort` 新增可选钩子 `syncUnitFocus?(unitId)`；world 通道 `case 'unit.focus'` 转发进场景 |
| `src/world/scenes/BattlefieldScene.ts` | 实现 `syncUnitFocus`：查单位 → 解除跟随 + 导演让位（手动优先）→ 镜头一次性对到该单位 |
| `src/world/dev/main.ts` | dev 观测面板补 `unit.focus` 事件行 |
| `src/core/__tests__/runtime.test.ts` | 新增 4 例（命令 → 事件转发 / 不落 unhandled / 与 focus.unit 不混淆 / 回环接地） |
| `src/world/__tests__/bus-adapter.test.ts` | 新增 3 例（转发 / 可选钩子不实现时安静跳过 / destroy 后不转发） |
| `src/stratix-gateway/.../endpoint.test.ts`、`scripts/smoke-world-sync.ts` | 「无人接管命令」的例子从 `unit.focus` 换成 `cache.clear`（core runtime 无此 case ⇒ 例子才名副其实） |
| `docs/DESIGN-canvas-interactions.md` | §1.5 命令面表、§3 C-10、§4 IX-05 实施口径（新增）、附录 A R18、附录 B O5 全部对齐实际落地 |

**未改**：`src/hud/**`（HUD 侧的构造与派发本来就是对的 —— 命令没被消费是 core 的问题）。

## 四、已知边界（不在本单范围）

- **远程模式**：客户端不起本地 runtime，`unit.focus` 经协议上行到 service 侧 core → service 侧 world 通道；
  而**相机类事件的下行白名单目前只有 `unit.position`** ⇒ 客户端镜头不会跟着动。
  这与既有的 `camera.center` / `focus.unit` 是**同一个结构性缺口**，不在 IX-05 范围，另议。
- 聚焦**不开跟随**：一次性跳转（与 `focus.unit` 的「联动」语义正交）。

## 五、验证

- `npx tsc --noEmit` ⇒ 零错误
- `npx jest`（全仓）⇒ 全绿（输出见任务回报）
- grep 证据：`unit.focus` 的引用点全部是**活链路**（契约 / core 接线 / world 消费 / 测试 / 文档），
  零「发出但无人消费」的僵尸引用；`reportUnhandled` 路径上已无 `unit.focus`。
