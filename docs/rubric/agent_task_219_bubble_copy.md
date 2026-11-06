# agent_task_219 · IX-06「气泡话术层」（事件随机池 + 状态气泡 + 闲置彩蛋）

> 任务：task_219（IX-06 气泡话术层） · 分支 `demo/v3.3` · 落地于 2026-11-07
> 权威定义：`.long-run-agent/tasks/task_219.md`（用户 23:43 定案）+ `docs/DESIGN-canvas-interactions.md` §4 IX-06

## 一、落地前的盘点（事实 → 结论）

| 事实 | 位置 | 结论 |
|---|---|---|
| 右击移动时单位统一冒一句固定文案「收到」 | `src/world/objects/task-fx.ts:359-364` 的 `INTERACTION_BUBBLE_TEXT.command` | **这就是要替换的常量**（requirement ① 点名的那一行） |
| 集火支援时冒「来了来了」 | 同上 `.focus` | 同批退役 |
| 气泡系统（task_076）已合入：板子（频率）+ 渲染层（画面） | `world/objects/speech-bubble.ts` / `speech-bubble-layer.ts` | 画面与频率**不动**，本单只换「说什么」与「什么时候说」 |
| 离线句库在 **world 层**（`world/speech-templates.ts`） | task_076 遗留 | requirement ④ 要求集中到 **core/theme** ⇒ 迁移 + 删除旧文件（不留第二份） |
| 会话状态信号在 world 侧**已经齐了** | `unit.speaking`（LLM 流式）/ `task.queued`·`started`·`completed`·`failed`（任务生命周期） | requirement ② 的三个状态有真实来源，**不需要新通道** |
| 交互矩阵 §2 **没有**规定气泡触发节奏 | `docs/DESIGN-canvas-interactions.md` §2 | requirement ③ ⇒ 标 **OPEN** + 给默认值（见下） |

## 二、口径裁决：四族话术（为什么这样分池）

| 族 | 键 | 口吻 | 为什么这样分 |
|---|---|---|---|
| **事件池** | `move` / `select` / `support` / `complete` / `error` | 指挥台**播报**（「移动指令已下达」） | 这些时刻**没有 agent 在回话** —— 写成 agent 口吻就是设计文档 §4 IX-06 说的「假回执」（病灶 D2）。本单走推荐 A：去掉 agent 口吻。 |
| **状态池** | `thinking` / `working` / `streaming` | agent**自述**（「这个我来！」） | 这三个时刻**确实有 agent 在干活 / 在说话** ⇒ 自称「我」不假。 |
| **闲置池** | — | 命令技巧 + 世界观小知识 | 静下来时冒一条技巧，恰好是「这时候才想得起来看」的时机。 |
| **性格彩蛋池** | — | agent 自述时的闲话 | 彩蛋是「性格」不是「事件 / 状态」，混进业务池会让「这句话对应哪件事」说不清。**只替换状态池**（播报里插「咖啡呢？」会变成噪音）。 |

> 事件池与状态池**口吻不同 ⇒ 必须分池**：混在一池里会读成半句话（「收到新任务」接「任务完成」）。
> 单测断言两池**不撞句**。

## 三、关键设计决定

### ① 为什么文案池落 `core/theme/bubble-copy.ts`（requirement ④）

话术池的消费者**不止战场**：战场侧（world）与未来的 HUD 侧（复盘 / 日志回看）要读同一份文案。
按铁律「hud ↔ world 不能互相 import」而「world 只允许认识 core」⇒ 唯一事实源必须落在两侧共用的
`core/theme` —— 与调色板（`core/theme/visual-spec.ts`）、动效（`motion-spec.ts`）、皮肤（`skin-registry.ts`）**同一模式**。
旧文件 `world/speech-templates.ts` **已删除**（不留第二份文案池）。

### ② 「同一事件连续两次文案不同」怎么保证（acceptance ①）

