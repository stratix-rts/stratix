# Stratix 游戏化重构迁移方案（V3.1 · 已冻结）

> 状态：**已冻结** —— 六项开放问题已于 2026-10-21 全部决策关闭。
> 冻结即开工：Phase 1→4 在 `refactor/game-v3` 分支持续执行，中途不改方案，只报进度；新需求一律 backlog。
> 技术基线：Phaser 3.90（MIT，锁定版本）作为世界层；HUD 采用 Web Components + 主题 token 体系；
> 录屏用系统录屏软件解决，不强求 UI 画面内一体感。
> 历史版本：V2 见 `REFACTOR_PLAN_V2.md`（本方案与其不兼容，独立生效）。

---

## 0. 设计原则（所有后续决策的裁判标准）

| # | 原则 | 落地含义 |
|---|------|---------|
| P1 | 简单优先 | 每个模块删掉后系统仍可描述；引入任何依赖前先问"能不能 50 行内自建" |
| P2 | 模块清晰 | 一个目录 = 一个职责；目录名即架构图 |
| P3 | 结构解耦 | 世界层与 HUD 层互不知道对方存在，只认识 `core/types.ts` |
| P4 | 注释有效 | 每个文件头一段契约注释（职责 / 输入输出 / 禁止事项）；关键算法只注 why，禁止复述代码的废话注释 |
| P5 | 迁移平滑 | 旧界面保持可运行直到 Phase 3 切换完成；任何时刻 trunk 可发布 |
| P6 | 功能取舍 | 已冻结（见第 4 节决策记录）；冻结后新增需求不进本次 |
| P7 | 一次完成 | Phase 1→4 连续执行，中途不改方案 |

---

## 1. 目标架构：两种像素 + 一条总线

```
┌─ Electron 壳（app/，保持不动）
│
├─ 🌍 world/   世界层（Phaser 3.90，锁定版本）
│    战场、Agent 单位、编组/多选、框选、镜头
│    职责边界：只读 WorldState 渲染 + 上报交互事件
│    禁止事项：不含业务决策、不画任何 HUD 面板
│
├─ 🖥️ hud/     HUD 层（DOM / Web Components，零框架依赖）
│    屏、面板、聊天、日志、设置、角色养成
│    职责边界：读状态展示 + 发命令
│    禁止事项：不做世界坐标计算、不直接碰 Phaser
│
├─ 🔌 core/    引擎无关核心（纯 TS，可独立单测）
│    ├─ Agent 单位 / 任务（指派/回报）状态机
│    ├─ character/（角色提示词 + 成长数值）
│    └─ types.ts —— 总线契约，唯一事实源
│
└─ 🚪 gateway/ 业务网关与外部 agent 连接（连接功能重做，见 D4）
```

**通信规则（铁律）**：

1. `hud → core`：只允许 `HudCommand`（命令）
2. `world → core`：只允许 `WorldEvent`（交互事件）
3. `core → 两层`：只广播 `WorldState`（快照 / 增量）
4. 任何 `hud ↔ world` 直接调用 = 架构违规，code review 直接打回

**组织模型（D5 决策的自然结果）**：不存在 Zone 概念。战场上的组织单位是
**Agent 单位**，**编组 = 当前多选集合**（无持久化编队，v3 不做）。
任务指派对象是 `unitIds: string[]`。

---

## 2. 新目录结构

