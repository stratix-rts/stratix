/**
 * 文件职责：pixelfx 特效的**开发期资产管线**（task_161 一期）—— 把仓内 vendor/pixelfx
 *   里选定的像素特效批量导出成 sprite sheet（PNG + JSON），落进 Stratix 的静态资产目录，
 *   并生成一张「运行时索引」（src/world/appearance/fx-sources.generated.ts）。
 *
 * 输入：
 *   - pixelfx 库（MIT、零依赖；task_191 起 vendor 进仓，路径 vendor/pixelfx）：
 *     `node tools/render.mjs <id> --sheet` 直出 Aseprite 风格 JSON + PNG；
 *   - 皮肤 token（hud/theme/tokens-<skin>.css 的 --srf-* 变量）+ 战场调色板
 *     （core/theme/visual-spec.ts 的 VISUAL_PALETTE，经 PALETTE_CSS_VARS 映射成 --srf-visual-*）——
 *     **调色板一律从这两处取**，不写字面色值（皮肤换色时重跑本脚本即对齐）。
 * 输出：
 *   - assets/fx/<skin>/<kind>.png + <kind>.json（Phaser `load.atlas` 可直接吃：TexturePacker JSONArray）；
 *   - src/world/appearance/fx-sources.generated.ts（运行时索引：帧率 / 帧数 / 枢轴 / 缩放 / URL）。
 *
 * ★ 与发布期管线的关系（task_192 / AP-02 之后）：
 *   本脚本是**开发期**烘焙 —— 产物入库，dev 与 release 都能直接取到；
 *   发布期另有一条「构建期现烘、产物不入库」的管线（scripts/bake-fx-release.ts）。
 *   两条管线共用效果清单 / 取色口径 / 渲染参数（scripts/lib/fx-pipeline.ts），
 *   故「本脚本烘出来的图」与「发布期烘出来的基础变体」逐字节一致。
 *
 * 禁止事项：
 *   1. 把 pixelfx 的**运行时代码**引进来 —— 一期只出静态 sheet，运行时零新增依赖；
 *   2. 写字面色值字面量 —— 调色板必须能随皮肤 token 一起变（见上）；
 *   3. 产物不入库 —— 本脚本的产物（PNG/JSON/索引）都要提交，否则换台机器就看不到特效；
 *   4. 改 vendor/pixelfx 里的源码 —— 那是上游快照（上游 commit 记在 vendor/pixelfx/UPSTREAM），
 *      要动效果本身去上游改，本仓只重跑本脚本。
 *
 * 跑法：npm run fx:generate            （默认皮肤 default）
 *      npm run fx:generate -- --skin pixel
 *      PIXELFX_DIR=/path/to/pixelfx npm run fx:generate   （覆盖 vendor 路径，用于临时比对手改副本）
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  EFFECT_SPECS,
  RENDER_FPS,
  assertSkinId,
  loadSkinTokens,
  readAtlasMeta,
  renderSheet,
  resolvePixelfxDir,
  resolveToken,
} from './lib/fx-pipeline';

/** 仓库根（脚本在 scripts/ 下）。 */
const ROOT = path.resolve(__dirname, '..');
/** pixelfx 库根目录：默认取**仓内 vendor**（task_191 / AP-01 起 pixelfx 已 vendor 进仓），可用 PIXELFX_DIR 覆盖。 */
const PIXELFX_DIR = resolvePixelfxDir(ROOT);
/** 产物根（Vite publicDir = assets/，故这里的文件在 dev 挂站点根、build 拷进产物根）。 */
const FX_ASSET_ROOT = path.join(ROOT, 'assets', 'fx');
/** 运行时索引（生成物，提交入库 —— 运行时只认它，不再问 pixelfx）。 */
const GENERATED_INDEX = path.join(ROOT, 'src', 'world', 'appearance', 'fx-sources.generated.ts');

