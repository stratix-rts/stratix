# task_148

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_148.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

派发最后一公里：死按钮治理+阅读面亮灯-模块

## requirements

1. **死按钮治理**：0 角色时「派发」不可用 → 禁用态 + 原因说明 + 行动引导（一键去新建角色，
   引导复用 136 的空态语言与既有建档向导）；并全应用扫一遍同类「静默死按钮」，
   逐个治理（禁用 + 原因 + 出口），清单进交付。
2. **阅读面亮灯**：a) 新建角色 → 派发 → 看到 markdown 结果的全链在 standalone 环境可用
   （派发依赖 gateway 真实 CLI 时评估降级路径：无网关时本地回放）；
   b) 内置 demo 样例输出 —— 会话面板提供「示例会话」入口，一键灌入 3-4 条带代码块 / 表格 /
   列表的演示消息，明确标注「演示数据」，让阅读面在任何环境先亮灯。
3. **任务单存在感恢复**：146 堆叠重构后任务确认单（mission-confirm）出现感近零 ——
   恢复其入场与视觉存在（走 138 动效 token + 146 堆叠秩序，不回退两者成果）。
4. **「L1 样例」脚手架标签清除**：三轮点名，找到源头清掉（若是调试/dev 模式标签，只在 dev 模式显示）。

## acceptance

- [x] 0 角色 → 死按钮全治理（截图：禁用态 + 引导出口，点击引导真通到新建角色）
- [x] standalone 一条龙：新建角色 → 派发 / 或示例会话 → 看到 markdown 真实渲染（截图，代码块可读）
- [x] 任务确认单入场有存在感（前后对照截图）
- [x] 「L1 样例」从生产界面消失
- [x] `npx tsc --noEmit` + 相关 jest 绿
- [x] 截图 `-r9` 前缀

## 交付物

### 1) 死按钮治理：0 角色时「派发」不再是死按钮

`src/hud/components/new-task-dialog/new-task-dialog.ts`

- 「派发」按钮在**没有可派发角色**时改为**禁用态**（`disabled` + `aria-disabled`），
  副标题写明原因：`当前没有可派发的角色 · 先建一个角色，建完就能派出去`。
  - why 不做成「可点但点了弹 toast」：那还是死按钮（用户以为能派，实际派不出去），
    只是把「没出口」藏进一个 toast。禁用态 + 原因 = 用户一眼知道「现在为什么派不了」。
- 新增**行动引导出口**「去新建角色」（紧贴死按钮，同一按钮组内）：
  `建一个角色 · 建完这条任务就能派出去`。
  - 点击 → 先关对话框（它是全屏模态，不关会把向导压在下面 —— 遮挡栈只认栈顶）→
    再走既有建档向导（`deps.onCreateCharacter`，组合根 `main-entry.ts` 注入，
    复用 136 的战场空态建档入口，**不新造一套流程**）。
- 有可派发角色时：按钮组恢复原样（单任务 / 流水线 / 派发 / 取消），不出现多余出口。

`src/app/main/main-entry.ts`：把「新建角色」的开口收敛成一处 `openCharacterWizard()`
（战场空态按钮与新任务对话框出口共用），避免两条路各走各的。

### 2) 阅读面亮灯：会话面板「示例会话」入口

`src/hud/panels/demo-session.ts`（新）+ `src/hud/panels/session-panel.ts`

- 会话面板头部新增「示例会话」chip，一键灌入 **4 条演示消息**（含代码块 / 表格 / 有序列表 /
  无序列表四种 markdown 结构），正文走 **145 已有的 markdown 管线**
  （`renderMarkdown` + `enhanceMarkdown`）—— 145 的渲染逻辑本体**一行未动**，
  这里只加接入点。
- 每条消息都挂「**演示数据**」徽标，面板头部也挂一枚，并写明
  「内置演示内容 —— 用来预览阅读面。真实会话请新建角色后派发。」
  - why 这不算 mock 业务数据：它不进 core、不落库、不发任何命令，只是**渲染到阅读面上**
    的一段**明确标注**的演示内容；真实链路（新建角色 → 派发 → 读到输出）照旧。
- 面板折叠时点入口会顺手展开（否则点了什么都看不见）。

### 3) 任务单存在感恢复（mission-confirm）

- **病灶定位**：任务确认单（`hud/panels/mission-confirm.ts`）此前**只在单测里存在**，
  生产 HUD 根本没挂它（`main-screen.ts` 的左栏只有 agent 面板）——
  所以「任务确认单出现感近零」不是 146 堆叠重构的副作用，而是**它压根没上线**。
- `src/hud/screens/main-screen.ts`：左栏改为两段（agent 面板 / 任务确认单槽位），
  任务单挂在 agent 面板**下方**（左栏原有约 415px 空位），不违反 146 的堆叠秩序
  （面板层仍走 `zVar('panel')`，未新增任何 z-index 裸数字）。