```
src/
├── app/                      # Electron 主进程 + 两个渲染入口（new / legacy）
├── core/                     # 纯逻辑，零渲染依赖，jest 可测
│   ├── types.ts              # ★ 总线契约：WorldState / HudCommand / WorldEvent
│   ├── store.ts              # 极简响应式 store（自建 <100 行，不引状态库）
│   ├── bus.ts                # mitt 封装（项目已有 mitt 依赖）
│   ├── unit/                 # Agent 单位：业务态、编组、选择语义（自 stratix-rts 抽取）
│   ├── mission/              # 任务分解 / 指派 / 回报状态机
│   ├── character/            # 角色域（D3）：
│   │   ├── persona.ts        #   角色提示词（SoulTemplate 思路保留）
│   │   └── growth.ts         #   成长数值：level/experience 模型
│   │                         #   参考现 SharedSkillStore，改为角色级；技能树不迁移
│   │                         #   TODO(v3.x): 养成感设计——成长触发点/奖励曲线/展示位
│   └── agent-link/           # 外部 agent 连接（重做，见 D4）：会话管理、事件回传
├── world/                    # Phaser 3.90
│   ├── scenes/               # BattlefieldScene（唯一主场景起步）
│   ├── objects/              # Unit / SelectionBox / Minimap / FormationHint
│   ├── camera/               # 镜头控制（平移/缩放/边界）
│   └── bridge/bus-adapter.ts # 订阅 state → 驱动场景；场景事件 → WorldEvent
├── hud/                      # DOM 层，Web Components
│   ├── screens/              # main-screen / settings-screen / character-screen
│   ├── panels/               # command-panel / agent-panel / log-drawer /
│   │                         # chat-drawer / mission-confirm / status-bar
│   ├── widgets/              # strat-button / strat-list / strat-badge / strat-bar（数值条）
│   ├── theme/                # ★ 主题 token 体系（见第 3 节）
│   └── bridge/bus-adapter.ts # state → DOM 渲染；用户操作 → HudCommand
├── gateway/                  # 网关（连接 agent 的协议部分重做，D4）
└── legacy/                   # ⚠️ 迁移期旧代码（Vue 组件、vxe、zone 模块等），冻结只读
                              # Phase 3 结束后整体删除
```

---

## 3. HUD 主题与像素风（D4 决策落点）

**要求**：皮肤选择保留；后续可整体切换像素风且全屏一致。

**方案**：主题 token 体系 —— 所有视觉属性只允许引用 CSS 变量，组件禁止写死任何颜色/字体/边框：

```css
/* hud/theme/tokens-default.css —— 现代皮肤 */
:root {
  --srf-bg, --srf-panel, --srf-border, --srf-text, --srf-accent,
  --srf-font-ui, --srf-radius, --srf-scanline-opacity, ...
}
/* hud/theme/tokens-pixel.css —— 像素皮肤（后续追加） */
:root {
  --srf-font-ui: "…像素字体";
  --srf-radius: 0;            /* 像素风直角 */
  --srf-border: 2px solid …;  /* 硬边框 */
  --srf-image-rendering: pixelated;
}
```

切换皮肤 = 换一套 token 文件，组件零改动。战场层（Phaser）皮肤由 world 侧
读取同名 token 常量（`world/theme.ts` 与 CSS 变量一一对应），保证 HUD 与战场同步换肤。

**备选记录**：Phaser 社区 UI 组件库 = RexUI（rexrainbow 生态，rex-notes ⭐1.3k，
维护活跃、已开始覆盖 Phaser 4）。若未来需要"UI 在画面内"（纯 canvas 录屏/回放），
可将 hud/ 整层替换为 RexUI 实现，总线契约不变。本次不引入。

---

## 4. 功能取舍决策记录（2026-10-21 冻结）

| 编号 | 决策 | 处置 | 落点 |
|------|------|------|------|
| D1 | 3D 视图不需要（本产品是 2D 应用） | ❌ 砍 | Map3DView 删除 |
| D2 | 工作流交给外部 agent | ❌ 砍 | WorkflowEditorModal、sequential-workflow-designer 依赖移除；后续有场景重新设计 |
| D3 | 皮肤保留；连接 agent 重做；角色提示词保留；技能树砍；数值系统保留 | ✅/♻️ | 皮肤→hud/theme（token 化）；persona→core/character/persona；growth→core/character/growth（参考现 SharedSkillStore 的 level/experience 模型，角色级重做，技能树结构不迁移）；养成感 TODO 入档（见 §2 注释） |
| D4 | HUD 用 Web Components，须支持像素风整体切换 | ✅ | hud/ 全部 Web Components + §3 token 体系；RexUI 作为未来全 canvas 备选记录 |
| D5 | 旧数据不要；**Zone 整体砍掉** | ❌ 砍 | stratix-zone、stratix-systemzone、Zone 相关组件/面板/面板逻辑/数据表/ZoneCoordinator 全部不迁移；无迁移脚本；组织模型改为 Agent 单位 + 多选编组（§1） |
| D6 | stratix-project 不要 | ❌ 砍 | 整模块不迁移（GameZone 等随 Zone 一并消失） |

