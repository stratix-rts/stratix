# task_140 — 角色上场链路：形象合成 + 战场入场走位

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_140.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

LoopB-1: 角色上场链路——形象合成+入场走位-模块。

r4 双评估一致结论：下一步最值钱的是「新用户 60 秒内看见战场上第一个会动的单位」。
现状：角色（UI/MCP 建）永远不产生战场单位，战场恒空。**家底全在，缺的是接电**。

## requirements

- **上场管线**：角色注册表出现角色 → 按 archetype 取 brand-preset（缺则随机合成）→
  composer 合成精灵表 → BattlefieldScene 合理落位生成单位 + 入场走位（从边缘走到格位，800ms 级）。
- **下场对称**：删除角色 → 退场（淡出下沉）后移除节点，不留残影。
- **形象缓存**：复用既有 LruCache（上限 100）与 Phaser 纹理上限（24），**不重复造**。
- **合成失败降级**：素材缺失 → 兜底占位形象（战场不空着也不崩），且**不进入死循环重试**。
- **零 DOM 铁律**：composer 的 canvas / Image 由调用方（app 层）注入，world 层不碰 DOM。
- **动效降级**：`prefers-reduced-motion: reduce` → 入场直接落位，不播位移。
- 范围内只做 **app 进程内已知角色** 的上场：UI 建/删/改 + 启动时从持久化快照恢复的存量角色。

## acceptance

- [x] 刷新页面：存量角色（如 工头-133）≤3s 内以合成形象出现在战场并有入场走位（截图 + 时间戳证据）。
- [x] UI 新建角色 → ≤2s 上场；删除角色 → 下场（退场后从战场移除）。
- [x] 两个不同 archetype 的角色形象肉眼可辨不同（截图对照）。
- [x] 素材缺失场景兜底形象不崩（临时拦截素材请求验证；战场不空、无 pageerror、无重试死循环）。
- [x] world 零 DOM 违规（grep `document` / `new Image` / `createElement`；composer 调用走注入）。
- [x] `npx tsc --noEmit` + world/appearance 相关 jest 绿。
- [x] 截图 `-r6` 前缀。

## 交付物

| 文件 | 职责 |
|------|------|
| `src/world/appearance/character-look.ts`（新） | **角色的"长相裁决"**（纯逻辑）：自带外观 > 品牌预设（按 agent 种类）> 随机合成（按角色 id 播种，同角色同脸）。永不返回空 —— 空长相 = 战场上的占位圆。 |
| `src/world/objects/unit-entrance.ts`（新） | **上场 / 下场走位参数**（纯逻辑，零 Phaser）：入场起点（可视区外沿，左右交替）、入场时长 800ms、下场时长 260ms、朝向编码（0上1左2下3右）。 |
| `src/world/motion.ts`（新） | **reduced-motion 读口**（world 零 DOM）：只读 app 层塞进 Phaser registry 的布尔标志；`=== true` 才降级。 |
| `src/world/objects/unit-layer.ts` | 渲染侧上场 / 下场：`waiting → walking → done` 入场相位、形象就位后才走位（不走占位圆）、`lookFailed` 集合（素材缺失不重试）、退场淡出后真删节点。 |
| `src/world/objects/unit-sprite-sheet.ts` | 契约收窄：`resolveUnitSheetKey(characterId)` —— **只认角色 id**（长相由形象源裁决，world 不判断"有没有脸"）。 |
| `src/world/objects/unit-sprite-source.ts` | 端口放宽：`loadWalkBand(characterId, appearance | null)` —— 角色可无自带外观。 |
| `src/world/objects/unit-registry.ts` | 暴露只读 `bounds`（渲染层算入场起点的兜底矩形）。 |
| `src/app/services/unit-sprite-source.ts` | app 侧形象源：**兜底长相**（注入 `resolveAppearance` 回调）+ **全透明精灵带检测**（素材整体缺失 → 回落占位形象，不贴空图）。 |
| `src/app/main/main-entry.ts` | 接线：注入 `resolveAppearance`（查 worldStore 的角色名册 → `resolveCharacterLook`）、把 `prefersReducedMotion()` 塞进 Phaser registry。 |
| `src/app/main/dev-flags.ts` | `prefersReducedMotion()`（matchMedia 判在 app 层 —— world 零 DOM）。 |
| `src/world/appearance/__tests__/character-look.test.ts`（新） | 长相裁决单测（优先级 / 品牌预设 / 随机确定性 / 素材缺失降级）。 |
| `src/world/__tests__/unit-entrance.test.ts`（新） | 走位参数单测（起点 / 交替 / 朝向 / 时长边界）。 |
| `src/world/__tests__/motion.test.ts`（新） | reduced-motion 读口单测（严格 `=== true`）。 |