- `src/hud/panels/mission-confirm.ts`：新任务单进面板时给一次**入场落位**
  （`MOTION_CLASS.enter`，138 的动效 token；`data-arriving="true"` 标记）。
  - why 需要入场：任务单的存在感不能靠「它在那儿」，得靠「它刚来的时候被看见」；
    一次性（只在本轮渲染里生效），否则新任务单会一直抖。

### 4) 「L1 样例」脚手架标签清除

`src/hud/layers/layer-switch.ts`

- 「L1 样例 · 常驻 / L2 样例 · 事件」是**演示机制的脚手架**，不是产品内容。
- 口径：**只在演示模式（demoMode）下出现**，生产界面一律不见（安全缺省 = 不显示）；
  也可由 `showSamples` 显式注入（单测用）。
- 连带修一个真 bug：`.hud-layer-switch-samples { display:flex }` 会盖掉 UA 的
  `[hidden]{display:none}` —— 只加 `hidden` 属性**根本藏不住**（第一版就踩了这个坑，
  playwright 截图当场抓到）。补 `.hud-layer-switch-samples[hidden] { display:none; }`。

### 5) 死按钮治理清单

见下方「死按钮治理清单」一节。

## 验证证据（完成前必填）

- [x] **实现证明**: 见「交付物」1)-4)（每个改动都标注了 why 与复用的既有机制）
- [x] **测试验证**: `npx tsc --noEmit` 零错误；`npx jest` 全量 291 套 / 5311 通过 / 0 失败；
      playwright（Playwright 1.58.2，vite 7523）跑通「死按钮引导流 + 示例会话渲染 +
      任务单对照 + L1 标签消失」四条断言链
- [x] **影响范围**: 只碰 HUD 层与组合根接线；144 输入区结构 / 145 渲染逻辑本体 /
      146 堆叠秩序 / motion token 定义**均未动**；gateway 未动；零新依赖

### 测试步骤

1. `npx tsc --noEmit` → 无输出（零错误）
2. `npx jest --maxWorkers=2` → 291 suites / 5311 passed / 6 skipped / 0 failed
3. playwright（脚本跑在项目目录内，node 才能解析到仓库里的 playwright）：
   - 打开 http://localhost:7523/ → 断言全文档（穿透所有 shadow root，`innerText` 取可见文本）
     里**没有**「L1 样例」「L2 样例」
   - 命令面板输入标题 → 「新建任务」→ 断言「派发」`disabled=true`、
     `aria-disabled=true`、文案含「当前没有可派发的角色」、同级存在「去新建角色」
   - 点「去新建角色」→ 断言对话框已关闭、界面进入角色屏
   - 会话面板 → 点「示例会话」→ 断言 4 条消息、每条带「演示数据」徽标、
     正文里 `pre code` / `table` / `ol` / `ul` 都在（145 管线真的渲染了）
   - 断言主屏 `[data-role="mission-confirm"]` 槽位存在、面板已挂、可见（320×415）
4. 「前」对照用**上一个提交 b8c42e3** 起独立 worktree（vite 7526）实拍，
   不是复刻：同口径断言在 b8c42e3 上是「任务单槽位不存在」「L1 样例存在」
   「派发可点且文案自相矛盾」

### 验证结果

**playwright 断言输出（原样）**

```
ASSERT L1-样例 absent: true
ASSERT L2-样例 absent: true
DIALOG OPTIONS: [
  { "action": "single",    "text": "单任务 | 建一条战场任务 · 待指派（之后可在任务面板里指派）", "disabled": false },
  { "action": "pipeline",  "text": "流水线 | 多 agent 串行协作 · 预设「实现 + 审阅」",           "disabled": false },
  { "action": "dispatch",  "text": "派发 | 当前没有可派发的角色 · 先建一个角色，建完就能派出去",   "disabled": true  },
  { "action": "create-character", "text": "去新建角色 | 建一个角色 · 建完这条任务就能派出去",       "disabled": false },
  { "action": "cancel",    "text": "取消 | 什么都不做 · 关掉这个对话框",                          "disabled": false }
]
ASSERT dispatch disabled: true
ASSERT dispatch reason: true
ASSERT exit exists: true
ASSERT dialog closed: true
ASSERT demo chip exists: true
DEMO MARKDOWN: {"messages":4,"badges":["演示数据","演示数据","演示数据","演示数据","演示数据"],
                "hasPre":true,"hasTable":true,"hasOl":true,"hasUl":true,
                "codeText":"export function buildTaskCommand(prompt: string): TaskComman"}
ASSERT markdown rendered: true
ASSERT badges 演示数据: true
MISSION SLOT: {"slotExists":true,"panelExists":true,"visible":true,
                "rect":{"x":12,"y":201.390625,"w":320,"h":415.609375}}
ASSERT mission panel mounted+visible: true
DONE
```

**上一个提交 b8c42e3 的同口径实测（「前」）**

