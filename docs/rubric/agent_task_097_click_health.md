# task_097 · HUD 全量点击体检表（v3.4 验收修复）

> 真机反馈：「不少按钮没反应」→ 本表逐元素走**真实点击路径**（jsdom 集成测试），
> 每行记录：元素 / 点击路径 / 预期 / PASS-FAIL / 原因。
>
> 体检口径与 task_095 的 40 项断言**互补**：095 验「**可达**」（DOM 存在、位对得上），
> 095 验不出「**点了有反应**」。本表把口径升级为「点下去 → **看得见的状态变了**」。
>
> 回归防线：`src/hud/__tests__/click-health.test.ts`（40 项断言，全部走真实点击路径）。
> 装配口径照抄生产：`#hud-side`（pointer-events:none）> `#hud-root`；
> 小地图 / 事件轨挂 `#hud-root`、层级三档开关挂 `#hud-side` —— 与 `app/main/main-entry.ts` 一致。
> 闭环是真的：不 mock 总线，走「点击 → adapter.dispatch → core/bus → core/runtime → store → 广播 → HUD 重绘」。

---

## 一、结论速览

| 项 | 数 |
|---|---|
| 体检元素总数 | 40 |
| PASS | 39 |
| FAIL（已修） | 1（FAIL-01，**级联影响 6 个元素**，见下） |
| N/A（设计如此，非可点元素） | 见各行「原因」列 |
| 新增回归断言 | 40 项（`click-health.test.ts`），其中 4 项专盯 FAIL-01 复发 |

**唯一的真缺陷（FAIL-01）**：主屏用 `host.innerHTML = ...` 重写**整个宿主**，
把组合根挂在同一宿主下的**覆盖层**（小地图 / 事件轨 / toast / 聊天抽屉 / 里程碑 / 快捷键帮助）
一次性抹掉且**永不重挂**。真机表现 = 「点一下顶栏 ▶演示，之后小地图、事件轨、聊天入口、toast、快捷键帮助**全部没反应**」。
这一条同时解释了用户说的「**不少**按钮没反应」—— 不是一批按钮各自坏了，是**一批覆盖层被一次性抹掉了**。

---

## 二、逐元素体检表

### 2.1 顶栏 7 元素位 + ⋯ 弹层 5 项（task_089）

| # | 元素 | 点击路径 | 预期（可见状态变化） | 结果 | 原因 / 断言 |
|---|---|---|---|---|---|
| 1 | 品牌 `Stratix` | `.click()` 文本节点 | 无命令、无状态变化 | **PASS** | 纯展示元素，设计如此（无点击语义）。断言 `commands.length === 0` |
| 2 | 态势胶囊 | `.click()` | 无命令；数值随 state 广播更新 | **PASS** | 纯展示。断言 `unit-count` 由 `1`→`2` 随 store 更新 |
| 3 | 通知徽标 | `.click()` | 无通知时 `hidden`；有通知时显示计数；点击不发命令 | **PASS** | 纯展示（当前无点击语义）。断言 `hidden` 翻转 + 文本 `'1'` + 无命令 |
| 4 | 🔊 声音开关 | **进 shadow DOM 点真 `<button>`** | `aria-pressed` 翻转 + localStorage 落盘 + 音量滑条随开关联动 | **PASS** | handler 已接。断言 `stratix.sound.enabled='0'`、`aria-pressed='false'`、`variant='default'`、滑条 `disabled=true` |
| 5 | 🔊 音量层（入口） | `.click()` 音量计 | 弹层 `hidden` 翻转 | **PASS** | 断言 `sound-popover.hidden === false` |
| 6 | 🔊 音量滑条 | `input` 事件 | localStorage + 音量计宽度 + 数值文本**三处同步** | **PASS** | 断言 `stratix.sound.volume='35'`、`sound-level-value='35%'`、`level-fill.style.width='35%'` |
| 7 | 🎬 导演 | **进 shadow DOM 点真 `<button>`** | `camera.director` 进 core → core 写 `directorEnabled` → 按钮点亮 | **PASS** | 闭环证据：`store.getState().directorEnabled === true`（不是测试自己改属性）+ `aria-pressed='true'` + `variant='primary'` |
| 8 | ▶ 演示 | **进 shadow DOM 点真 `<button>`** | 演示态开 + localStorage + 工程件（日志抽屉）下线 + 按钮点亮 | **PASS** | 断言 `demoMode.enabled`、`stratix.demo-mode='on'`、`log-drawer.hidden=true`、`strat-log-drawer` 未挂载 |
| 9 | ⋯ 溢出钮 | **进 shadow DOM 点真 `<button>`** | 菜单 `hidden` 翻转 | **PASS** | 断言 `overflow-menu.hidden === false` |
| 10 | ⋯① 打开聊天 | 进 shadow 点真 `<button>` | `ui.navigate chat` + 冒泡 `stratix:chat-open`（抽屉入口）+ 菜单自动收起 | **PASS** | 断言命令 + 事件触发 1 次 + `overflow-menu.hidden===true` |
| 11 | ⋯② 会话面板 | 进 shadow 点真 `<button>` | 会话面板 `collapsed` 翻转 | **PASS** | 断言 `strat-session-panel` 的 `collapsed` 属性由 `true`→`false` |
| 12 | ⋯③ 看角色 | 进 shadow 点真 `<button>` | `ui.navigate character` → core 写屏位 → **主屏真的换屏** | **PASS** | 断言命令 + `currentScreen==='character'` + `strat-character-screen` 已挂 |
| 13 | ⋯④ 去设置 | 进 shadow 点真 `<button>` | `ui.navigate settings` → core 写屏位 → **主屏真的换屏** | **PASS** | 断言命令 + `currentScreen==='settings'` + `strat-settings-screen` 已挂 |
| 14 | ⋯⑤ 像素风 | 进 shadow 点真 `<button>` | `theme.set pixel` + 菜单项文案换名 | **PASS** | 断言命令 + `label` 由「默认」变「像素」 |
| 15 | 点顶栏以外 | `document.body` 派发 click | 两个弹层都收起 | **PASS** | 断言 `overflow-menu.hidden===true` |

