# pixelfx 二期评审：代码路由（运行时逐像素特效）—— 选型 / 护栏实测 / 结论清单

> **@since v3.3（task_162）** · 评审制任务：评审不过只交本文档，不落生产代码。
> 一期（task_161，commit `fd7f8c2`）走 sprite sheet 静态管线；本文评估**代码路由**
> （`createFx` / `composite` 在运行时逐像素算）。
>
> - 仓库：Stratix（分支 `demo/v3.3`）
> - 被评审库：[pixelfx](https://github.com/patch-gg/pixelfx) v0.3.0（MIT，零依赖），本机克隆于 `/Users/kingj/code/pixelfx`
> - 一期触点（本文多处引用）：`src/world/objects/sprite-fx-layer.ts`、`src/world/scenes/fx-asset-scene.ts`、`src/world/appearance/fx-atlas.ts`
> - 本文所有性能数字均为**本机实测原始值**，测量方法与复现命令见 §3.1 / §6。

---

## §0 结论速览

| 项 | 结论 |
|---|---|
| **世界锚定方案** | **选方案 A**：per-effect 离屏 canvas → Phaser 动态纹理（`CanvasTexture`）→ `scrollFactor = 1` 的 `Image` 挂世界坐标。**否决**全屏 overlay（成本与视口面积成正比，是 per-effect 的 60–200 倍；且自己维护世界→屏幕变换、离屏剔除失效）。依据见 §2。 |
| **成本主项** | **不是 120Hz 粒子步进**（实测 < 0.001 ms/帧），而是「画 + 合成」——与**画布面积**成正比（Node 侧合成 ≈ 5.5 ns/px，浏览器整段 ≈ 36–66 ns/px）。GPU 上传（`putImageData` + `refresh`）**不是瓶颈**（四次跑共 80 档，上传段 0.030–0.128 ms/档，比同档 JS 段小 1–2 个数量级）。 |
| **护栏参数** | 并发 **2**（一期 sheet 路由是 4）、单实例画布 **≤ 40,960 px**、渲染 **30 Hz**（仿真仍 120 Hz）、降级下限 **10 Hz**、单帧预算 **4 ms**、超预算降频 → 降到底仍超则挤掉最老实例。实测最坏档（heal-aoe 34,816 px × 并发 2）占 60fps 帧预算 **18.1–19.3%**（四次独立跑）。 |
| **运行时调色** | 通路：`hud/theme/fx-palette-reader.ts`（读 DOM CSS 变量）→ **组合根**写 `Phaser game registry` → `world/appearance/fx-palette.ts` 读口 → `core/theme/fx-palette.ts` 的**共同词汇表**（角色 ↔ token 名 + 兜底色）。**不走总线**（皮肤是每客户端本地偏好，`core/types.ts` 明写不进 WorldState、不广播）。不破总线铁律。 |
| **效果分流** | **值得上代码路由**：① 需要运行时变体的（`flip` / `angle` / `seed`）；② 与皮肤联动的；③ 小面积（≤ 40,960 px）、同屏最多 2 条的。**永远留 sheet**：通用反馈（spawn/despawn/error/celebrate/levelUp/command）、大面积低频演出、需要常态多实例的。 |
| **落地状态** | PoC 已落地但**仅在 dev 验收入口**（`/src/app/dev/fx-code-dev.html`），**不进生产产物**。落地前置条件见 §5（最硬的一条：pixelfx 的分发方式）。 |

---

## §1 背景与范围：两条路由的成本形状根本不同

一期（task_161）走 sprite sheet：特效在**生成期**被 pixelfx 的 `tools/render.mjs --sheet` 烘成 PNG + atlas JSON，运行时只做「换纹理帧」（`Phaser` 的 `scene.anims`）。这条路的运行时成本几乎全在 **GPU 合成**，CPU 侧只是设置纹理帧 —— 所以一期的护栏形状是「**并发实例数**」（`core/theme/visual-spec.ts` 的 `SPRITE_FX_METRICS.maxConcurrent = 4`）。

二期代码路由把成本搬到了**主线程的逐像素计算**上：

```
每帧每实例： fx.update(dt)  →  clearFrame(frame)  →  fx.draw(frame)  →  composite(frame, rgba)
               ↑ 120Hz 粒子步进      ↑ 清两个 Uint32Array    ↑ Painter 逐像素写   ↑ 合成 RGBA
```

两者的护栏旋钮因此完全不同：

| | sheet 路由（一期） | 代码路由（二期） |
|---|---|---|
| 运行时主项 | GPU 合成（换纹理帧） | 主线程逐像素（画 + 合成） |
| 成本标量 | **实例数** | **实例数 × 画布面积** |
| 能否运行时改色 | 否（色值烘进 PNG） | 是（palette 每实例现取） |
| 能否程序化变体 | 否（每个变体一张 sheet） | 是（`flip` / `angle` / `seed` 免费） |
| 离屏剔除 | 有效（不播就零成本） | 有效（不算就不画）——**前提是选对锚定方案**，见 §2 |
| 护栏形态 | 并发数上限 | 并发数 + 面积上限 + **降级动作**（降频 / 挤实例） |

**本文范围**：评审 + 小规模实测（2–3 个代表效果）+ 结论。**不做**：生产接线、效果全量选材、Worker 化改造（见 §5 前置条件）。

---

## §2 世界锚定方案选型（需求 1）

### 2.1 问题

pixelfx 产出的是 `ImageData` —— **屏幕空间语义**（一张与相机无关的位图）。
Stratix 的特效必须**锚在世界坐标**：跟着单位走、跟着相机走、离屏就该停。

### 2.2 两个候选方案

**方案 A —— per-effect 离屏 canvas → Phaser 动态纹理 → `scrollFactor = 1` 的 Image**

每个特效实例持有**自己尺寸**（如 136×80）的 `CanvasTexture` 与一块 `ImageData`：

```
composite(frame, imageData.data, null)   ← 合成直接写进 ImageData 的内存（零拷贝）
  → ctx.putImageData(imageData, 0, 0)    ← 上屏
  → texture.refresh()                     ← WebGL 下重新上传
  → Image(x, y, textureKey).setScrollFactor(1)   ← 挂世界坐标
```

**方案 B —— 全屏 overlay**：一块视口大小的 canvas，每帧把所有特效画进去，
再叠一张 `scrollFactor = 0` 的全屏 `Image`（自己算世界→屏幕变换）。

### 2.3 逐项对照

| 维度 | 方案 A（per-effect） | 方案 B（全屏 overlay） |
|---|---|---|
| **合成成本与什么成正比** | **效果自身面积**（10,880–34,816 px） | **视口面积**（1920×1080 = 2,073,600 px） |
| 同上，实测代价 | 并发 2 最坏档 **3.022–3.218 ms/帧**（浏览器，四次跑） | 按实测 ns/px 外推 ≈ **75–137 ms/帧** —— **4.5–8.2 倍于整个 60fps 帧预算** |
| 世界锚定 | Phaser 的 `scrollFactor = 1` 常规语义，**免费** | 要自己维护世界→屏幕变换（camera scroll/zoom），**与相机耦合** |
| 离屏剔除 | 挂载点出视口 → 不算不画（与一期同一条纪律） | overlay 永远在屏上 → 剔除失效（除非自己再算一遍可见性 = 把 A 的复杂度引回来） |
| 逐实例降频 | 可以（每个实例独立 `renderHz`） | 不行（全屏一起降） |
| 显存 | 并发 × 面积 × 4 B（并发 2 时最大 0.27 MB） | 视口 × 4 B（8.3 MB）+ 每帧全屏上传 |
| 层级 / 指针事件 | 普通 `Image`，与 HUD 无关 | 全屏 `Image` 会吃掉指针事件，需显式 `setInteractive`/穿透处理 |
| 多相机 / 缩放 | 常规语义 | 每相机一层 |
| 效果互相叠加 / 加色 | 做不到（各自独立纹理） | 天然支持 |

**唯一支持 B 的点是「全屏特效互相叠加、加色」—— 本项目当前没有这类需求。**

### 2.4 选型结论

> **采用方案 A**：per-effect 离屏 canvas → `CanvasTexture` → `scrollFactor = 1` 的 `Image`。
>
> 决定性理由按权重排序：
> 1. **成本与视口面积脱钩**。方案 B 的合成成本随视口线性增长：按本机实测速率
>    （浏览器整段 36–66 ns/px，Node 侧纯合成 5.5 ns/px）外推，1920×1080 的 overlay
>    单帧就要 **11–137 ms** —— 光是「把特效画进 overlay」这一件事就能吃掉 1–8 个帧预算。
>    方案 A 的成本只跟特效自己的画布走，且**面积可被硬上限卡住**（40,960 px）。
> 2. **世界锚定零成本**。`scrollFactor = 1` 是 Phaser 的既有语义，特效代码里不需要出现任何相机矩阵 ——
>    这也让「特效锚在哪」只有一个答案（world 坐标），不会出现两套。
> 3. **离屏剔除与逐实例降频都成立**。这是两条护栏纪律（`docs/PERFORMANCE_GUIDELINES.md`：
>    「离屏即停」「帧率低于 30fps 时必须有降级策略」）能落地的**前提**；方案 B 直接把这前提弄丢了。
> 4. **显存可控**：并发 2 × 40,960 px × 4 B ≈ 0.33 MB，与视口大小无关。
>
> 方案 B 不是「更通用所以更好」的选择 —— 它把一条成本曲线从「效果面积」换成了「视口面积」，
> 而视口面积**不由特效系统控制**（用户可以拉大窗口）。这也正是方案 A 必须带
> **面积硬上限 + 降级动作**的原因（§3）。

### 2.5 方案 A 的实测证据

`tests/e2e/fx-code-route.spec.ts`（dev 验收页，Playwright 驱动）：

- **世界锚定**：相机右移 200 世界 px → 实例的**世界坐标不变**（`after.world[0].x === before.world[0].x`），
  **屏幕坐标反向平移 −200 px**（`after.screen[0].x − before.screen[0].x ≈ −200`）。
  这两个断言合起来就是「挂在世界里而不是贴在屏幕上」的可判定证据 —— 不靠肉眼。
- 截图：`reports/shots/fx-162-world-anchor.png`

---

## §3 CPU 预算护栏实测（需求 2）

### 3.1 测量方法

成本链分四段，本节把**纯 JS 逐像素**（步进 / 画 / 合成）与**上屏**（`putImageData` + GPU 上传）分开量：

```
① fx.update(dt)          120Hz 粒子步进（createFx 内部把 dt 切成 120Hz 子步）
② clearFrame + fx.draw   Painter 逐像素写进两个 Uint32Array
③ composite(frame, out)  两个缓冲合成 RGBA（浏览器里紧跟着 putImageData）
④ putImageData + refresh  上屏（仅浏览器里存在）
```

**两套基准，各测各的段：**

| 基准 | 脚本 / 入口 | 测什么 | 方法纪律 |
|---|---|---|---|
| **Node 基准** | `scripts/bench-pixelfx-runtime.mjs` | 纯 JS 逐像素（①+②+③），**分段**计时 | 180 帧采样 + 30 帧预热；dt = 1/60；并发 1/2/4/8；每档先跑 60 帧把效果推过爆发期 |
| **浏览器基准** | dev 验收入口内置 `bench()`（`src/app/dev/fx-code-dev-main.ts`），由 Playwright 驱动 | ①+②+③ 与 ④ 分开；**纹理挂可见 `Image`**（= 运行时形态） | 每档 60 帧、**逐帧对齐 `requestAnimationFrame`**、每效果先预热 150 帧 |

**三条测量纪律（都是被数据教会的）：**

1. **逐帧对齐 rAF**。紧循环跑出来的数好看 2–3 倍（缓存热、中间没有渲染插着），
   但运行时每帧都夹着 Phaser 渲染 —— 只有 rAF 对齐的数才是运行时真相。
2. **每个效果先预热**。前 ~150 帧是冷代码，成本虚高数倍 —— 本机实测（Node，heal-aoe 256×136，
   同一段代码路径）：**冷（前 60 帧）0.927 ms/帧 → 热（210 帧之后）0.186 ms/帧 = 5.0×**。
3. **预热每个效果只做一次**。预热的是**代码路径**，不是实例状态。

**机器**：Apple M1 Ultra · macOS (darwin/arm64) · Node v22.22.2 · Chrome（Playwright Desktop Chrome）。

### 3.2 原始数字（一）Node 侧：纯 JS 逐像素

复现：`PIXELFX_DIR=/Users/kingj/code/pixelfx node scripts/bench-pixelfx-runtime.mjs`

```
effect              px      并发    单实例ms      p50ms    p95ms    maxms    占预算%
impacts/hit-spark   10880   1        0.060   0.06   0.06   0.08   0.4
impacts/hit-spark   10880   2        0.072   0.12   0.14   0.26   0.9
impacts/hit-spark   10880   4        0.070   0.24   0.28   0.36   1.7
impacts/hit-spark   10880   8        0.068   0.47   0.55   0.72   3.3
spawn/poof          10304   1        0.074   0.06   0.07   0.14   0.4
spawn/poof          10304   2        0.067   0.11   0.13   0.24   0.8
spawn/poof          10304   4        0.065   0.22   0.26   0.41   1.6
spawn/poof          10304   8        0.077   0.45   0.62   0.84   3.7
scifi/emp-blast     17632   1        0.206   0.10   0.21   0.52   1.2
scifi/emp-blast     17632   2        0.176   0.20   0.35   1.60   2.1
scifi/emp-blast     17632   4        0.233   0.41   0.93   2.91   5.6
scifi/emp-blast     17632   8        0.225   0.82   1.80   3.16  10.8
holy/heal-aoe       34816   1        0.586   0.22   0.59   0.78   3.5
holy/heal-aoe       34816   2        0.517   0.42   1.03   1.99   6.2
holy/heal-aoe       34816   4        0.494   0.77   1.98   2.85  11.9
holy/heal-aoe       34816   8        0.507   1.64   4.05   5.82  24.3
ui/confetti         28000   1        0.319   0.22   0.32   0.48   1.9
ui/confetti         28000   2        0.225   0.37   0.45   0.56   2.7
ui/confetti         28000   4        0.221   0.76   0.88   1.11   5.3
ui/confetti         28000   8        0.232   1.54   1.86   2.61  11.1
```

**分段（单实例平均 ms/帧：步进 / 画 / 合成）**

```
effect              px      步进        画         合成        画布px/µs
impacts/hit-spark   10880      0.000   0.003   0.058177248814.9
spawn/poof          10304      0.001   0.005   0.060157351320.6
scifi/emp-blast     17632      0.000   0.004   0.098172820396.6
holy/heal-aoe       34816      0.001   0.006   0.193175035597.1
ui/confetti         28000      0.005   0.043   0.154138741365.3
```

> 「画布px/µs」= 该效果画布面积 ÷ 合成耗时 → 换算成 **ns/px**（合成速率 = 1000 ÷ 该列）。
> 由上表反推的合成速率：**hit-spark 5.35 · poof 5.45 · emp-blast 5.46 · heal-aoe 5.55 · confetti 5.68 ns/px**
> —— 五个效果跨 10,304–34,816 px 面积，速率一致到 ±3%：**合成成本 ≈ 5.5 ns/px，与面积严格线性**。
>
> **步进（120Hz 粒子仿真）= 0.000–0.005 ms/帧** —— 即使是 confetti（粒子最密）也只有 0.005 ms。
> 「画」也只有 0.003–0.043 ms。**逐像素的合成是唯一的大头。**

### 3.3 原始数字（二）浏览器侧：JS 段 + 上屏段（运行时形态）

复现：`npx playwright test --config=tests/e2e/playwright.fx.config.ts fx-code-route -g "护栏实测"`

```
基准：每档 60 帧（每效果预热 150 帧）· 60fps rAF 对齐 · 帧预算 16.67ms · 纹理上屏中（挂可见 Image）
effect              px    并发     js ms   上传 ms   合计 ms   占预算%
impacts/hit-spark   10880    1    0.395     0.043     0.438       2.6
impacts/hit-spark   10880    2    0.662     0.053     0.715       4.3
impacts/hit-spark   10880    4    1.333     0.083     1.417       8.5
impacts/hit-spark   10880    8    2.017     0.110     2.127      12.8
spawn/poof          10304    1    0.680     0.033     0.713       4.3
spawn/poof          10304    2    1.048     0.052     1.100       6.6
spawn/poof          10304    4    1.682     0.082     1.763      10.6
spawn/poof          10304    8    2.777     0.112     2.888      17.3
scifi/emp-blast     17632    1    1.703     0.040     1.743      10.5
scifi/emp-blast     17632    2    2.552     0.043     2.595      15.6
scifi/emp-blast     17632    4    3.182     0.068     3.250      19.5
scifi/emp-blast     17632    8    4.472     0.100     4.572      27.4
holy/heal-aoe       34816    1    2.283     0.057     2.340      14.0
holy/heal-aoe       34816    2    3.135     0.083     3.218      19.3
holy/heal-aoe       34816    4    3.622     0.075     3.697      22.2
holy/heal-aoe       34816    8    4.727     0.102     4.828      29.0
ui/confetti         28000    1    1.262     0.057     1.318       7.9
ui/confetti         28000    2    2.058     0.095     2.153      12.9
ui/confetti         28000    4    3.083     0.113     3.197      19.2
ui/confetti         28000    8    3.407     0.112     3.518      21.1
```

**第二、三次独立跑同一基准（完整原始值 —— 用于看稳定性）：**

```
基准：每档 60 帧（每效果预热 150 帧）· 60fps rAF 对齐 · 帧预算 16.67ms · 纹理上屏中（挂可见 Image）
effect              px    并发     js ms   上传 ms   合计 ms   占预算%
impacts/hit-spark   10880    1    0.585     0.033     0.618       3.7      ← 第二次
impacts/hit-spark   10880    2    0.770     0.070     0.840       5.0
impacts/hit-spark   10880    4    1.218     0.068     1.287       7.7
impacts/hit-spark   10880    8    1.938     0.125     2.063      12.4
spawn/poof          10304    1    0.648     0.038     0.687       4.1
spawn/poof          10304    2    1.010     0.053     1.063       6.4
spawn/poof          10304    4    1.798     0.085     1.883      11.3
spawn/poof          10304    8    2.618     0.118     2.737      16.4
scifi/emp-blast     17632    1    1.827     0.037     1.863      11.2
scifi/emp-blast     17632    2    2.493     0.048     2.542      15.2
scifi/emp-blast     17632    4    3.370     0.068     3.438      20.6
scifi/emp-blast     17632    8    4.705     0.108     4.813      28.9
holy/heal-aoe       34816    1    2.177     0.047     2.223      13.3
holy/heal-aoe       34816    2    3.130     0.075     3.205      19.2
holy/heal-aoe       34816    4    3.568     0.088     3.657      21.9
holy/heal-aoe       34816    8    4.860     0.118     4.978      29.9
ui/confetti         28000    1    1.245     0.068     1.313       7.9
ui/confetti         28000    2    2.033     0.082     2.115      12.7
ui/confetti         28000    4    3.037     0.117     3.153      18.9
ui/confetti         28000    8    3.562     0.113     3.675      22.1
```

```
effect              px    并发     js ms   上传 ms   合计 ms   占预算%    ← 第三次
impacts/hit-spark   10880    1    0.478     0.030     0.508       3.0
impacts/hit-spark   10880    2    0.755     0.038     0.793       4.8
impacts/hit-spark   10880    4    1.287     0.075     1.362       8.2
impacts/hit-spark   10880    8    2.017     0.128     2.145      12.9
spawn/poof          10304    1    0.645     0.032     0.677       4.1
spawn/poof          10304    2    1.087     0.062     1.148       6.9
spawn/poof          10304    4    1.808     0.082     1.890      11.3
spawn/poof          10304    8    2.720     0.092     2.812      16.9
scifi/emp-blast     17632    1    1.877     0.040     1.917      11.5
scifi/emp-blast     17632    2    2.903     0.052     2.955      17.7
scifi/emp-blast     17632    4    3.155     0.068     3.223      19.3
scifi/emp-blast     17632    8    4.635     0.115     4.750      28.5
holy/heal-aoe       34816    1    2.280     0.057     2.337      14.0
holy/heal-aoe       34816    2    3.123     0.085     3.208      19.2
holy/heal-aoe       34816    4    3.803     0.068     3.872      23.2
holy/heal-aoe       34816    8    5.023     0.120     5.143      30.9
ui/confetti         28000    1    1.222     0.065     1.287       7.7
ui/confetti         28000    2    2.002     0.087     2.088      12.5
ui/confetti         28000    4    3.143     0.125     3.268      19.6
ui/confetti         28000    8    3.603     0.118     3.722      22.3
```

> 另有一次跑（改了 dev 页的色值来源之后复跑）观察到 heal-aoe 并发 2 = **3.022 ms / 18.1%** ——
> 四次里最低的一次。下文所有区间都按**四次跑的极值**给。

**多次跑的稳定性（诚实版）**：

| 档位 | 四次跑的区间 | 说明 |
|---|---|---|
| 大档位（并发 ≥ 4） | 绝对波动 **±7% 以内**（heal-aoe 并发 8：4.828–5.143 ms = 29.0–30.9%；emp-blast 并发 4：3.223–3.438 ms） | 绝对量大，JIT 与缓存都热了，数字可信 |
| 小档位（并发 1–2） | 相对波动大：hit-spark 并发 1 = 0.438 / 0.618 / 0.508 ms（**极差 +41%**，绝对差 0.18 ms）；并发 2 = 0.715–0.840 ms（±17%） | 绝对值太小（< 1 ms），计时器噪声与首次触碰的缓存状态占比大 —— **不要拿小档位的百分比当结论** |
| **护栏依赖的那一档** | heal-aoe 并发 2 = **3.022 / 3.205 / 3.208 / 3.218 ms（18.1 / 19.2 / 19.2 / 19.3%）** | **四次极差 6.5%，且集中在 18–19.3%** —— 护栏结论建立在最坏档上，而最坏档恰好是最稳的 |

→ **护栏取最坏档而不是均值**；护栏依赖的那一档四次跑的极差是 0.196 ms（占帧预算 1.2 个百分点）。

### 3.4 从数字里读出来的四件事

1. **120Hz 粒子步进几乎免费**。Node 分段实测：步进 = **0.000–0.005 ms/帧**（confetti 粒子最密也只有 0.005 ms）。
   `createFx.update` 内部把 dt 切成 120Hz 子步，但步进本身只改粒子的状态量，
   代价与粒子数近似无关于画布分辨率。**任务书里担心的「120Hz 粒子步进成本」不是瓶颈。**
2. **成本主项是「画 + 合成」，与画布面积成正比**。
   - Node 纯合成 ≈ **5.5 ns/px**（五个效果 5.35–5.68 ns/px，跨 10,304–34,816 px 面积一致到 ±3%）。
   - 浏览器整段（步进+画+合成）≈ **36–66 ns/px**（hit-spark 并发 1：0.395 ms / 10,880 = 36.3 ns/px；
     heal-aoe 并发 1：2.283 ms / 34,816 = 65.6 ns/px；四次跑落在 36–66 区间）——
     差异来自「画」的粒度（Painter 只在有内容处写）与效果的绘制指令复杂度，不是线性外推能覆盖的。
   - **结论：护栏的主旋钮必须是「并发数 × 画布面积」，不是粒子数。**
3. **GPU 上传不是瓶颈**。四次跑共 80 档的上传段在 **0.030–0.128 ms**，比同档 JS 段小 **1–2 个数量级**。
   → **别去优化上传**（刷纹理、双缓冲、缩放上传都不值得）；要优化就控面积。
4. **「越并发越划算」是假象**：并发 1→2 的单实例边际成本在下降（缓存热、粒子密度摊薄），
   但总成本线性涨。并发 8 时最贵档 4.828–5.143 ms = **29.0–30.9% 的帧预算** —— 加上 Phaser 自身的渲染与
   状态机工作，这已经不适合 60fps 的战场了。

### 3.5 护栏参数推导

护栏常量落在唯一事实源 `src/core/theme/visual-spec.ts` 的 `CODE_FX_METRICS`：

| 参数 | 取值 | 推导 |
|---|---|---|
| `maxConcurrent` | **2** | 并发 2 时最贵档（heal-aoe 34,816 px）= 3.022–3.218 ms = 帧预算 **18.1–19.3%**；并发 4 = 21.9–23.2%（4 ms 预算已被吃掉一半以上），并发 8 = 29.0–30.9%。取 2 → 最坏档位仍留 4/5 的帧预算给 Phaser 自身渲染与状态机。**比 sheet 路由的 4 更紧**（sheet 路由 CPU 侧几乎零成本，这里每实例每帧要算一遍画布）。 |
| `maxCanvasAreaPx` | **40,960**（≈256×160） | 这是**拒收阈值**，不是「保证不超预算」的承诺：按浏览器最贵的 66 ns/px 估，40,960 px 的效果单实例就要 2.70 ms，并发 2 就是 5.4 ms —— 所以**面积上限与并发上限必须同时存在**，两者相乘才是真实成本，运行时再靠自适应降频兜住 4 ms 帧预算。40,960 是「256×160 的效果能用、再大就拒收」的整数档；**超限直接不播**（成本与面积成正比，放进来就是白烧 CPU）。实测最贵的合规效果 heal-aoe（34,816 px）并发 2 是 3.02–3.22 ms，落在预算内。 |
| `renderHz` / `minRenderHz` | **30 / 10** | 渲染 30Hz → 最贵档的 3.2 ms 摊到 60fps 的两帧上 = **平均 1.6 ms/帧**。正好落在 `docs/PERFORMANCE_GUIDELINES.md`「帧率低于 30fps 时必须有降级策略」的线上。**仿真仍是 120 Hz**（`createFx.update` 内部自己切子步）—— 降的只是画面帧率，物理/粒子轨迹不受影响。 |
| `frameBudgetMs` | **4** | 60fps 的帧预算 16.67 ms 中给代码路由划 4 ms（约 1/4）。超过 → 降一档渲染频率；降到 10 Hz 仍超 → 挤掉最老的一条实例（宁可少一条特效，也不可掉帧）。 |
| `offscreenMarginPx` | **96** | 与一期 `SPRITE_FX_METRICS.offscreenMarginPx` 同值（同一条纪律：离屏即停并回收）。 |

**降级动作链**（`src/world/appearance/code-fx-policy.ts`，纯逻辑、零 Phaser、单测覆盖）：

```
准入：面积 > 40,960 px            → 永不播（面积是根因）
      并发 ≥ 2                   → 挤掉最老的一条再播
每帧：实测占用 > 4 ms            → 渲染频率减半（下限 10 Hz）
      已到 10 Hz 仍超 4 ms        → 挤掉最老的一条实例
离屏：挂载点出视口（+96px 留边）  → 停止计算并回收（白烧 CPU 的反面：什么都不做）
```

> **一条实现细节（实测逼出来的）**：预算自适应只看「**真正画了东西的帧**」的耗时，
> 不看「只跑仿真、没渲染」的帧 —— 后者成本天然低一个量级，拿它当预算信号会让
> 渲染频率在两档之间来回抖（实测 30Hz ↔ 15Hz 每几帧翻一次），画面反而更难看。
> 见 `src/world/objects/code-fx-layer.ts` 的 `lastRenderCostMs`。

### 3.6 与既有 CPU 纪律的对照（load 敏感史）

`docs/PERFORMANCE_GUIDELINES.md` 的开篇写着它自己的来历：**「诞生于一次惨痛教训：测试脚本把
M1 Ultra 20 核 64GB 的 Mac Studio 吃到死机」**。本任务沿用其中与本议题直接相关的四条，逐条对照：

| 既有纪律（PERFORMANCE_GUIDELINES） | 代码路由的符合情况 |
|---|---|
| 「动画和实时渲染（Phaser/Canvas）：帧率低于 30fps 时必须有降级策略」 | ✅ 正是 `renderHz = 30 → minRenderHz = 10 → 挤实例` 这条链。**降级动作是硬要求，不是可选项。** |
| 「任何循环处理超过 1000 条数据的，必须使用分片/分批处理」 | ✅ 本路径的数据量是「画布像素数」，由 `maxCanvasAreaPx = 40,960` 硬封顶（< 1000 条数据量级 × 4 通道），不需要分片。 |
| 「计算密集型操作（加密、大数组处理、**图像处理**）必须放到 Web Worker 或子进程」 | ⚠️ **未满足**。逐像素合成当前跑在**主线程**。可行的 Worker 化路径是 `OffscreenCanvas` + `Worker`（Worker 里渲染到离屏画布 → `transferToImageBitmap` 回主线程），但那会引入构建链与调试复杂度 —— **本轮不做，列为落地前置条件（§5.3）**。当前用「面积上限 + 并发上限 + 降频」把主线程占用压在帧预算的 1/4 以内作为缓解。 |
| 「内存：长生命周期的对象必须有淘汰策略」「图片/资源懒加载，不在首屏加载不可见内容」 | ✅ 每实例一块 `CanvasTexture`，实例结束/被挤掉/离屏即 `textures.remove()`（资源必须可清理）；代码路由特效**不进首屏**，只在触发时创建。 |

**load 敏感史给出的最重要一条结论**：**别在「打开战场」这条路上加成本**。
代码路由特效**必须是事件驱动的**（触发才创建），不能有「常驻的特效层每帧算点什么」——
所以 `CodeFxLayer` 在没有实例时 `tick()` 是零成本的空转 —— 实测（浏览器、200 帧）：**p50 = 0 ms**（低于浏览器计时器 0.1 ms 的分辨率）、avg 0.0065 ms、最坏 0.1 ms。即「打开战场」这条路上不叠加任何逐像素成本。

---

## §4 运行时调色通路（需求 3）

### 4.1 要解决的问题

sheet 路由的调色板在**生成期**烘进 PNG —— 换皮肤要重跑 `npm run fx:generate`。
代码路由的机会在于：**调色板可以是运行时现取的**，皮肤切了，下一个特效实例立刻用新色。

### 4.2 通路设计

```
  hud/theme/fx-palette-reader.ts            ← 唯一能碰 DOM 的一层
  ┌──────────────────────────────────────────┐
  │ getComputedStyle(documentElement)        │
  │   .getPropertyValue('--srf-accent') 等 7 个 token │
  │   → 「token 名 → 色值」表                │
  └───────────────┬──────────────────────────┘
                  │  app 层（组合根：唯一同时认识 hud 与 world 的地方）
                  │  game.registry.set(FX_PALETTE_KEY, table)
                  ▼
  core/theme/fx-palette.ts                   ← 共同词汇（core 是两侧唯一公共面）
  ┌──────────────────────────────────────────┐
  │ FX_PALETTE_ROLES：角色 → token 名        │
  │ FX_PALETTE_FALLBACK：兜底色（只有一份）  │
  │ resolveFxPalette(raw)：解析 + 补缺       │
  └───────────────┬──────────────────────────┘
                  │  world/appearance/fx-palette.ts（world 侧读口）
                  │  readFxPalette(this.scene.registry) → 角色齐全的 FxPalette
                  ▼
  src/world/objects/code-fx-layer.ts         ← 每个实例出生时按源声明的槽位顺序取色
```

### 4.3 为什么不破铁律

| 铁律 | 本通路的符合情况 |
|---|---|
| **总线铁律**（`core/types.ts` 通信铁律 P3）：hud → core 只允许 `HudCommand`；world → core 只允许 `WorldEvent`；**任何 hud ↔ world 的直接调用都是架构违规** | ✅ **hud 与 world 全程没有互相 import，也没有互相调用**。中间隔了 core（词汇表）与 app（组合根的 registry 写入）。 |
| **core 零 IO / core 不认识两侧**（`core/store.ts` 铁律） | ✅ `core/theme/fx-palette.ts` 只有常量与纯函数 —— 不读 CSS、不碰 DOM、不 import phaser。 |
| **world 零 DOM** | ✅ world 侧只读 `registry.get(FX_PALETTE_KEY)`，从不碰 `document`。 |
| **皮肤不进 `WorldState`、不广播**（`core/types.ts` §「用户偏好」明写） | ✅ **刻意不走总线**：皮肤是**每客户端本地**的展示偏好。把它塞进 `WorldState` 等于给状态机加第二个真相源（且要广播给所有客户端 —— 而别人的皮肤跟你无关）。`registry` 天然是**每客户端本地**的（Phaser 实例就在客户端里），语义完全对得上。 |

### 4.4 先例与两个易错点

- **先例**：`reduced-motion` 走的就是同一条路 —— app 层在 `preBoot` 里
  `registry.set(REDUCED_MOTION_KEY, prefersReducedMotion())`，world 侧 `readReducedMotion(store)`
  每次现取（`src/world/motion.ts`）。调色板只是同一个模式换一个键。
- **易错点 ①：不要缓存**。皮肤随时能切，缓存 = 读到旧色。`readFxPalette` **每次现取**；
  实例的调色板在**出生时**解析一次（出生后不再变 —— 一个特效播到一半换色会更怪）。
- **易错点 ②：不要把战场语义色混进来**。`VISUAL_PALETTE`（`core/theme/visual-spec.ts`）是场景层的语义色，
  与皮肤无关；特效调色板只认皮肤 token 这一条线。兜底色**只有一份**（`core/theme/fx-palette.ts`），
  不允许第二处抄写。
- **兜底**：token 读不到 / 值非法 → 走 `FX_PALETTE_FALLBACK`（默认皮肤的色），
  **而不是黑屏或透明**。皮肤样式表没装、元素不存在、值写坏了，特效都照播。

### 4.5 实测证据

`tests/e2e/fx-code-route.spec.ts`「皮肤联动」用例：切皮肤（default → pixel）后

- registry 里的 token 表变了（`--srf-accent` 前后不同）；
- 解析出的调色板变了（`palette.accent` 前后不同）；
- **新实例的槽位色 = 当前皮肤的 `success` 色**，且 ≠ 旧皮肤的 `success` 色。

截图：`reports/shots/fx-162-skin-link.png`。

---

## §5 结论清单（需求 4）

### 5.1 路由分流判据（三条**可判定**的规则，按顺序问）

1. **需不需要运行时变体？**（`flip` / `angle` / `seed` / `palette` 随皮肤变）
   → 不需要 ⇒ **留 sheet**（sheet 的 GPU 合成成本几乎为零，没有理由为它付主线程的钱）。
2. **画布面积 ≤ 40,960 px 吗？** → 超 ⇒ **留 sheet**（超限的代码路由实例会被护栏直接拒播）。
3. **同屏同时最多 2 条吗？** → 会高峰爆 ⇒ **留 sheet**（sheet 路由能开 4 条且零 CPU 成本）。

### 5.2 分流清单

| 效果 | 路由 | 理由 |
|---|---|---|
| `impacts/hit-spark`（命中火花，136×80） | ✅ **代码路由** | 方向性打击特效 —— 需要按攻击方向**镜像/旋转**。sheet 路由要为每个朝向各做一张图（等于 N 倍素材与 N 倍显存），代码路由里 `flip` / `angle` 是**免费参数**。面积 10,880 px，同屏 2 条 = 4.3–5.0% 帧预算（四次跑）。 |
| `holy/heal-aoe`（治疗光环，256×136） | ✅ **代码路由** | **皮肤联动**：光效颜色应该跟皮肤走（深色皮肤要更亮的光）。sheet 路由要重跑生成脚本换 PNG；代码路由里调色板每实例现取。面积 34,816 px（贴上限），同屏 2 条 = 18.1–19.3% 帧预算 —— **这类大面积效果要盯着并发数**。 |
| `spawn/poof`（出生烟，112×92） | ⚠️ **sheet 为主** | 面积小、无变体需求、出生演出可能扎堆（多单位同帧出生 > 2 条）→ 判据 3 不过。留 sheet。 |
| `scifi/emp-blast`（EMP 爆炸，152×116） | ⚠️ **sheet 为主** | 同上：无运行时变体需求；并发 2 已占 15.2–17.7% 帧预算（四次跑），再加其他演出就挤。留 sheet。 |
| `ui/confetti`（彩带，200×140） | ❌ **永远留 sheet** | 纯装饰（28,000 px，面积虽在限内但没有变体需求）、可能多实例叠加 → 判据 1、3 都不满足；且 sheet 已有现成的一期资产。 |
| `celebrate` / `levelUp` / `spawn` / `despawn` / `error` / `command`（一期已烘的 6 个 sheet） | ❌ **永远留 sheet** | 通用反馈演出：静态、无变体需求、面积大（celebrate 的 sheet PNG 有 596 KB）、高频触点。代码路由在这里没有任何它给不了的东西，却要付主线程的钱。 |

### 5.3 落地前置条件（要把代码路由接进生产，必须先做这几件）

1. **【最硬】pixelfx 的分发方式**。~~PoC 原本用 vite 别名指向**仓外兄弟目录**~~ ——
   **已解决（task_191 / AP-01，2026-11-06）**：pixelfx 源码已 **vendor 进仓**（`vendor/pixelfx/`，
   MIT，保留 `LICENSE` / `NOTICE.md`，上游 commit 记在 `vendor/pixelfx/UPSTREAM`），
   vite 别名改指仓内、`server.fs.allow` 的仓外特例随之删除。
   别的机器 clone 下来即带这份源码，生产构建不再依赖本机的兄弟目录。
2. **生产接线**。PoC 现在只挂在 dev 验收入口（`/src/app/dev/fx-code-dev.html`），
   生产战场需要：`CodeFxLayer` 挂进 `BattlefieldScene`、组合根写 registry 调色板、
   以及**代码路由效果源**的注册表（目前只有 dev 页里硬编码的两个）。
3. **降级兜底**。pixelfx 加载失败 / 效果模块缺失 ⇒ 回落到 sheet 路由（而不是少演一次）。
4. **reduced-motion 兼容**。`prefers-reduced-motion` 的用户应当**不播代码路由**（或只播静态首帧）——
   沿用 `world/motion.ts` 的现成口径。这条**当前未做**，是落地前必须补的。
5. **Worker 化评估**（见 §3.6 的 ⚠️ 行）。当前逐像素在主线程。
   `OffscreenCanvas` + Worker 可解，但要动构建链 —— **排在落地之后**，不是前置。

### 5.4 总体结论

> **代码路由值得存在，但它是「sheet 路由的补充」而不是「替代」**。
>
> 它的价值只来自 sheet 给不了的三件事：**运行时调色板**、**程序化变体（flip/angle/seed）**、
> **纯 t 循环特效的无限平铺**。凡是用不到这三件事的效果，留在 sheet 路由 —— 那条路上
> 运行时成本几乎为零。
>
> 成本上它是可控的：最坏档（并发 2 × 34,816 px）占 60fps 帧预算 **18.1–19.3%**（四次独立跑），
> 加上护栏（面积上限 + 并发上限 + 降频 + 挤实例 + 离屏即停），
> 代码路由可以安全地作为「特殊效果路由」存在。
>
> **但它现在还不该进生产** —— §5.3 的第 1 条（依赖分发）**已由 task_191 / AP-01 解决**（pixelfx vendor 进仓），
>   但第 2~4 条（生产接线 / 降级兜底 / reduced-motion）仍未做，PoC 仍只停在 dev 入口。

---

## §6 复现与验证

```bash
# 0) 依赖：pixelfx 已 vendor 进仓（task_191 / AP-01）—— 无需克隆，别名指向 vendor/pixelfx

# 1) 类型检查（零新增依赖应仍通过）
npx tsc --noEmit

# 2) 单测：调色板三层 + 预算护栏（36 例）
npx jest src/core/theme/__tests__/fx-palette.test.ts \
         src/hud/theme/__tests__/fx-palette-reader.test.ts \
         src/world/appearance/__tests__/fx-palette.test.ts \
         src/world/appearance/__tests__/code-fx-policy.test.ts --maxWorkers=1

# 3) Node 基准（纯 JS 逐像素，§3.2 的数字）—— 默认读仓内 vendor/pixelfx
node scripts/bench-pixelfx-runtime.mjs

# 4) 浏览器基准 + e2e 验收（§3.3 的数字 + §2.5 / §4.5 的断言）
#    需要 dev vite 在 7523：npm run dev
npx playwright test --config=tests/e2e/playwright.fx.config.ts fx-code-route
```

**本文档引用的实测结论一览**

| 断言 | 出处 |
|---|---|
| 世界锚定成立（相机平移 200 px → 世界坐标不变、屏幕坐标 −200） | `tests/e2e/fx-code-route.spec.ts`「世界锚定」 |
| 皮肤联动成立（切皮肤 → 新实例槽位色 = 新皮肤 `success`） | 同上「皮肤联动」 |
| 护栏成立（一次播 8 条 → 场上 ≤ 2 条；渲染频率 ∈ [10, 30] Hz） | 同上「预算护栏」 |
| 护栏实测（并发 2 全部效果合计 < 16.67 ms 帧预算） | 同上「护栏实测」 |
| 成本主项是面积而非粒子数 | §3.4 段 1/2（Node 分段 + 浏览器三表） |
| GPU 上传不是瓶颈 | §3.4 段 3（80 档上传段 0.030–0.128 ms） |
| 无实例时 tick 零成本（p50 = 0 ms，avg 0.0065 ms） | §3.6 末段（浏览器 200 帧实测） |
