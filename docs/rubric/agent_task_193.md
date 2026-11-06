# task_193 工作文档 —— AP-03 双路由像素一致性测试

> 权威定义：`docs/DESIGN-asset-pipelines.md` §1.2 约束2
>   「同一效果 code-route 现算帧 vs 烘焙帧，采样 t 点逐像素 diff（容差内），进 CI。
>     漂移当场报警，烘焙资产不提交入库。」
> 前置：task_191 / AP-01（pixelfx vendor 进仓）、task_192 / AP-02（发布期烘焙钩子）

---

## 1. 交付范围

| 交付物 | 位置 | 性质 |
|---|---|---|
| 双路由像素一致性测试 | `tests/asset-pipeline/fx-dual-route-consistency.test.ts` | 新增（4 个用例） |
| 最小 PNG 解码器（RGBA8 / 非隔行，零依赖） | `tests/asset-pipeline/png-decode.ts` | 新增 |
| 代码路由适配器的帧原点修正 | `src/app/dev/fx-code-pixelfx.ts` | 改动（见 §4） |
| jest 编译 vendor ESM + pixelfx 别名 | `jest.config.js` | 改动 |
| 测试 tsconfig 开 `allowJs` | `tsconfig.test.json` | 改动 |

**不做**：不碰 CharacterComposer（两条烘焙管线禁止互卷，DESIGN §0 铁则）；不引入 npm 依赖；
不 mock 数据（真烘焙 + 真现算）；不重构范围外代码。

---

## 2. 测试形态（CI 可跑）

一条 jest 用例组，落在 `tests/asset-pipeline/`（与 AP-02 的套件同目录，CI 里同一 runner 跑）：

```
双路由像素一致性（task_193 / AP-03 · DESIGN §1.2 约束2）
  ✓ 烘焙产物是真实渲染出来的（帧数 / 尺寸 / 调色板都对得上）
  ✓ impacts/hit-spark：采样 t 点逐像素一致（代码路由现算帧 vs 烘焙帧）
  ✓ holy/heal-aoe：采样 t 点逐像素一致（代码路由现算帧 vs 烘焙帧）
  ✓ 反证：烘焙帧里改动一个像素（±1 级）→ 比较器当场报出该像素
```

### 两条路由怎么拉的（都是真的）

| 路由 | 拉法 | 产物 |
|---|---|---|
| 烘焙路由 | `scripts/lib/fx-pipeline.ts` 的 `renderSheet()` → spawn `vendor/pixelfx/tools/render.mjs --sheet` | PNG sheet + atlas JSON（临时目录，用完删） |
| 代码路由 | `src/app/dev/fx-code-pixelfx.ts` 的 `toCodeFxSource()`（仓内真实适配器）→ `handle.update()/render()` | RGBA 缓冲（直 alpha） |

why 走适配器而不自己调 pixelfx：适配器就是代码路由的线上入口，自己复刻一遍等于测「我抄的那份代码」，
抄错了测试照样绿。

why 两条路由喂**同一份输入**（调色板 + seed）：
- 在发布清单里的效果（heal-aoe ↔ `EFFECT_SPECS` 的 `levelUp`）用清单口径 —— 皮肤 token 解析出的
  调色板 + 清单钉死的 seed = 发布期烘焙用的那份输入，对比的就是发布产物本身；
- 不在清单里的效果（hit-spark：方向性打击特效，方向/翻转要运行时算，sheet 路由给不了）用效果自带的
  默认 ramp 与 seed —— 那也是这个效果在本仓里的真实输入，不是编出来的假数据。

### 采样点

t = 0% / 25% / 50% / 75% / 100%（任务建议）→ 帧号 `round(ratio × (帧数 − 1))`
（hit-spark 11 帧 → 0/3/5/8/10；heal-aoe 59 帧 → 0/15/29/44/58）。

### 比较怎么算（三个必须对齐的口径）

1. **帧原点**：`createFrame(w, h, ox, oy)` 的 ox/oy 是「画布左上角在 world 里的位置」，**不是**效果原点；
   效果原点由 `createFx` 的 x/y 决定。烘焙链用 `createFrame(w, h, 0, 0)`，代码路由必须一致。
2. **步进**：烘焙链 `inst.update(1 / fps)`；代码路由 `handle.update(1000 / fps)` → `fx.update(1 / fps)`。
3. **色彩空间**：烘焙产物落 PNG 时走 `canvas.paste`，那一步把 RGB 按 alpha **预乘**了；代码路由的
   `composite()` 输出**直 alpha**。比较前把代码路由的帧预乘（`Math.round(c × a / 255)`），
   否则半透明像素整片误判。

---

## 3. 容差：为什么选逐通道，为什么是 0 / 32

**判据选型：逐通道 diff，不用感知哈希。**
感知哈希只给「像不像」的二元结论，阈值任意、不可解释，报警时说不出「哪一格偏了多少」；
逐通道能直接报出「哪个通道偏了几级、在哪个像素」，是**可判定**的判据。