**随决策的既有功能映射**（承接 V3.0 讨论稿）：

| 现有功能 | 处置 | 新归属 |
|----------|------|--------|
| RTS 战场视图 | ✅ 重写渲染，选择/编组语义抽入 core | world/ + core/unit |
| CommandPanel + CommandPalette | ♻️ 合并 | hud/panels/command-panel |
| 任务确认流（原 ZoneTaskConfirmPanel） | ✅ 改造 | hud/panels/mission-confirm（确认对象：编组 ← 单位多选） |
| AgentPanel + AgentPowerPanel | ♻️ 合并 | hud/panels/agent-panel |
| AgentDashboard + StatusPanelModal | ♻️ 合并 | 状态屏 |
| ChatPanel + AgentChatModal | ♻️ 合并 | hud/panels/chat-drawer |
| LogPanelModal + TaskLogViewer | ♻️ 合并 | hud/panels/log-drawer |
| RTSSettings + ProviderSettingsModal | ♻️ 合并精简 | hud/screens/settings |
| 主题机制 | ✅ token 化 | hud/theme（§3） |
| 角色提示词（SoulTemplate）+ 数值成长 | ✅ | core/character + hud/screens/character-screen |
| 连接 agent（openclaw-adapter / ai-service 连接层） | ♻️ 重做 | core/agent-link + gateway |
| vxe-table / vxe-pc-ui | ❌ | 依赖删除，HUD 用 strat-list |
| stratix-nocodb / stratix-tailscale / stratix-mcp 等非 UI 模块 | ✅ 原样 | 不在本次范围 |

---

## 5. 总线契约草案（core/types.ts）

```ts
// ============ 契约注释示例（P4 标准）============
// 文件职责：世界与 HUD 之间全部通信类型，唯一事实源。
// 输入：无（纯类型 + 常量）。
// 禁止：引入任何运行时依赖；出现 any 即违规。

export interface WorldState {
  units: UnitView[];          // Agent 单位（位置由世界层自治，此处仅业务态）
  missions: MissionView[];    // 任务及状态机相位
  selection: SelectionState;  // 当前选择集（编组 = 多选集合）
  characters: CharacterView[];// 角色档案 + 成长数值（level/exp）
  notices: Notice[];          // 待 HUD 提示的事件（自动过期）
}

export type HudCommand =
  | { type: 'unit.select'; unitIds: string[]; mode: 'set' | 'toggle' }
  | { type: 'mission.assign'; missionId: string; unitIds: string[] }
  | { type: 'mission.confirm'; missionId: string; decision: ConfirmDecision }
  | { type: 'character.persona.update'; characterId: string; prompt: string }
  | { type: 'chat.send'; text: string }
  | { type: 'ui.navigate'; screen: ScreenId }
  | { type: 'theme.set'; themeId: 'default' | 'pixel' };

export type WorldEvent =
  | { type: 'unit.click'; unitId: string; mods: ClickMods }
  | { type: 'selection.box'; bounds: Bounds }
  | { type: 'camera.moved'; center: Point; zoom: number };
```

> 契约已冻结；后续新增字段走版本注释（`@since v3.x`），保持两层并行开发不互相踩。

---

## 6. 迁移阶段（冻结后连续执行，不停摆）

### Phase 1 — 骨架并行（约 2~3 天 agent 工时）

- [ ] `core/` 建立：types + store + bus + unit 选择语义（带单测，覆盖选择/编组状态机路径）
- [ ] `world/` 骨架：BattlefieldScene + 空战场 + 相机控制 + bus-adapter
- [ ] `hud/` 骨架：main-screen 壳 + 一个 strat-button + bus-adapter + tokens-default.css
- [ ] 联调验收：HUD 按钮 → command → core → state 变化 → world 场景响应（hello loop）
- [ ] 验证命令：`typecheck && build && test core`

### Phase 2 — 屏幕与交互（主体工作量）

