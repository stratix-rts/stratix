# task_149

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_149.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

阅读列重构：消息分野/时间线/滚动记忆-模块

## requirements

1. **消息分野**：用户消息 vs agent 回复 vs 系统事件三种视觉身份（对齐侧 / 底色 / 头像位或标记，
   走皮肤 token）；同一 agent 连续消息轻分组（不每条重复头像/名字）。
2. **时间线**：消息时间戳默认轻呈现（hover 或边缘小字），跨分钟分组插入时间分隔条
   （「14:32」级别的轻分隔条）；新消息到达若用户在底部则自动跟随滚动，若用户上翻阅读则不打扰
   +「回到最新」浮标（走 146 堆叠秩序）。
3. **滚动记忆**：面板切换 / 抽屉开合后回到原滚动位置（记忆最近 5 个上下文）；刷新页面保持
   （可 localStorage，容量小心）。
4. **长会话**：200+ 消息构造测试 —— 滚动流畅（DOM 节点数上限策略：虚拟化或窗口化，零新依赖）；
   向上加载历史（若有历史源；无历史源则标注跳过）。
5. 内容字号沿用 145 的阅读级体系；空态沿用 136 语言。

## acceptance

- [x] 三种消息身份截图可辨（双皮肤）
- [x] 连续同 agent 消息分组 + 跨分钟时间分隔（截图）
- [x] 上翻时新消息不打扰 + 回到最新浮标可用（断言 + 截图）
- [x] 切换往返滚动位置恢复（断言）
- [x] 200+ 消息滚动无卡顿（证据：滚动性能数据或渲染节点数）
- [x] `npx tsc --noEmit` + 相关 jest 绿
- [x] 截图 `-r9` 前缀加 `-read` 后缀

## 交付物

### 新增模块（`src/hud/components/reading-column/`）

| 文件 | 职责 |
|------|------|
| `reading-logic.ts` | **纯逻辑层**：消息身份（user/agent/system）、连续分组、跨分钟时间分隔条、窗口化切片（`computeReadingWindow` / `buildPrefix`）、滚动记忆（LRU 5 条 + localStorage 持久化）。零 DOM、零副作用、可单测。 |
| `reading-column.ts` | **组件层**：`ReadingColumn` 类 —— 渲染进任意容器（能嵌进别的 Shadow DOM）。消息分野视觉、同 agent 连续分组、时间分隔条、hover 轻时间戳、跟随滚动 / 「回到最新」浮标、窗口化（只渲染可视区 + 缓冲）、滚动记忆（组件重建后按比例恢复）。样式走 `--srf-*` token（双皮肤同源），z-index 走 146 刻度表。 |
| `__tests__/reading-column.test.ts` | 15 条单测（纯逻辑 8 + 组件行为 7）。 |

### 改动文件

| 文件 | 改动 |
|------|------|
| `src/hud/panels/session-panel.ts` | 会话面板的**阅读面重做**（破坏式重构，授权范围内）：body 拆成 `demo-slot` + `body-main`（示例会话块变**持久件**，重画不再冲掉滚动位置与「不打扰」状态）；示例会话改由阅读列承载；折叠再展开按记忆恢复位置；卸载时释放阅读列。 |
| `src/hud/panels/demo-session.ts` | 演示数据升级为 **7 条带身份与时刻**的消息：用户 / agent / 系统事件三种身份各在场、同一 agent 连着两句（合组）、时刻**跨分钟**（分隔条当场可见）；新增 `buildDemoReadingMessages()` 出口。 |
| `src/hud/__tests__/session-panel.test.ts` | 新增 3 条断言（三种身份 / 连续合组 / 跨分钟分隔条）+ 演示消息数改为对齐 `DEMO_SESSION_MESSAGES.length`。 |
| `src/hud/theme/layer-tokens.ts` | 「回到最新」浮标登记进 146 的**浮层家族登记表**（`reading-column-jump` / localTop 档 / right-column 象限）。 |
| `tests/e2e/reading-column.spec.ts` + `tests/e2e/playwright.reading-column.config.ts` | 5 条 e2e（分野双皮肤 / 分组+时间线 / 上翻不打扰+浮标 / 滚动记忆往返 / 200+ 消息性能）。 |

## 验证证据（完成前必填）

- [x] **实现证明**
  - 消息分野：`data-rc-role` 三值（user / agent / system）+ 视觉三件套 ——
    用户**右对齐 + accent 描边底色**、agent**左对齐 + 头像位 + accent 左竖条**、系统事件**虚线居中细条**。
  - 连续分组：`buildReadingTimeline` 判定 `opensGroup`（同身份同署名则不开组 → 不重复头像/名字；系统事件永不合并）。
  - 时间线：跨分钟插「14:32」分隔条；时间戳默认 `opacity: 0`，hover 显形。
  - 滚动：贴底时新消息自动跟随；上翻时不改 scrollTop，浮标出现并计数；点浮标回到底。
  - 滚动记忆：比例（ratio）记位置，作用域分桶，最多 5 个上下文（LRU），写进 localStorage（刷新仍在）。
  - 长会话：手写轻量窗口化 —— 只渲染可视区 + 6 行缓冲，其余用占位高度顶掉（零新依赖）。