| 区域 | 容差 | 依据 |
|---|---|---|
| 主体区（画布去掉四边 8px） | **0**（逐字节相等） | 全帧扫描实测：hit-spark 11 帧 + heal-aoe 59 帧，RGB 与 alpha 的最大偏差都是 **0**。容差取 0 = 任何一像素偏一级就报警 |
| 边带（画布四边 8px） | **32** | 烘焙链多跑一步上游 `edgeFade`（把贴边的辉光渐隐，免得贴进场景露方框），代码路由没有 —— 已知且有界的差异。全帧实测上限：hit-spark **8**、heal-aoe **27** → 给 32（留 5 级余量）；超出即真实漂移，照样报警 |

为什么不给边带 0：那会让测试每次都红（edgeFade 是上游设计内的差异，不是漂移）；
为什么不给边带 64+：容差一放宽就失去意义，真漂移会被淹没。27 → 32 是贴着实测上限给的。

---

## 4. 顺带修掉的一个真 bug（代码路由帧原点）

`src/app/dev/fx-code-pixelfx.ts` 原先写的是 `createFrame(width, height, originX, originY)` ——
把**效果原点**当成了**帧原点**。后果：效果被画到画布左上角、并被裁掉大半
（实测 hit-spark 有 90% 的像素落在画布外）。烘焙链（`fxlib.renderFrames`）用的是 `createFrame(w, h, 0, 0)`，
两路由因此画的不是同一个东西。

修正为 `createFrame(width, height, 0, 0)`，与烘焙链同口径；效果原点的落位仍由 `createFx` 的 x/y 决定
（= `meta.origin`），与 `CodeFxLayer.setOrigin(originX / width, originY / height)` 的锚定契约对得上。

**遗留（不在本任务范围，未改）**：`src/app/dev/fx-code-dev-main.ts` 的 `bench()` 仍按
`createFrame(w, h, ox, oy)` 用法自造帧原点 —— 那是 dev 台自己的摆位口径，与本次修正不冲突，
但下一个人碰那里时值得留意「帧原点 ≠ 效果原点」这条。

---

## 5. 反证（测试有效性）

### 5.1 用例内反证（常驻）

`反证：烘焙帧里改动一个像素（±1 级）→ 比较器当场报出该像素`：
先断言「未改动时主体区零不一致」（否则「报警」没有说服力），再把烘焙帧里**一个不透明**主体区像素的
R 通道 +1 级，断言比较器必须报出**且只报出**那一个像素（x / y / 通道 / delta 都要对得上）。

why 挑不透明的像素：透明像素的 RGB 预乘后恒为 0，改它不产生可观测差异 —— 那样的「反证」是假的
（报警的不是漂移，是运气）。

### 5.2 端到端反证运行（一次性验证，已还原）

把代码路由帧里中心一个像素的 R 改 1 级后重跑，**一致性用例当场变红**，并精确定位到那一个像素：

```
● 双路由像素一致性（task_193 / AP-03 · DESIGN §1.2 约束2） › impacts/hit-spark：采样 t 点逐像素一致（代码路由现算帧 vs 烘焙帧）

  expect(received).toEqual(expected) // deep equality
  - Expected  -  1
  + Received  + 11

    Object {
  -   "coreMismatches": Array [],
  +   "coreMismatches": Array [
  +     Object {
  +       "bakedValue": 130,
  +       "channel": "r",
  +       "codeValue": 0,
  +       "delta": 130,
  +       "region": "core",
  +       "x": 40,
  +       "y": 40,
  +     },
  +   ],
      "effect": "impacts/hit-spark",
      "frame": 0,
    }
```

（改动已还原，仓库里是干净版本。）

---

## 6. 踩过的坑（留档，防重犯）

1. **jest 跑不了 vendor 的 ESM**（`SyntaxError: Unexpected token 'export'`）。
   三个方案都试过：给 vendor 单开 transform 模式 / 用 `^.+\.js$` 兜底 / 在 transform 里内联 tsconfig ——
   都不行。根因（读 ts-jest 源码确认）：
   (a) `allowJs` 关着时 ts-jest 对 `.js` 原样返回，不编译；
   (b) ts-jest 的 `_configsFor` **按 jest project config 缓存 ConfigSet** —— 同一份 config 里写第二条
   ts-jest transform 条目时，它会静默复用第一条的 tsconfig，per-entry tsconfig 被忽略。
   **正解**：合并成单条 `'^.+\\.[tj]s$'` + 在 `tsconfig.test.json` 里开 `allowJs`。
2. **比较脚本里 sheet 的行内取像素忘了加 `x`**（自己写的临时测量脚本，不是仓内测试）——
   一度误判成「两路由大面积不一致」。教训：sheet 的像素地址是 `(rect.y + y) × sheetWidth + rect.x + x`。
3. **PNG 是预乘的、代码路由是直 alpha** —— 不统一色彩空间就会看到成片的假差异。
4. **edgeFade 只在烘焙链跑**（`vendor/pixelfx/tools/lib/fxlib.mjs`，E = 8），是边带容差存在的唯一原因。

---

## 7. 验证

- `npx tsc --noEmit` ✅
- `npx jest tests/asset-pipeline --maxWorkers=1` ✅ 2 suites / 11 tests
  （新 4 + AP-02 既有 7）