不是 `Math.random()` 抽（那样**连续两次可能抽到同一句**），而是**洗牌牌堆**（shuffle-deck）：
抽过的句子本轮不再出现，牌堆抽空才重新洗 ⇒ 同池内**连续两次必不同**，且一轮之内不重样。
与 `core/theme/skin-registry.ts` 的 `createSkinRandomizer()` 同一套路（同一模式，可复现）。

### ③ 状态气泡的**沉降期**（1.2s）：为什么不能「状态一变就说话」

「接了活」（thinking）常常**几百毫秒后**就变成「开工了」（working）。若立刻说一句
「收到新任务，正在拆解」、下一秒又说「这个我来！」，**两句互相打脸**；而气泡板又有
「同单位 5s 冷却」，第二句还会被直接吞掉 ⇒ 看起来像什么都没说。

⇒ 触发链（`world/objects/speech-trigger.ts`）里每个单位带一个**待说窗口**：
状态稳住 `stateSettleMs`（1.2s）才开口；**沉降期内状态变了 ⇒ 前一句作废**（只说后一句）。

### ④ 同状态节流为什么**按状态键分别记**（不是只记「上一句是什么」）

`思考 → 工作 → 思考` 时，第二句「思考中」距第一句只有几秒 ⇒ 该压掉。
若只记「上一句是什么状态」，中间那句「工作」会把「思考」的计时冲掉 ⇒ 压不住（同一状态连着刷屏）。
⇒ 每个单位存一张 `状态键 → 上次开口时刻` 的小表。

### ⑤ 触发链为什么在 world 而不是 core

「什么时候冒泡」是**表现层的时机**（同屏 ≤3 / 同单位 5s 冷却都在气泡板上裁决），
「说什么」是**文案事实**（在 core/theme）。分开放：core 不知道屏幕上已经有几枚气泡，
world 不该知道文案池长什么样。⇒ 触发链是**纯逻辑、零 Phaser**（node 单测直接跑）。

### ⑥ ★ OPEN：气泡触发节奏（requirement ③）

交互矩阵 **§2 没有定义**气泡的触发节奏 ⇒ 本单**标 OPEN** 并给默认值（克制优先，不刷屏），
集中在 `SPEECH_COPY_METRICS`（core/theme/bubble-copy.ts）：

| 数字 | 默认值 | why |
|---|---|---|
| `stateSettleMs` | 1 200ms | 沉降期：状态稳住才说话（见上）。 |
| `stateMinIntervalMs` | 15 000ms | 同一状态不连着刷屏。 |
| `idleGraceMs` | 15 000ms | 静默门槛：刚派完活就冒「小技巧」，像是在说「你刚才那单不算数」。 |
| `idleMinIntervalMs` / `idleMaxIntervalMs` | 30 000 / 60 000ms | 彩蛋间隔随机（固定节奏像闹钟）。 |
| `personalityChance` | 0.2 | 性格彩蛋命中概率。 |

写明 OPEN 是为了不让人以为这几个数字有规格背书；等矩阵补齐后再对齐。

## 四、改动清单

