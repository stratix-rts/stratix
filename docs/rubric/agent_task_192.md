# task_192 工作文档 —— AP-02 发布期烘焙钩子

> 权威定义：`docs/DESIGN-asset-pipelines.md` §1.1（release 烘焙）+ §1.2 约束1（确定性）
> 前置：task_191 / AP-01（pixelfx vendor 进仓，19d424c）

---

## 1. 交付范围

把「特效 sheet」从**开发期烘焙（产物入库）**扩到**发布期烘焙（构建期现烘、产物不入库）**：

| 交付物 | 位置 | 性质 |
|---|---|---|
| 共享烘焙层（效果清单 / 取色 / 渲染 / atlas 元数据） | `scripts/lib/fx-pipeline.ts` | 新增（161 与 192 共用同一份事实） |
| 发布期烘焙器（变体计划 / 产物 / manifest / 确定性） | `scripts/lib/fx-release-bake.ts` | 新增 |
| 发布期烘焙 CLI（含 `--verify` 确定性自检） | `scripts/bake-fx-release.ts` | 新增 |
| build 钩子（vite `closeBundle` 烘进产物根） | `vite.config.ts` | 改动 |
| 开发期脚本改为复用共享层 | `scripts/generate-pixelfx-sheets.ts` | 改动（行为不变） |
| npm 入口 | `package.json`（`fx:bake` / `fx:bake:verify`） | 改动 |
| 忽略规则 | `.gitignore`（`dist/frontend/fx/`） | 改动 |
| 单测（变体计划 / 确定性 / 不入库闸门） | `tests/asset-pipeline/fx-release-bake.test.ts` | 新增 |

**不做**：不碰 CharacterComposer（两条烘焙管线禁止互卷，DESIGN §0 铁则）；不引入 npm 依赖；不改运行时（运行时只读 atlas 的口径本来就成立，见 §5）；不动已入库的 `assets/fx/default`。

---

## 2. 参数面翻译表（DESIGN §1.1）落地

| 运行时参数 | 烘焙表达 | 本批 6 个效果的实际落法 |
|---|---|---|
| `palette` | 按皮肤烘变体 | ✅ 皮肤闭集 = `default`（现代深色 = modern）/ `pixel`，每个皮肤一套调色板（取自 `tokens-<skin>.css` + 战场调色板，不写字面色值） |
| `flip` | GPU `setFlipX`（不烘） | ✅ 不烘 —— 镜像在 GPU 上免费 |
| `angle` | 离散方向桶 / 收敛镜像 | ⚠️ 本批效果**不消费 `angle`**（源码里没有 `o.angle`）→ 0 桶，标 `runtime-only` |
| `seed` | 烘 K 变体随机选 | ✅ K = 2：变体 0 = 基础变体（seed = 效果自带默认 seed，**钉死**在共享层清单里），变体 1 = `seed + 1000` |

`seed` 为什么必须钉死：效果自带的 `meta.options.seed` 虽确定，但它随**上游快照**变 ——
上游一改默认值，同一份输入就烘出不同的图，构建不再可重现。钉在共享层后，「同输入 → 同输出」由本仓保证。

---

## 3. 变体清单（24 个 atlas = 48 个文件 + 1 份 manifest）

- **皮肤变体**：`default`（modern）/ `pixel`
- **效果**（语义 kind，6）：`celebrate` / `levelUp` / `error` / `spawn` / `despawn` / `command`
- **seed 变体**：`base`（基础变体，文件名 `<kind>.png` —— 与运行时索引 `fx-sources.generated.ts` 对得上，运行时零改动即可命中）、`s1`（`<kind>__s1.png`）

产物路径（相对烘焙产物根 `dist/frontend/fx/`）：

```
default/celebrate.png        default/celebrate__s1.png        pixel/celebrate.png       …
default/levelUp.png          default/levelUp__s1.png          pixel/levelUp.png         …
default/error.png            default/error__s1.png            pixel/error.png           …
default/spawn.png            default/spawn__s1.png            pixel/spawn.png           …
default/despawn.png          default/despawn__s1.png          pixel/despawn.png         …
default/command.png          default/command__s1.png          pixel/command.png         …
fx-bake-manifest.json        ← 变体清单（每个产物的 seed / 调色板 / sha256 / 帧数 / 枢轴）
```

manifest **不含时间戳、不含绝对路径** —— 否则两次烘焙的 manifest 就不会逐字节一致。

---

## 4. 三条硬约束的落地与证据

### ① build 触发烘焙（幂等可重跑）

- 钩子：vite 插件 `stratix:fx-release-bake`（`closeBundle` —— 必须在 publicDir 拷贝之后，故选 closeBundle）。
  `npm run build:frontend` → vite build → 钩子烘进 `dist/frontend/fx/`。
- 独立入口：`npm run fx:bake`（可重跑；每次先清空产物目录再重写 → 幂等）。
- 逃生门：`STRATIX_SKIP_FX_BAKE=1`（只想看页面、不想等烘焙时用）。

实测（`npm run build:frontend` 尾行）：