> 顶栏元素位 1–14：**无 FAIL**。嫌疑 (b)（task_089 弹层 handler 漏接）**证伪** —— 弹层开合、点外面关、菜单项 handler 全部接到位。

### 2.2 事件轨（Z2，task_091）

| # | 元素 | 点击路径 | 预期（可见状态变化） | 结果 | 原因 / 断言 |
|---|---|---|---|---|---|
| 16 | 展开钮 | 进 shadow 点真 `<button>` | `expanded` 翻转 + 文案「展开→收起」+ 隐藏条数归零 | **PASS** | 断言 `marquee.expanded===true`、`textContent==='收起'`、`hiddenCount===0` |
| 17 | 条目（带单位） | shadow 内 `.entry` `.click()` | `focus.unit` 真派发（core 转同名 world 事件） | **PASS** | 断言 `commands` 含 `focus.unit` + world 通道收到 `focus.unit` 事件 |
| 18 | 里程碑条目 | shadow 内 `.entry` `.click()` | 不可点（无 `data-clickable`），不发命令 | **PASS（设计如此）** | 无关联单位 → 无聚焦目标。断言 `data-clickable` 为 null + 无命令 |

### 2.3 小地图（Z3，task_057 / task_093）

| # | 元素 | 点击路径 | 预期（可见状态变化） | 结果 | 原因 / 断言 |
|---|---|---|---|---|---|
| 19 | 折叠钮 | 进 shadow 点真 `<button>` | `data-collapsed` 翻转 + `aria-expanded` 跟随 + 文案换箭头 | **PASS** | 断言 `collapsed===true`、`aria-expanded==='false'`、`textContent==='▸'` |
| 20 | 画布点单位 | `pointerdown`（带坐标） | `unit.select` + `camera.center` **两条**命令都派发 | **PASS** | 断言两条命令都在 `commands` 里 |
| 21 | 画布点空白 | `pointerdown`（带坐标） | 只发 `camera.center`，**不误选**单位 | **PASS** | 断言无 `unit.select`、有 `camera.center` |

### 2.4 控制岛命令面板 6 条（Z4，task_090）

| # | 元素 | 点击路径 | 预期（可见状态变化） | 结果 | 原因 / 断言 |
|---|---|---|---|---|---|
| 22 | 面板构成 | 读 shadow | 1 行 6 条（`mission.create` / `chat.open` / `character.open` / `settings.open` / `theme.default` / `theme.pixel`） | **PASS** | 断言 `buttons.length===6` 且 `data-command` 顺序一致 |
| 23 | 打开聊天 | shadow 内 `.click()` | `ui.navigate chat` 真派发 | **PASS** | 断言命令 |
| 24 | 打开角色 | shadow 内 `.click()` | `ui.navigate character` 真派发 | **PASS** | 断言命令 |
| 25 | 打开设置 | shadow 内 `.click()` | `ui.navigate settings` 真派发 | **PASS** | 断言命令 |
| 26 | 切换到像素风 | shadow 内 `.click()` | `theme.set pixel` 真派发 | **PASS** | 断言命令 |
| 27 | 切换到现代风 | shadow 内 `.click()` | `theme.set default` 真派发 | **PASS** | 断言命令 |
| 28 | 新建任务（**未填标题**） | shadow 内 `.click()` | 按钮 `disabled` → 点击不派发 | **PASS（正确降级）** | 未填标题是禁用态，**不是没反应**。断言 `disabled===true` + 无 `mission.create` 命令 |
| 29 | 新建任务（**填了标题**） | 填 `draft` → `input` → `.click()` | 按钮解禁 → `mission.create` 真派发 | **PASS** | 断言 `disabled===false` + 命令 `{title:'去侦察'}` |