function main(): void {
  const args = process.argv.slice(2);
  const skinIndex = args.indexOf('--skin');
  const skin = skinIndex >= 0 ? (args[skinIndex + 1] ?? 'default') : 'default';
  assertSkinId(skin);

  if (!fs.existsSync(path.join(PIXELFX_DIR, 'tools', 'render.mjs'))) {
    throw new Error(`[fx:generate] 找不到 pixelfx 库（${PIXELFX_DIR}）—— 用 PIXELFX_DIR 指定路径`);
  }

  // token 表：皮肤 CSS（--srf-*）叠在战场调色板（--srf-visual-*）之上。
  const tokens = loadSkinTokens(ROOT, skin);

  const outRoot = path.join(FX_ASSET_ROOT, skin);
  fs.mkdirSync(outRoot, { recursive: true });
  // 清掉上一轮的产物：效果清单改了名字时，旧 sheet 不该留在仓库里冒充新产物。
  for (const file of fs.readdirSync(outRoot)) {
    if (file.endsWith('.png') || file.endsWith('.json')) fs.rmSync(path.join(outRoot, file));
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-fx-'));
  const index: string[] = [];

  try {
    for (const spec of EFFECT_SPECS) {
      const palette = spec.paletteTokens.map((name) => resolveToken(tokens, name));
      const rendered = renderSheet({
        pixelfxDir: PIXELFX_DIR,
        pixelfxId: spec.pixelfxId,
        palette,
        outDir: tmpRoot,
        fps: RENDER_FPS,
        // seed 钉死（与发布期管线同一份参数 —— 见文件头「与发布期管线的关系」）。
        seed: spec.seed,
      });
      const meta = readAtlasMeta(rendered.json);

      const pngName = `${spec.kind}.png`;
      const jsonName = `${spec.kind}.json`;
      const pngTarget = path.join(outRoot, pngName);
      const jsonTarget = path.join(outRoot, jsonName);
      fs.copyFileSync(rendered.png, pngTarget);
      fs.copyFileSync(rendered.json, jsonTarget);
      // 拷贝会带上临时目录的 600 权限；入库文件该是 644（否则别人 clone 下来读不了）。
      fs.chmodSync(pngTarget, 0o644);
      fs.chmodSync(jsonTarget, 0o644);

      const framePrefix = spec.pixelfxId.split('/')[1];
      const durationMs = spec.loopHoldMs ?? Math.round((meta.frames / meta.fps) * 1000);

      index.push(
        [
          '  {',
          `    kind: '${spec.kind}',`,
          `    atlasKey: 'fx:${spec.kind}',`,
          `    animKey: 'fx-anim:${spec.kind}',`,
          `    pngPath: '${skin}/${pngName}',`,
          `    jsonPath: '${skin}/${jsonName}',`,
          `    framePrefix: '${framePrefix}',`,
          `    frames: ${meta.frames},`,
          `    fps: ${meta.fps},`,
          `    loop: ${meta.loop},`,
          `    frameWidth: ${meta.frameSize[0]},`,
          `    frameHeight: ${meta.frameSize[1]},`,
          `    pivotX: ${meta.pivot[0]},`,
          `    pivotY: ${meta.pivot[1]},`,
          `    scale: ${spec.scale},`,
          `    durationMs: ${durationMs},`,
          '  },',
        ].join('\n'),
      );
      console.log(
        `[fx:generate] ${spec.kind.padEnd(10)} ${spec.pixelfxId.padEnd(26)} ` +
          `${meta.frames} 帧 @${meta.fps}fps → assets/fx/${skin}/${pngName}`,
      );
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  const file = `/**
 * 文件职责：**生成物** —— pixelfx 特效 sheet 的运行时索引（task_161）。
 *   由 scripts/generate-pixelfx-sheets.ts 生成，**不要手改**：改特效清单请改脚本后重跑
 *   （npm run fx:generate）。产物（assets/fx/ 下的 PNG/JSON）与本文件一起入库。
 * 生成参数：皮肤 = ${skin}
 *
 * why 索引是代码而不是运行时读 JSON：运行时只认这张表（帧名 / 帧率 / 枢轴 / 缩放），
 *   少一次网络往返，也少一处「JSON 改了但索引没改」的漂移。
 * why 索引里存**相对素材根**的路径（pngPath / jsonPath）而不是绝对 URL：
 *   素材根的绝对 URL 由运行环境决定（dev 是 http 站点根、electron 是 file:// 下的 dist/frontend），
 *   运行时按 world/appearance/fx-asset-path.ts 的相对规则解析 —— 同一份索引三种环境通用。
 */

/** pixelfx sheet 的运行时索引（按语义 kind 排布）。 */
export const SPRITE_FX_SOURCES = [
${index.join('\n')}
] as const;
`;
  fs.mkdirSync(path.dirname(GENERATED_INDEX), { recursive: true });
  fs.writeFileSync(GENERATED_INDEX, file, 'utf8');
  console.log(`[fx:generate] 索引已写入 ${path.relative(ROOT, GENERATED_INDEX)}`);
}

main();