```
✓ built in 2m 12s
[plugin stratix:fx-release-bake] 特效发布期烘焙完成：24 个 atlas（皮肤 default/pixel）→ /Users/kingj/code/Stratix-demo/dist/frontend/fx
```

### ② 确定性（同输入两次烘焙逐字节一致）

`npm run fx:bake:verify`（烘两份到临时目录 → 逐文件 sha256 比对 + manifest 字节比对）：

```
[fx:bake] manifest 逐字节一致：是
[fx:bake] 产物条目数：24（差异 0 处）
[fx:bake] 确定性自检通过：同输入两次烘焙，逐字节一致
```

`diff -r` 证据（两次独立烘焙）：

```
=== diff -r /tmp/fxbake-a /tmp/fxbake-b ===
diff exit code = 0 （0 = 无差异）
      49                ← 文件数（48 产物 + 1 manifest）
b05bd14f0fba90ed…  /tmp/fxbake-a/fx-bake-manifest.json
b05bd14f0fba90ed…  /tmp/fxbake-b/fx-bake-manifest.json
```

**跨管线一致性**：开发期烘焙（`npm run fx:generate` → `assets/fx/default/`）与发布期烘焙
（`npm run fx:bake` → `dist/frontend/fx/default/`）的**基础变体逐字节一致** ——
两条管线共用同一份共享层，参数口径没有分叉：

```
  逐字节一致  celebrate.png / levelUp.png / error.png / spawn.png / despawn.png / command.png
```

### ③ 产物不入库

- 产物落**构建产物目录** `dist/frontend/fx/`（`dist/` 已被忽略；另加显式规则 `dist/frontend/fx/`）。
- 烘焙器内置**闸门**：产物目录落在 `assets/`（入库资产目录）里 → 直接报错，不给机会
  （单测 `「产物不入库」闸门` 覆盖）。
- `git status` 里无 `dist/` / `assets/` 条目；`git check-ignore -v` 命中忽略规则。

---

## 5. 运行时只读 atlas（口径未变，已复核）

- 生产产物 `dist/frontend/fx/<skin>/<kind>.png` 正是运行时索引指向的位置
  （`pngPath: 'default/celebrate.png'`，相对 `fx-asset-path.ts` 的素材根解析）→ **运行时零改动**。
- 生产 bundle 内**无 pixelfx 运行时代码**（`grep -l "pixelfx\|createFx\|stockActor" dist/frontend/assets/*.js` → 无命中）：
  运行时只从 atlas 取帧，不跑代码路由。

---

## 6. 已知边界（留给后续任务，不在本单范围）

1. **变体的运行时消费还没接线**：基础变体已被运行时索引命中；`__s1` 变体目前只存在于产物与 manifest 里，
   等运行时侧支持「同 kind 多变体随机挑」时再接（DESIGN §1.1「seed → 烘 K 变体随机选」的兑现动作）。
2. **发布闭集只有 modern / pixel 两套皮肤**：其余 6 套皮肤在发布产物里没有对应 sheet，
   运行时回落到 default 的 sheet（近似色）—— 与 task_161 现状一致，不在本单改动面内。
3. **angle 面未落地**：本批效果不消费 `angle`，故 0 桶；若日后换用支持方向的效果，
   在 `planFxBakeVariants` 里加方向桶即可（翻译表已写在 manifest 的 `paramPlan` 里）。
4. **入库的 `assets/fx/default/*.png` 与当前 vendor 快照存在「像素相同、字节不同」**：
   161 烘焙时用的是仓外兄弟目录（当时带本地改动），AP-01 vendor 的是上游 commit 快照，
   两者渲染像素完全一致（实测 0 字节差），只是 PNG 编码字节流不同。
   本单**没有重编码入库资产**（避免无关二进制变更）；两条管线当下的产物彼此逐字节一致（见 §4②）。

---

## 7. 自验输出（原样）

```
$ npx tsc --noEmit
（无输出，exit 0）

$ npx tsc -p tsconfig.test.json --noEmit
（无输出，exit 0）

$ npx jest tests/asset-pipeline --maxWorkers=1
PASS tests/asset-pipeline/fx-release-bake.test.ts (5.042 s)
  发布期特效烘焙（task_192 / AP-02）
    变体计划
      ✓ 皮肤闭集 = modern(default) / pixel 两套 (1 ms)
      ✓ 计划 = 皮肤 × 效果 × seed 变体，顺序固定 (1 ms)
      ✓ 基础变体沿用运行时索引的文件名（<kind>.png），变体带 __sN 后缀
      ✓ seed 钉死：变体 seed = 基础 seed + 变体序号 × 固定步长 (1 ms)
    确定性（DESIGN §1.2 约束1）
      ✓ 同输入两次烘焙，产物与 manifest 逐字节一致 (1794 ms)
    「产物不入库」闸门
      ✓ 产物目录落在 assets/（入库资产目录）里 → 报错 (9 ms)
      ✓ 产物目录落在构建产物目录里 → 放行

Test Suites: 1 passed, 1 total
Tests:       7 passed, 7 total
```