```
BEFORE STATE: {
  "missionSlotExists": false,      // 任务确认单在生产界面根本没挂
  "missionPanelExists": false,
  "railRect": { "x": 12, "y": 52, "w": 320, "h": 565 },
  "hasL1Sample": true              // 「L1 样例」在生产界面露着脸
}
BEFORE DIALOG OPTIONS: [
  { "action": "single",   "text": "单任务 | 建一条战场任务 · 待指派（之后可在任务面板里指派）", "disabled": false },
  { "action": "pipeline", "text": "流水线 | 多 agent 串行协作 · 预设「实现 + 审阅」",           "disabled": false },
  { "action": "dispatch", "text": "派发 | 交给一个角色执行 · 当前没有可派发的角色",             "disabled": false },
  { "action": "cancel",   "text": "取消 | 什么都不做 · 关掉这个对话框",                          "disabled": false }
]
```

**jest（相关 5 套）**

```
PASS src/hud/__tests__/new-task-dialog.test.ts   (24 passed)
PASS src/hud/__tests__/session-panel.test.ts     (42 passed)
PASS src/hud/__tests__/mission-confirm.test.ts   (19 passed)
PASS src/hud/__tests__/main-screen.test.ts       (40 passed)
PASS src/hud/layers/__tests__/layer-switch.test.ts (7 passed)
```

**全量 jest**

```
Test Suites: 291 passed, 291 total
Tests:       6 skipped, 5311 passed, 5317 total
Time:        27.059 s
```

**截图（reports/shots/，-r9 前缀）**

| 文件 | 内容 |
| --- | --- |
| `-r9-deadbutton-before.png` | 前：派发可点、文案自相矛盾（「交给一个角色执行 · 当前没有可派发的角色」） |
| `-r9-deadbutton-disabled.png` | 后：派发禁用 + 原因 + 「去新建角色」出口 |
| `-r9-deadbutton-guidance.png` | 后：点出口真通到角色屏 |
| `-r9-demo-session-markdown.png` | 后：示例会话灌入（表格 / 列表 / 徽标可见） |
| `-r9-demo-session-codeblock.png` | 后：代码块特写（ts 语言标签 + 可读代码） |
| `-r9-mission-confirm-before.png` | 前：左栏没有任务确认单 |
| `-r9-mission-confirm-after.png` | 后：任务确认单挂在左栏 agent 面板下方 |
| `-r9-l1-sample-before.png` | 前：「L1 样例 · 常驻 / L2 样例 · 事件」露脸 |
| `-r9-l1-sample-gone.png` | 后：只剩 L1/L2/L3 三枚档位按钮 |

## 死按钮治理清单

| # | 按钮 | 位置 | 病灶 | 治理 |
| --- | --- | --- | --- | --- |
| 1 | 派发 | `new-task-dialog` | 0 角色时可点，点了永远派不出去（r5 P1①） | ✅ 禁用态 + 原因 + 「去新建角色」出口 |
| 2 | L1 样例 / L2 样例 | `layer-switch` | 演示脚手架出现在生产界面（r5 三轮点名） | ✅ 只在演示模式出现（并修掉 `hidden` 被 `display:flex` 盖掉的真 bug） |
| 3 | 任务确认单（整个面板） | `main-screen` 左栏 | 组件早已写好且有测试，但生产界面**从没挂过** → 任务单存在感近零 | ✅ 挂进左栏（agent 面板下方）+ 新任务单入场动效一次 |
| 4 | 聊天输入区 / 发送 | `chat-drawer` | 禁用时无解释（r5 P2⑤） | ✅ 复查：已有 `data-role="send-hint"` 说明原因（「先选择一个角色」/「讨论已结束」/「发送中…」）—— 非死按钮，无需改 |
| 5 | 回放 ▶ 60 秒看完今天 | `components/replay/day-replay` | 无数据时禁用 | ✅ 复查：禁用即无数据可放，且有独立「重试」出口 —— 非死按钮 |
| 6 | 网关横幅「重试」 | `components/gateway-banner` | 断开时禁用 | ✅ 复查：重试中禁用是进行态语义，有 `aria`/hover 反馈 —— 非死按钮 |

（其余 HUD 按钮经全量扫描：要么有命令出口、要么有 toast、要么有导航，没有第二个
「能点但永远不产生结果」的按钮。扫描方法与结论见下。）

## 未尽事项

- **本机浏览器 dev 环境没有可检测的 agent CLI**（`detectedAgents` 为空），
  按 136 的口径，向导「可建档名单 = 已装 ∩ AGENT_KINDS」此时为空 ——
  所以点「去新建角色」在**本环境**落到角色屏（角色屏如实显示「尚无角色档案」），
  而在**装了 agent 的桌面环境**里同一入口会直接拉起建档向导。
  这是 136 既有判定（「探不到就别打扰用户」），不是本任务引入的；本任务只保证
  **出口真实可达、不再是点了没反应的死按钮**。
- 任务确认单目前挂在左栏**agent 面板下方**；若将来 agent 面板变高，两段需要重新分配
  高度（左栏现在是 `flex` 两段：agent 段 `flex: 0 0 auto`，任务单段 `flex: 1 1 auto`）。
- 「示例会话」的内容是**演示数据**（带徽标、不进业务通路）；真实链路的 markdown 渲染
  仍需一条真实派发来验证（网关/gateway 侧本任务未动）。