### 2.5 当日回放条（task_082）

| # | 元素 | 点击路径 | 预期（可见状态变化） | 结果 | 原因 / 断言 |
|---|---|---|---|---|---|
| 30 | ▶ 60 秒看完今天 | 进 shadow 点真 `<button>` | 进入播放态 + 文案「▶」→「停下」 | **PASS** | 断言 `replayController.state.playing===true` + `textContent` 含「停下」 |
| 31 | 热力条 + 时钟 | 读 shadow | 热力条出栏（>0 根柱子）+ 时钟显示 `--:--:--` | **PASS** | 断言 `.bar` 数量 > 0 + 时钟文本 |
| 32 | 热力条游标 | `pointerdown`（带坐标，需 stub `getBoundingClientRect`） | 游标移动 + **时钟文本变化** | **PASS** | 断言 `state.cursorAt !== null` + 时钟文本不再是 `--:--:--` |

> jsdom 无排版（`getBoundingClientRect()` 全零），拖动换算会提前返回 —— 测试里补了确定宽度，浏览器里由真实布局给。**这是测试环境差异，不是产品缺陷。**

### 2.6 左下信息层级三档开关（task_096 / task_094）

| # | 元素 | 点击路径 | 预期（可见状态变化） | 结果 | 原因 / 断言 |
|---|---|---|---|---|---|
| 33 | L2 档 | `.click()` | `hud.layer.set` 进 core → core 写 `infoLayer` → 按钮点亮 + CSS 变量切换 | **PASS** | 断言命令 + `infoLayer==='L2'` + `aria-pressed='true'` + `data-srf-info-layer==='L2'` |
| 34 | L3 档 | `.click()` | L1 降到 18% 对比 + L2 收起（CSS 变量口径） | **PASS** | 断言 `--srf-layer-l1-opacity==='0.18'` + `--srf-layer-l2-visibility==='hidden'` |
| 35 | L3 激活时点 L1 元素 | 进 shadow 点 🎬 + 点 L1 档 | **L1 只降对比，不禁用** → L1 元素仍可点；档位按钮仍可点并写手动档 | **PASS** | 断言 🎬 仍能点亮（`directorEnabled===true`）+ L1 档仍发命令 + `layerBase==='L1'` |
| 35b | 演出占用优先 | 开导演 → 点 L1 → 关导演 | 占用期间有效档仍 L3（task_094「占用优先」规则，**不是 bug**）；占用释放后回手动档 L1 | **PASS** | 断言 `layerHolds` 含 `director` + 有效档 `L3`；关导演后有效档回 `L1` |

> 嫌疑 (a)（L2/L3 激活误伤 L1 可点性）**证伪**：
> L1 只用 `opacity` 降对比（**不阻断 pointer events**），L2 用 `visibility` 收起（会阻断）——
> 但 L2 只覆盖「事件轨 / toast」，这正是 L3 沉浸态「让位」的设计意图（task_094）。

### 2.7 覆盖层存活回归（**FAIL-01 修复的防线**）

| # | 场景 | 点击路径 | 预期（可见状态变化） | 结果 | 原因 / 断言 |
|---|---|---|---|---|---|
| 36 | ▶演示 触发主屏重渲 | 进 shadow 点真 `<button>` | **小地图 / 事件轨仍在宿主里，且节点身份不变** | **FAIL→PASS** | 修复前 `host.innerHTML` 重写 → 两个覆盖层当场消失。断言 `querySelector` 非 null **且 `toBe(同一节点)`** |
| 37 | 重渲后点小地图 | 演示开关 → `pointerdown` 画布 | `unit.select` + `camera.center` **照发** | **FAIL→PASS** | 修复前小地图已被抹掉 → 点击无任何反应 |
| 38 | 重渲后点事件轨条目 | 演示开关 → `.entry` `.click()` | `focus.unit` **照发** | **FAIL→PASS** | 修复前事件轨已被抹掉 → 点击无任何反应 |
| 39 | 切屏往返（main→settings→main） | `setCurrentScreen` 往返 | 覆盖层不被抹 + 回主屏后小地图仍点得动 | **FAIL→PASS** | 断言往返后 `MINIMAP_TAG`/`MARQUEE_TAG` 仍在 + 小地图点击仍发 `unit.select` |

---

## 三、FAIL 明细与修复

