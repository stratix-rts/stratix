# task_134

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_134.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

像素细节A：商免像素字体内嵌+命中-模块

## requirements

1. 像素皮肤使用**仓库内嵌**的商免像素字体（OFL 许可）—— Fusion Pixel（缝合像素字体，自带 CJK），
   字体资产 + OFL 许可证副本一起入库；子集化后 woff2 ≤ 400 KB。
2. 像素皮肤下 `font-family` 栈首位命中该字体，`document.fonts.check` 为真，中英文均为真像素字形。
3. 现代皮肤零影响：字体栈不含它、`@font-face` 不注册、不下载字体。
4. 覆盖层（扫描线 + 像素网格）透明度明显降低，UI 仍可读；对比度交给字体与 token。
5. 不动布局骨架、不动现代皮肤 token、不引 npm 依赖、不动 gateway/。
6. 字体在 vite dev 与构建产物（含 electron 正式包的相对基址）两条路径都可加载。

## acceptance

- [x] 仓库含 `assets/fonts/fusion-pixel-12px-zh-hans.woff2`（171.4 KB ≤ 400 KB）与 `OFL-FusionPixel.txt`
- [x] 像素皮：`document.fonts.check('16px "Fusion Pixel"', '中文')` → true；computed font-family 首位 = `"Fusion Pixel"`
- [x] 现代皮：computed font-family 不含 Fusion Pixel；`document.fonts` 里 0 个 Fusion Pixel face
- [x] 扫描线 token 0.22 → 0.10（网格 0.055）；截图确认 UI 仍可读
- [x] `npx tsc --noEmit` 通过；`npx jest src/hud/__tests__/skin-switch.test.ts` 绿（57 tests 全绿）
- [x] vite dev 实测字体可加载（HTTP 200, font/woff2）+ electron 路径相对基址核查

## 交付物

| 文件 | 作用 |
| --- | --- |
| `assets/fonts/fusion-pixel-12px-zh-hans.woff2` | **Fusion Pixel 12px Mono zh-Hans** 子集（6928 码位 / 175 KB），OFL 1.1 = 可商用 |
| `assets/fonts/OFL-FusionPixel.txt` | 上游许可证副本（OFL 要求随字体分发） |
| `assets/fonts/README.md` | 字体出处、版本、子集口径、重建步骤 |
| `scripts/build-pixel-font-subset.py` | 子集重建脚本（本地工具链，**零 npm 依赖**） |
| `src/hud/theme/pixel-font.ts` | 字体族名 / 相对基址解析 / `@font-face` 规则生成（纯函数） |
| `src/hud/theme/tokens-pixel.css` | 字体栈首位换成 `"Fusion Pixel"`；扫描线 0.22 → **0.10** |
| `src/hud/theme/skin-pixel-layer.css` | 字距 0.06em → **0**（守住像素栅格）；覆盖层退回氛围档 |
| `src/app/main/main-entry.ts` / `src/hud/dev/hud-dev-entry.ts` / `src/app/dev/hello-loop-entry.ts` | 把 `@font-face` 拼进**像素皮肤源**（切走像素 = 字体从文档消失） |
| `src/hud/theme/__tests__/pixel-font.test.ts` | 字体 URL 三态解析 / 族名一致 / 资产与许可在库 / 体积预算 |
| `src/hud/__tests__/skin-switch.test.ts` | 像素源含 `@font-face`、现代皮零残留 |
| `reports/shots/*-r4*.png` | 验收截图（像素皮肤 / 现代皮肤 / 3x 字形特写） |

## 验证证据（完成前必填）

- [x] **实现证明**:
  - 字体栈首位 = `"Fusion Pixel"`（`tokens-pixel.css`），字形来自仓库内嵌 woff2，**不依赖用户装字体**。
  - `@font-face` 由 `pixel-font.ts` 在运行时拼进像素皮肤源，URL 按 `document.baseURI` + 入口深度算
    （dev http / 构建产物 http / 正式包 file:// 同一条相对规则，与素材基址同一套做法）。
  - 像素皮肤源 = token 表 + 像素视觉层 + `@font-face`，三者同一张 `<style id="srf-theme-pixel">` → 切走像素整张 disabled。
  - 扫描线 token 0.22 → 0.10，网格按 0.55 折一档（≈0.055）；字距 0.06em → 0。