- [x] **测试验证**
  - `npx tsc --noEmit` → 0 错
  - `npx jest src/hud --maxWorkers=2` → **1375 passed / 1377**（唯一失败 = `agent-panel-pipeline` 2 条，
    **与本次改动无关**：该文件在本次开工前就已是工作区未提交改动，见「影响范围」）
  - `npx playwright test --config=tests/e2e/playwright.reading-column.config.ts` → **5 passed**
  - `npx eslint --cache <改动文件>` → 0 error

- [x] **影响范围**
  - 只碰 `src/hud/**`（阅读列 / 会话面板 / 演示数据 / 浮层登记表）+ `tests/e2e/**`。
  - **未动** gateway（7524）、渲染管线（145）、堆叠制度（146）、动效 token（147）、死按钮治理（148）。
  - 工作区里另有 `src/hud/panels/agent-panel.ts` 等**开工前就存在**的未提交改动（他人/前序任务）——本次未触碰、未提交。

### 测试步骤

1. `source ~/.nvm/nvm.sh && nvm use 22`
2. `npx tsc --noEmit`
3. `npx jest src/hud --maxWorkers=2`
4. `npx playwright test --config=tests/e2e/playwright.reading-column.config.ts`（需 7523 在跑）

### 验证结果

```
npx tsc --noEmit
TSC_EXIT=0

npx jest src/hud --silent --maxWorkers=2
Test Suites: 1 failed, 72 passed, 73 total
Tests:       2 failed, 1375 passed, 1377 total
（失败项：agent-panel-pipeline.test.ts —— 开工前既有改动导致，与本次无关）

npx playwright test --config=tests/e2e/playwright.reading-column.config.ts
  ✓ 1 ① 三种消息身份可辨（默认皮 + 像素皮截图）
  ✓ 2 ② 连续同 agent 合组 + 跨分钟时间分隔条
  ✓ 3 ③ 上翻时新消息不打扰 + 「回到最新」浮标可用
  ✓ 4 ④ 切换往返 / 刷新页面后滚动位置恢复
  ✓ 5 ⑤ 200+ 消息：滚动无卡顿（帧时间 + DOM 节点数上限）
  5 passed (7.9s)

[reading-column perf] {"total":260,"firstPaint":12.5,"maxNodes":20,"avgFrame":16.24833333492279,"maxFrame":19.5,"longFrames":0}
```

**长会话性能证据**：260 条消息 → DOM 里最多 **20 个**消息节点（窗口化生效）；连续 60 帧滚动，
平均帧间隔 **16.2ms**、最大 **19.5ms**、**超过 50ms 的长帧 0 个**。

### 截图

| 文件 | 内容 |
|------|------|
| `reports/shots/reading-r9-identity-default-read.png` | 三种消息身份（默认皮）—— 用户右对齐 / agent 左对齐带头像 / 系统事件虚线居中 |
| `reports/shots/reading-r9-identity-pixel-read.png` | 同上（像素皮）—— 双皮肤都可辨 |
| `reports/shots/reading-r9-group-timeline-read.png` | 连续同 agent 合组（第二条不重复头像/名字）+ 跨分钟「16:15 / 16:16 / 16:18」分隔条 |
| `reports/shots/reading-r9-jump-latest-read.png` | 用户上翻时的「回到最新」浮标 |
| `reports/shots/reading-r9-long-session-read.png` | 200+ 消息长会话（窗口化） |
| `reports/shots/reading-r9-panel-integration-read.png` | 阅读列在会话面板里的集成态 |

## 未尽事项

1. **真实会话的历史抽屉还没接阅读列**（本轮只把「示例会话」这条读面重做）。
   抽屉的条目仍是平铺的 `entry` 列表；接阅读列需要先给 `SessionHistoryEntry` 补**身份字段**
   （现在只有 author，靠启发式猜身份不可靠），并处理「加载更早」与窗口化的锚点保持。
   → 下一单可做：`SessionHistoryEntry.role` + 抽屉换阅读列 + 「加载更早」接 `onReachTop`。
2. **向上加载历史**：示例会话**无历史源**（标注跳过）；真实抽屉那一路本来就有分页，
   接阅读列时一并迁移（见上条）。
3. 阅读列的**系统事件身份**目前靠演示数据与未来的 `role` 字段供给；
   会话事件流那路的 `author`（建立/轮次/中断/开工…）到身份的映射口径待定。
