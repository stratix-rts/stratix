# agent_task_091 —— HUD v3.4 · Z2 事件轨升级 工作文档

> 任务：task_091 —— 左下事件轨（Z2）升级：宽 ≤260px、默认显示 2 条 +「展开 N 条」、
> 条目 hover 展开详情行（完整文案 + 相对时间，布局不跳动）、点击条目经 core 总线发 `focus.unit`
> （带单位 id）；保留现有分级配色与出入场动效。
> 方案依据：docs/hud-redesign-proposal.html §2.5（分区规格表 Z2 行）+ §1.3（左下事件轨痛点）。
> 分支：demo/v3.3（commit 前缀 v3.4）。日期：2026-11-03。

## 1. 交付物

| 文件 | 职责 |
|---|---|
| `src/core/types.ts` | **契约增补**：`HudCommand` 的 `focus.unit`（hud → core 的意向）+ `WorldEvent` 的 `focus.unit`（core → world 的落位指令，同名不同向） |
| `src/core/runtime.ts` | `focus.unit` 命令接线：core 只转发（不写 WorldState，联动是瞬态表现）+ world 通道回环显式接地（不进 `onUnhandled`） |
| `src/core/theme/visual-spec.ts` | **唯一事实源**：`MARQUEE_METRICS.maxWidthPx = 260` + `MARQUEE_METRICS.collapsedVisible = 2` |
| `src/hud/components/marquee/marquee.ts` | **Z2 事件轨组件**：宽度上限 / 折叠展开（`is-hidden` + 「展开 N 条」按钮）/ hover 详情板（绝对定位，脱流）/ 点击发 `focus.unit`（经注入的 `dispatch` 端口） |
| `src/hud/components/marquee/marquee-catalog.ts` | **纯逻辑层**：条目模型扩 `detail` / `unitId`；`resolveTaskTitleFull` / `resolveUnitIdForTask` / `marqueeDetailFor` / `focusUnitCommand` |
| `src/app/main/main-entry.ts` | 组合根接线：`mountMarquee` 注入 `dispatch`（→ `adapter.dispatch`）+ 上下文补 `taskTitleFull` / `unitId` |
| `src/stratix-gateway/api/websocket/world-sync/protocol.ts` | `focus.unit` 入册命令白名单（`Record<HudCommand['type'], true>` 编译期强制） |
| `src/world/dev/main.ts` | dev 观测面板补 `focus.unit` 分支（`WorldEvent` 穷举 switch，缺分支会编译报错） |
| `src/core/__tests__/focus-unit.test.ts` | core 侧闭环单测 3 例（转发 / 不写状态 / 回环接地） |
| `src/hud/__tests__/marquee.test.ts` | HUD 侧集成测试（jsdom）新增 17 例（折叠展开 / hover 详情 / 点击发事件 / 几何 / 纯逻辑） |

## 2. 关键设计决策

1. **两段式总线（hud → core → world），不新开通道**：条目点击发 `HudCommand { type: 'focus.unit', unitId }`
   → core 转发为同名 `WorldEvent` → world 层消费（task_092 的描边高亮 + 引导弧线）。
   与 `camera.center` / `camera.shake` / `camera.director` 同一口径（同名不同向），
   HUD 侧只经 `adapter.dispatch` 出口，**组件零 import core/bus**（铁律）。
   why 不并进 `unit.focus`：那条是**相机动作**（镜头对到某单位），本条是**单位联动**的诉求
   （描边 + 引导弧线），语义正交 —— 并进去就得给 `unit.focus` 加「要不要联动」的开关位，契约会变浑。
2. **core 只转发、不写 WorldState**：联动是瞬态表现（没有「单位正在被聚焦」这种业务态），
   与 `camera.shake` 同款；回环的 `focus.unit` 在 `handleWorldEvent` 显式接地，
   否则每次点击报一次「未处理」噪音。
3. **折叠用「留 DOM + `display:none`」，不销毁节点**：被折叠的条目留在 DOM 里（展开时原位出现），
   条数上限仍由 `MARQUEE_METRICS.maxEntries = 5` 兜着 —— DOM 节点数恒定 ≤6，无泄漏、无重建开销。
4. **hover 详情用绝对定位（脱流）→ 布局不跳动**：详情板是条目内的 `position: absolute` 面板，
   只切 `opacity` / `visibility`（合成属性，不触发布局重排，perf 铁律）。
   why 不用「就地撑高」：撑高会把下方条目顶走 —— 悬停时画面在动，正是要避免的。
   栈**最底下**那条的详情翻到**上方**（往下翻会出屏）。
5. **hover 走 JS 事件而不是纯 CSS `:hover`**：焦点可达（键盘也能看详情、也能聚焦单位），
   且状态可被单测直接断言（jsdom 没有 `:hover` 状态）。
6. **宽度与折叠条数落唯一事实源**：`MARQUEE_METRICS.maxWidthPx = 260` / `collapsedVisible = 2`
   是**验收数字**（HUD 按它写样式、单测按它断言、评审按它核对），抄成两份必然对不上。
7. **与控制岛零重叠靠几何保证**：轨道右缘 = 左边距 16 + 宽 260 = **276px**；
   控制岛（Z4，56% 屏宽贴底居中）左缘 = 22% 屏宽 —— 1280 宽下 281px、1920 宽下 422px → 均不相撞。
8. **零新依赖、零资产**：图标仍是字形，详情板是纯 CSS 绘制。

## 3. 验证

| 项 | 命令 / 方式 | 结果 |
|---|---|---|
| 类型 | `npx tsc --noEmit` | 零错 |
| HUD 全量 | `npx jest src/hud --maxWorkers=2` | 48 套件 / 978 用例全绿 |
| core 全量 | `npx jest src/core --maxWorkers=2` | 38 套件 / 807 用例全绿 |
| gateway | `npx jest src/stratix-gateway --maxWorkers=2` | 21 套件 / 222 用例全绿 |
| lint | `npx eslint --cache --max-warnings 200 <改动文件>` | 本任务文件零错（`runtime.ts` / `main-entry.ts` 的 `import/order` 报错是 HEAD 既有问题，未新增） |
| 浏览器实测 | Playwright + Chromium（1280×720，临时页，已删） | 轨道 260px 宽；折叠 2 条 + 「展开 3 条」；悬停后条目 y 坐标**不变**（`same/same`）；详情板可见（完整标题 + 相对时间）；点击发出 `{"type":"focus.unit","unitId":"u-2"}`；展开 5 条 / 收起 2 条 |

## 4. 未尽事项（移交 task_092）

- world 侧消费 `focus.unit`：单位描边高亮 + 左下条目到中屏单位的引导弧线（屏幕空间绘制）。
- 契约已就位（`WorldEvent.focus.unit`），world 侧在 `src/world/bridge/bus-adapter.ts` 订阅即可。