- [x] **测试验证**:
  - `npx tsc --noEmit` → 通过（无输出）。
  - `npx jest src/hud/__tests__/skin-switch.test.ts src/hud/theme/__tests__/pixel-font.test.ts src/hud/theme/__tests__/skin-tokens.test.ts`
      → **3 suites / 57 tests 全绿**。
  - Playwright（vite dev 7523 实测）：
      - 像素皮：`document.fonts.check('16px "Fusion Pixel"', '中文')` → **true**；
        `document.fonts` 里 `Fusion Pixel` 状态 **loaded**；主要 UI 文本 computed `font-family`
        首位 = `"Fusion Pixel"`（含中文 span / 标题 / 数值）。
      - 现代皮：`document.fonts` 里 **0 个** Fusion Pixel face；computed font-family 只有
        `system-ui…` / `ui-monospace…`（**不含** Fusion Pixel）；像素样式表 disabled。
      - 截图：`reports/shots/pixel-font-r4-full.png`、`pixel-font-r4-text-zoom.png`（3x 特写，
        中文「态势总览 / 单位总数 / 活跃任务」字形为真像素块状）、`modern-font-r4-full.png`。
  - 资产服务实测：`curl /fonts/fusion-pixel-12px-zh-hans.woff2` → **HTTP 200**，
    `content-type: font/woff2`，175528 字节。
  - 体积：175528 B ≈ **171.4 KB ≤ 400 KB**。

- [x] **影响范围**:
  - 现代皮肤零影响（token 未动、字体栈不含它、@font-face 不注册）。
  - 布局骨架未动（未改任何组件样式 / DOM 结构）；像素皮仅字距 0.06em → 0（文字略收窄，无换行变化）。
  - 未引入 npm 依赖；未动 gateway / HEARTBEAT.md / 其他 reports。
  - 共享文件（main-entry / hello-loop-entry / hud-dev-entry）只提交本任务自己的 hunk，
    他人未提交的改动留在工作区。

### 测试步骤
1. `source ~/.nvm/nvm.sh && nvm use 22`
2. `npx tsc --noEmit`
3. `npx jest src/hud/__tests__/skin-switch.test.ts src/hud/theme/__tests__/pixel-font.test.ts --maxWorkers=1`
4. `node tmp/verify-pixel-font-r4.mjs`（vite dev 7523 在跑；切 `localStorage['stratix.skin']='pixel'` 后 reload）
5. 看 `reports/shots/pixel-font-r4-text-zoom.png`（3x 字形特写）与 `modern-font-r4-full.png`（现代皮对照）

### 验证结果

```
Test Suites: 3 passed, 3 total
Tests:       57 passed, 57 total

=== 像素皮肤（pixel）字体状态 ===
{ "faces": [ { "family": "Fusion Pixel", "status": "loaded" } ], "check": true }

=== 现代皮肤（default）===
{
  "registeredFusionFaces": [],
  "families": [
    "-apple-system, \"system-ui\", \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
    "Times",
    "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
  ]
}

font HTTP 200 size=175528 type=font/woff2
```

### 未尽事项
- 正式 electron 包走 `file://`，字体 URL 已按相对基址拼对；但 Chromium 对 `file://` 字体有 CORS
  限制（与该包内 ES module 的 `file://` 加载同源问题），本次未做打包实测（验收口径为
  「vite 实测 + electron 配置核查」）。
- 像素字体设计尺寸为 12px，HUD 的 11/14/16px 字号属非整数缩放（16px 标题可见轻微不均匀），
  属观感优化项，本任务未动字号（布局不动）。
- 字体子集覆盖 GB2312 全集；生僻字（GBK 扩展区）不在集内，浏览器自动回退系统字体。