| 文件 | 改动 |
|---|---|
| `src/core/theme/bubble-copy.ts` | **新增** —— 文案唯一事实源：事件池 / 状态池 / 闲置池 / 性格池 + 节奏度量 + 洗牌牌堆抽取器（零 IO / 零 Phaser / 零 LLM）。 |
| `src/world/objects/speech-trigger.ts` | **新增** —— 触发链（纯逻辑）：状态迁移 → 沉降期 → 开口；同状态节流；闲置彩蛋裁决。 |
| `src/world/objects/speech-bubble.ts` | `SpeechBubble.kind` 改 `SpeechKey \| null`；板子支持注入 `picker`；抽句走 core/theme 抽取器。 |
| `src/world/objects/speech-bubble-layer.ts` | `speak(unitId, kind: SpeechKey)`。 |
| `src/world/bridge/bus-adapter.ts` | 任务 → 话语键改口径：`task.queued → 'thinking'`、`task.started → 'working'`、`completed → 'complete'`、`failed → 'error'`。 |
| `src/world/scenes/BattlefieldScene.ts` | 建共用抽取器 + 触发链；`syncUnits → trigger.syncUnits`；`syncUnitSpeaking → setSpeaking`；`syncTaskSpeech` 分两路（状态键喂触发链 / 事件键直接冒）；`update()` 每帧推进触发链；右击气泡改抽句；左键选中冒「选中池」一句。 |
| `src/world/objects/task-fx.ts` | **删除** `INTERACTION_BUBBLE_TEXT`（常量「收到」/「来了来了」退役）。 |
| `src/world/speech-templates.ts` | **删除**（文案池迁 core/theme，不留第二份）。 |
| `src/world/dev/speech-dev-scene.ts` / `speech-dev.html` | dev 验收页按钮按新词表（working / thinking / streaming / move / select / …）。 |
| `src/core/types.ts`、`src/world/objects/task-fx-layer.ts` | 只改注释里的旧路径引用（无逻辑变更）。 |
| `src/core/theme/__tests__/bubble-copy.test.ts` | **新增** 24 例：池规模 / 冻结 / 不撞句 / 连续两次不同 / 一轮不重样 / 可复现 / 彩蛋只替换状态池 / 节奏度量。 |
| `src/world/__tests__/speech-trigger.test.ts` | **新增** 12 例：thinking / working / streaming 三状态 + 优先级 + 沉降期作废 + 状态不重复 + 同状态节流 + 离场 + 闲置三闸门。 |
| `src/world/__tests__/speech-bubble.test.ts` / `speech-wiring.test.ts` / `interaction-fx.test.ts` / `v34-feature-matrix.test.ts` | 跟随新词表 / 新常量位置更新断言；`speech-templates.test.ts` 随旧文件删除。 |
| `docs/DESIGN-canvas-interactions.md` | D2 / §1.2 / §1.2.4 / §2 P4 行 / 附录 R05 对齐实际落地；**§4 IX-06 补「实施口径」小节**（四族话术表 + OPEN 节奏标注）。 |
| `docs/DEMO-PLAN.md` | §3 内容源指向 `core/theme/bubble-copy.ts`（旧路径退役）。 |

## 五、验收对照

| 验收项 | 落点 | 结果 |
|---|---|---|
| ① 同一事件连续触发两次文案不同 | `core/theme/__tests__/bubble-copy.test.ts`「每个事件池连续抽两次都不重样」 | ✅ |
| ② 思考中 / 工作中 / 闲置三状态触发链 | `world/__tests__/speech-trigger.test.ts`（thinking / working / streaming + idle 三闸门） | ✅ |
| ③ 文案池集中配置 | 唯一事实源 `src/core/theme/bubble-copy.ts`；旧 `world/speech-templates.ts` 已删 | ✅ |
| ④ `tsc` + 全仓 jest 绿 | `npx tsc --noEmit` 零错误；`npx jest` 359 套 / 6087 通过 / 6 跳过 | ✅ |
| ⑤ 不接 LLM / 零 token | 全链路纯本地常量 + 纯函数（无网络 / 无模型调用） | ✅ |
| ⑥ 每池 ≥4 条 · 中文 · 像素指挥台风格 | 单测「每个事件池 ≥4 条」「每个状态池 ≥4 条」 | ✅ |

## 六、遗留与边界

- **★ OPEN**：气泡触发节奏待交互矩阵 §2 补齐（默认值见 §三⑥）。
- **IX-06 的 B 路线**（右击真下达给 agent / agent 自己走位）**不在本单**：涉及 `chat.send` / `unit.dispatch`
  新命令 + agent-link 通道 + 失败回执 UI，是独立大单。
- **「选中」气泡**取自事件池（播报口吻）；频率由气泡板兜底（同屏 ≤3 / 同单位 5s 冷却），场景不自己判。
- **状态信号单一来源**：思考中 / 工作中只由**任务生命周期事件**驱动（queued / started），
  不再用任务快照反推 —— 两处来源会互相打架（状态抖动 ⇒ 气泡乱冒）。