### 设计要点

- **断点在哪**：core 早就把角色投影成 UnitView —— 缺的不是"生成单位"，是**形象闸门**：
  老口径要求单位自带 `appearance` 才有精灵，而绝大多数角色档案的 appearance 是 null，
  于是每个角色都走了"占位圆"分支甚至根本没进战场。本任务把闸门从"有外观"改成"是角色单位"。
- **世界层不知道品牌预设**：裁决要查角色名册（app 层才知道），故注入 `resolveAppearance` 回调，
  world 只认"给我一张能看的脸"这个端口（分层不破）。
- **走位起点取可视区外沿，不取战场边界**：战场 3200×2400，默认镜头只看得到中间一块 ——
  从战场边界起步，单位在屏幕外走完全程，用户只看到"凭空出现"，走位白做。
- **等形象就位才走位**：走位是"角色上场"的高光时刻，用占位圆走进去等于把高光浪费在替身上。
- **失败不重试**：素材整体缺失时，每次对账都会再发一次合成请求 → 死循环（烧 CPU + 刷屏）。
  `lookFailed` 集合记住失败的角色，回落占位形象，战场不空着。
- **随机兜底要播种**：不播种则"刷新一次换一张脸"，用户认不出自己的角色（按角色 id 播种）。

## 验证证据（完成前必填）

- [x] **实现证明**: 见上表 + 设计要点（裁决 / 走位 / 降级 / 接线四处各一个纯逻辑模块 + 渲染层相位机）。
- [x] **测试验证**: `npx jest src/world`（34 套件 / 514 用例全绿）+ `npx tsc --noEmit`（exit 0）
  + eslint（改动文件零新增告警）+ playwright 四条真实链路（恢复 / 新建 / 双 archetype / 素材缺失）。
- [x] **影响范围**: 只动 world（appearance / objects）+ app（main / services）；未动 core / hud / gateway；
  world 零 DOM 铁律未破（grep 证据）。

### 测试步骤

1. 起 vite（7523），开 `http://127.0.0.1:7523/src/app/main/index.html`。
2. **刷新恢复**：注入 `window.electronAPI.gameSave`（生产由 Electron preload 提供）载一份存量角色
   `工头-133`（无外观、无站位）→ 刷新页面 → 看战场：≤3s 出现合成形象，且**从屏幕左边走进格位**。
3. **新建上场**：dev 句柄 `window.__srfApp.emitCommand({ type:'character.create', name:'工头-140', agentKind:'claude-code' })`
   → ≤2s 战场出现该单位（顶栏"单位总数" +1）。
4. **双 archetype 对照**：再建一个 `agentKind:'codex'` 的 `冷面-140` → 截图对照两张脸。
5. **点击选中**：点战场上单位 → `snapshot().selection.unitIds` 非空（既有选中通道，未扩展）。
6. **删除下场**：`emitCommand({ type:'character.delete', characterId })` → 单位数 2→1，暖色像素数 142→135→109→44（淡出下沉）。
7. **素材缺失兜底**：`page.route('**/spritesheets/**', route.abort())` → 单位仍在战场（占位形象）、
   0 pageerror、其后 3s **零新增日志**（无重试死循环）。
8. **静态检查**：`npx tsc --noEmit`；`npx jest src/world`；
   `grep -rn "document\|new Image\|createElement" src/world --include="*.ts" | grep -v "^src/world/dev/"`（零命中）。

### 验证结果

**① 静态检查**

```
$ npx tsc --noEmit
（无输出，exit 0）

$ npx jest src/world --maxWorkers=1
Test Suites: 34 passed, 34 total
Tests:       514 passed, 514 total

$ npx eslint --cache <改动文件>
（改动文件零告警；src/app/main/main-entry.ts 的 import/order 存量 45 条与 HEAD 一致 —— 本任务零新增）
```

**② 零 DOM 证据**