- [ ] 顺序：命令面板 → Agent 侧栏 → 任务确认（编组指派）→ 日志 → 聊天 → 设置 → 状态屏 → 角色屏（persona + 数值）
- [ ] character 屏先落 persona 编辑 + level/exp 展示位（数值系统沿用现有模型迁移）；养成曲线设计进 TODO，不阻塞
- [ ] 每屏完成即接总线联调，不留"最后一起调"

### Phase 3 — 切换与退役

- [ ] Electron 主入口切换到 new UI；legacy 挂隐藏入口保留一个版本周期
- [ ] 删除 `legacy/` 与退役依赖（vxe-table、vxe-pc-ui、sequential-workflow-designer）
- [ ] Zone 相关死代码全量清理（stratix-zone / stratix-systemzone / stratix-project 目录删除）
- [ ] 回归：全功能清单走查并录屏存档

### Phase 4 — 验收

- [ ] 全部验收标准（第 7 节）逐条核对
- [ ] 性能基线记录（含空闲 CPU）
- [ ] 合入 trunk，打 tag `v3.0`

---

## 7. 验收标准（不可妥协项）

1. `typecheck` / `build` / `core 单测` 全绿
2. 架构铁律扫描：`grep` 无 `hud.*phaser` 类违规引用；core/ 内零渲染依赖
3. 总线类型零 `any`；契约文件头注释完整（P4 标准）
4. 空闲（无输入、静止画面）CPU 占用显著低于旧版 —— Phaser 场景在无交互时降帧或暂停
5. 退役依赖从 package.json 消失：vxe-table、vxe-pc-ui、sequential-workflow-designer
6. 皮肤切换演示：default → pixel（token 文件级切换，组件零改动）
7. Zone 遗留扫描：源码中不再出现 zone 模块引用（历史文档除外）
8. 每个新目录有 README（≤20 行：职责 + 禁止事项）

---

## 8. 风险与对策

| 风险 | 概率 | 对策 |
|------|------|------|
| Zone 砍除后指派模型与旧链路差异大，core 以重写为主 | 确定 | 接受：core 按新契约全新实现，仅"选择语义/经验"参考旧代码；不追求逐行迁移 |
| stratix-rts 逻辑与 Phaser 耦合比预期深 | 中 | 允许 core 内保留少量形状类型（Point/Bounds）；渲染语义留在 world 的 adapter |
| 冻结后冒出新需求 | 高 | 一律 backlog，Phase 4 完成后另开迭代（P6/P7） |
| Web Components 路线团队/agent 不适应 | 中 | 兜底：hud/ 局部换 Vue 仅限 hud 目录内，总线契约不变；或未来整体切 RexUI（§3） |
| 养成感设计未定即上线角色屏 | 低 | persona + 数值展示先行；成长触发点/奖励曲线 TODO(v3.x) 单列迭代 |
| Phaser 3.90 与未来 v4 断代 | 低 | 本次锁 3.90；重构完成后再评估升级，不在本次范围 |

---

## 9. 已决策记录（原开放问题，全部关闭）

| # | 问题 | 决策（2026-10-21） |
|---|------|--------------------|
| 1 | Map3DView 去留 | 砍（产品定位 2D） |
| 2 | WorkflowEditor 去留 | 砍（工作流交外部 agent；后续有场景再设计） |
| 3 | 英雄/角色系统关系 | 皮肤保留；连接 agent 重做；角色提示词保留；技能树砍；数值系统保留（无则 TODO → 现有 level/exp 模型可参考迁移）。**养成感是产品核心**：即便用户连 Claude/OpenClaw 干活，养成感由本产品提供 |
| 4 | HUD 技术路线 | Web Components；必须支持像素风整体切换（token 体系落点）；RexUI 备选记录 |
| 5 | 旧数据兼容 | 不要旧数据；Zone 整体砍掉，无迁移脚本 |
| 6 | stratix-project 去留 | 砍 |

---

*V3.1 冻结版（2026-10-21）。冻结后修改需走版本注解：V3.1.x 仅允许澄清性批注，实质变更升 V3.2 并需重新评审。*