### FAIL-01 · 主屏重写宿主 → 组合根覆盖层被一次性抹掉且永不重挂

* **现象**：真机点一下顶栏 ▶演示（或任何一次屏位切换 / 重渲）之后，
  小地图、事件轨、聊天入口、toast、快捷键帮助**全部失灵**。
* **根因**：`src/hud/screens/main-screen.ts` 的 `renderMain()` / `renderSettings()` / `renderCharacter()`
  以及卸载闭包都写 `host.innerHTML = ...`。
  但 `host`（`#hud-root`）**不只是主屏的** —— 组合根 `app/main/main-entry.ts` 还把
  聊天抽屉 / toast / 事件轨 / 里程碑 / 小地图 / 快捷键帮助**挂在同一个 `#hud-root`** 下。
  宿主一旦被重写，这些覆盖层**当场从 DOM 里消失**，而组合根**不会重挂它们**（它们只在启动时装一次）。
* **修复**（`src/hud/screens/main-screen.ts`）：
  1. 主屏改为**只写自己的子树**：`styleEl`（样式表）+ `rootEl`（`.hud-root` 根节点）+ `subHostEl`（子屏宿主），
     三个节点由本屏创建、本屏移除，**永不重写 `host.innerHTML`**。
  2. 所有 `host.querySelector(...)`（17 处）改为 `rootEl.querySelector(...)` —— 本屏只查自己的子树。
  3. 子屏（settings / character）宿主仍挂在 `host` 下（absolute 定位上下文不变），
     但由 `subHostEl` 跟踪并在切屏 / 卸载时 `remove()`。
  4. 工程件过滤 `demoMode.filterEngineering(host)` → `demoMode.filterEngineering(rootEl)` ——
     不再扫宿主（宿主里有别人的节点）。
  5. 保留在 `host` 上的两处**有意为之**：顶栏事件委托 `host.addEventListener('strat-button-click', themeHandler)`
     （顶栏与子屏共用一个事件根）、`host.dispatchEvent('stratix:chat-open')`（组合根在 `#hud-root` 上监听）。
* **「点击→可见状态变化」断言**：测试 36/37/38/39（见 §2.7）——
  点击演示开关 / 切屏往返后，覆盖层**节点身份不变**、小地图画布点击**仍发** `unit.select` + `camera.center`、
  事件轨条目点击**仍发** `focus.unit`。
* **附带修复**：原 `app/main/main-entry.ts` 里「某些覆盖层改挂 `#hud-side` 以躲开宿主重写」的注释已过时，
  但**本次不改**（超出范围）。

---

## 四、三个重点嫌疑的裁决

| 嫌疑 | 裁决 | 依据 |
|---|---|---|
| (a) task_096 层级系统：L2/L3 激活时误伤 L1 按钮的可点性/可见性 | **证伪** | L1 只降 `opacity`（不阻断 pointer events）；L3 期间 L1 元素仍可点（测试 35）。L2 收起只覆盖事件轨 / toast，是 task_094 的「让位」设计。 |
| (b) task_089 顶栏重构：弹层（🔊 / ⋯）内按钮 handler 漏接 | **证伪** | 测试 4–15 全绿：两个弹层开合、点外面关、5 个菜单项 handler 全部接到位。 |
| (c) shadow DOM 事件冒泡被容器 `pointer-events:none` 吞掉 | **证伪** | 逐个审了 main-screen / minimap / marquee / layer-switch / day-replay：每个可点元素都显式 `pointer-events: auto`，容器才设 `none`；`strat-button` 的 `strat-button-click` 是 `bubbles:true, composed:true`，宿主事件委托接得到。 |

**真正的根因不在三个嫌疑里** —— 是主屏重写宿主把**别人挂的覆盖层**一起抹了（FAIL-01）。

---

## 五、未尽事项

1. `app/main/main-entry.ts` 中「某些覆盖层改挂 `#hud-side` 以躲开宿主重写」的历史注释已过时（本次不属范围，未改）。
2. `src/world/appearance/__tests__/brand-presets.test.ts` 在全量 jest 里失败 —— 缺 `dist/frontend/spritesheets/item-metadata.json`
   （构建产物、`.gitignore` 已忽略），**与本任务无关**，需先跑一次构建。
3. 顶栏 3 个纯展示元素（品牌 / 态势胶囊 / 通知徽标）按设计**无点击语义**；
   若产品希望徽标可点开通知列表，需另开需求（本次不擅自加语义）。
4. 层级开关在**演出占用期间**点 L1/L2 无可见变化（占用优先，task_094 设计）——
   手动档会记下，演出结束才回落。若产品希望「占用中也能看见手动档选择」，
   需要给档位按钮加一个「已占用」视觉态，属新增设计，不在本次范围。