```
$ grep -rn "document\|new Image\|createElement" src/world --include="*.ts" | grep -v "^src/world/dev/" | grep -vE "^[^:]+:[0-9]+: *\*"
（零命中：运行时 world 层无任何 DOM 调用）
```

`src/world/dev/*` 是独立演示页（dev 入口），不在运行时 world 层内，本任务未改动。
composer 的 DOM 全部来自 app 层注入：`src/app/services/appearance-environment.ts`
（`createCanvas: () => document.createElement('canvas')` / `createImage: () => new Image()`）。

**③ 刷新恢复 + 入场走位（存量角色 工头-133）**

```
单位出现在战场：513 ms（自页面导航起算）
走位抓帧（颜色签名）： [{"at":515,"sig":3},{"at":846,"sig":3},{"at":1183,"sig":3},
                        {"at":1526,"sig":483},{"at":1872,"sig":454},{"at":2203,"sig":492}]
```

暖色像素重心逐帧轨迹（只看角色本体，排除白字标签）：

```
  765ms  n=80  x=119   ← 出现在可视区左外沿（起点）
  971ms  n=85  x=407   ← 走进场
 1175ms  n=83  x=652   ← 接近格位
 1375ms  n=79  x=719   ← 落位（此后不动）
```

截图：`reports/shots/character-stage-r6-walk-0765ms.png`（左外沿）→
`reports/shots/character-stage-r6-walk-1375ms.png`（格位），
另有 `character-stage-r6-walk-{0000,0250,0500,0750,1000,1600}ms.png`、
`character-stage-r6-restored.png`。

快照证据（角色档案本身 appearance 为 null，却有合成形象在场上 —— 裁决链生效）：

```json
{ "units": [{ "id": "unit_character_1793750123353_1", "name": "工头-133",
              "characterId": "character_1793750123353_1", "appearance": null }],
  "characters": [{ "id": "character_1793750123353_1", "name": "工头-133",
                   "agentKind": "claude-code", "appearance": null }] }
```

**④ 生命周期（新建 / 双 archetype / 选中 / 删除）**

```
① 新建角色：单位上战场 15 ms；形象渲染出来 190 ms        （≤2s ✓）
② 双 archetype 战场单位： {"units":[{"name":"工头-140"},{"name":"冷面-140"}],"count":2}
③ 点击选中：before= {"unitIds":[],...}  after= {"unitIds":["unit_character_1793764252796_1"],...}
④ 删除后暖色像素数（退场淡出）： 0ms:142 60ms:135 120ms:109 180ms:44 ...
④ 删除后单位数： 1
```

截图：`character-stage-r6-created.png` / `-two-archetypes.png` / `-selected.png` /
`-exiting.png` / `-after-delete.png`。

**⑤ 素材缺失兜底（拦截 spritesheets 请求）**

```
素材请求被拦截次数： 1
战场单位数： 1 {"units":[{"name":"无素材-140"}],"chars":["无素材-140"]}
兜底后 3s 内新增日志条数： 0      ← 无"合成失败 → 再合成"死循环
pageerror 数： 0
```

截图：`character-stage-r6-missing-assets.png`（战场上是**兜底占位形象**，不是空白）。

### 未尽事项

- **`eye_color` 素材层的路径占位符**（**既存缺陷，不在本任务范围**）：LPC 素材元数据里
  `eyes/human/${head}/${expression}` 是字面占位符没被展开，导致合成时眼睛层永远加载失败
  （控制台每合成一次报一条 warning）。影响：角色的**眼睛**没画出来（其余层正常），
  表现为"脸上没瞳色"。修它要改素材元数据的路径展开逻辑 —— 属于素材域，本任务最小改动原则下未动。
- **恢复链路依赖 Electron preload**：纯 vite 浏览器页没有 `window.electronAPI.gameSave`，
  读档 IPC 面缺席 → 存量角色恢复链路整段不会跑（这是**既存**的运行环境差异，不是本任务的锅；
  验证脚本注入的是真接口，走的是真实链路）。
- **未扩展选中通道**：点击选中直接复用既有 `selection.unitIds` 通道，本任务没加新通道。
- **战场边界兜底**：相机不可用时（场景刚建 / 单测）入场起点退回 `registry.bounds` ——
  此时走位可能在屏幕外（看不见），属极端边界情况。
