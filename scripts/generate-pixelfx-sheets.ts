/**
 * 文件职责：pixelfx 特效的**资产管线**（task_161 一期）—— 把仓内 vendor/pixelfx
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

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { PALETTE_CSS_VARS, VISUAL_PALETTE } from '../src/core/theme/visual-spec';
import { SKINS, type SkinId } from '../src/core/theme/skin-registry';

/** 仓库根（脚本在 scripts/ 下）。 */
const ROOT = path.resolve(__dirname, '..');
/** pixelfx 库根目录：默认取**仓内 vendor**（task_191 / AP-01 起 pixelfx 已 vendor 进仓），可用 PIXELFX_DIR 覆盖。 */
const PIXELFX_DIR = path.resolve(process.env.PIXELFX_DIR ?? path.join(ROOT, 'vendor', 'pixelfx'));
/** 产物根（Vite publicDir = assets/，故这里的文件在 dev 挂站点根、build 拷进产物根）。 */
const FX_ASSET_ROOT = path.join(ROOT, 'assets', 'fx');
/** 运行时索引（生成物，提交入库 —— 运行时只认它，不再问 pixelfx）。 */
const GENERATED_INDEX = path.join(ROOT, 'src', 'world', 'appearance', 'fx-sources.generated.ts');

/**
 * 特效清单：**语义 kind → pixelfx 效果 id**。
 *
 * why kind 用通用语义词（celebrate / levelUp / error / spawn / despawn / command）而不是
 *   pixelfx 的效果名 —— 契约里只说「要什么演出」，不说「用哪个库的效果」；
 *   pixelfx 的名字只出现在本脚本与生成产物里（core/types 里一个都不许有）。
 *
 * ★ 选材硬约束：**只挑 meta 里没有 `actor` 的效果** —— 带 actor 的效果会把自己的
 *   占位小人（stock hero）画进帧里，叠在战场真实单位头上会变成"两个人"（幽灵替身）。
 *   这条筛掉了 glitch / respawn-beam / level-up / heal 等常用候选，故本清单改用
 *   同族但无替身的效果（emp-blast / spawn-portal / heal-aoe）。
 */
interface EffectSpec {
  readonly kind: string;
  /** pixelfx 效果 id（`分类/名字`）。 */
  readonly pixelfxId: string;
  /** 战场显示缩放（1 = 原生像素尺寸；战场单位约 64px，故多数特效要缩）。 */
  readonly scale: number;
  /**
   * 调色板的 token 名序列（**由暗到亮**）—— 逐个从皮肤 token / 战场调色板解析成色值。
   * why 按 token 取而不写死色值：换皮肤重跑本脚本即对齐（palette 对齐验收项）。
   */
  readonly paletteTokens: readonly string[];
  /** 循环效果的驻留时长（ms）；一次性效果留空（按帧数自然结束）。 */
  readonly loopHoldMs?: number;
}

/**
 * 渲染帧率（覆盖效果自带的 meta.fps=30）。
 * why 降到 20：贴图面积与帧数成正比 —— 30fps 时六个效果的贴图合计约 67MB 显存，
 *   20fps 砍掉三分之一，而像素特效在 0.3~0.5 缩放下 20fps 依然流畅（像素画的老规矩是 12~15fps 起）。
 */
const RENDER_FPS = 20;

const EFFECT_SPECS: readonly EffectSpec[] = [
  {
    kind: 'celebrate',
    pixelfxId: 'ui/confetti',
    scale: 0.45,
    paletteTokens: [
      '--srf-visual-background',
      '--srf-danger',
      '--srf-warn',
      '--srf-success',
      '--srf-accent',
      '--srf-badge-accent',
      '--srf-text',
    ],
  },
  {
    kind: 'levelUp',
    pixelfxId: 'holy/heal-aoe',
    scale: 0.4,
    paletteTokens: ['--srf-visual-background', '--srf-warn', '--srf-text'],
  },
  {
    kind: 'error',
    pixelfxId: 'scifi/emp-blast',
    scale: 0.7,
    paletteTokens: [
      '--srf-visual-background',
      '--srf-danger',
      '--srf-visual-accent',
      '--srf-visual-unit',
      '--srf-text',
    ],
  },
  {
    kind: 'spawn',
    pixelfxId: 'spawn/spawn-portal',
    scale: 0.45,
    paletteTokens: [
      '--srf-visual-background',
      '--srf-visual-unit',
      '--srf-visual-accent',
      '--srf-text',
    ],
  },
  {
    kind: 'despawn',
    pixelfxId: 'spawn/poof',
    scale: 0.6,
    paletteTokens: ['--srf-visual-background', '--srf-text-muted', '--srf-text'],
  },
  {
    kind: 'command',
    pixelfxId: 'projectiles/flare',
    scale: 0.3,
    paletteTokens: ['--srf-visual-background', '--srf-warn', '--srf-danger', '--srf-text'],
  },
];

/** 皮肤 token 表：CSS 变量名 → 色值。 */
type TokenTable = ReadonlyMap<string, string>;

/** 解析 `--name: #hex;` 形式的 CSS 自定义属性（只认块内、以分号结尾的声明）。 */
function parseCssTokens(css: string): TokenTable {
  const tokens = new Map<string, string>();
  const pattern = /(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g;
  let match = pattern.exec(css);
  while (match !== null) {
    tokens.set(match[1], match[2]);
    match = pattern.exec(css);
  }
  return tokens;
}

/** 战场调色板 → `--srf-visual-*` token 名（与 hud 注入器同一套命名）。 */
function visualPaletteTokens(): TokenTable {
  const tokens = new Map<string, string>();
  for (const [key, cssVar] of Object.entries(PALETTE_CSS_VARS)) {
    tokens.set(cssVar, VISUAL_PALETTE[key as keyof typeof VISUAL_PALETTE]);
  }
  return tokens;
}

/**
 * 解析一个 token 名 → 色值。
 * 查不到就**报错退出**（不静默回落）：调色板对不齐是必须看见的问题，
 *   悄悄换成一个近似色 = 产物看着正常但配色是错的，比报错难查得多。
 */
function resolveToken(tokens: TokenTable, name: string): string {
  const value = tokens.get(name);
  if (value === undefined) {
    throw new Error(`[fx:generate] 找不到 token ${name}（皮肤 token 表 + 战场调色板都没有）`);
  }
  return value;
}

/** 跑一次 pixelfx 渲染，返回产物目录（sheet 落在 `<out>/<category>/<name>/` 下）。 */
function renderSheet(
  pixelfxId: string,
  palette: readonly string[],
  outDir: string,
): { readonly png: string; readonly json: string } {
  const renderScript = path.join(PIXELFX_DIR, 'tools', 'render.mjs');
  const result = spawnSync(
    process.execPath,
    [
      renderScript,
      pixelfxId,
      '--sheet',
      '--fps',
      String(RENDER_FPS),
      '--out',
      outDir,
      '--opts',
      JSON.stringify({ palette }),
    ],
    { cwd: PIXELFX_DIR, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(
      `[fx:generate] 渲染 ${pixelfxId} 失败（status=${result.status}）：\n${result.stderr ?? ''}${result.stdout ?? ''}`,
    );
  }
  const name = pixelfxId.split('/')[1];
  const dir = path.join(outDir, pixelfxId);
  const png = path.join(dir, `${name}.png`);
  const json = path.join(dir, `${name}.json`);
  if (!fs.existsSync(png) || !fs.existsSync(json)) {
    throw new Error(`[fx:generate] ${pixelfxId} 没有产出 sheet（缺 ${png} 或 ${json}）`);
  }
  return { png, json };
}

/** atlas JSON 里的 pixelfx 元数据（帧率 / 帧数 / 帧尺寸 / 枢轴）。 */
interface AtlasMeta {
  readonly fps: number;
  readonly frames: number;
  readonly frameSize: readonly [number, number];
  readonly pivot: readonly [number, number];
  readonly loop: boolean;
}

function readAtlasMeta(jsonPath: string): AtlasMeta {
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as {
    readonly meta?: {
      readonly pixelfx?: {
        readonly fps?: number;
        readonly frames?: number;
        readonly frameSize?: [number, number];
        readonly pivot?: [number, number];
        readonly loop?: boolean;
      };
    };
  };
  const pixelfx = raw.meta?.pixelfx;
  if (!pixelfx || typeof pixelfx.fps !== 'number' || typeof pixelfx.frames !== 'number') {
    throw new Error(`[fx:generate] atlas JSON 缺 meta.pixelfx（${jsonPath}）—— 不是 pixelfx 产的 sheet`);
  }
  return {
    fps: pixelfx.fps,
    frames: pixelfx.frames,
    frameSize: pixelfx.frameSize ?? [0, 0],
    pivot: pixelfx.pivot ?? [0, 0],
    loop: pixelfx.loop === true,
  };
}

/** 皮肤 id 合法性检查（只用皮肤登记表里的 id —— 免得拼错名字静默生成一套没人用的产物）。 */
function assertSkinId(skin: string): asserts skin is SkinId {
  if (!SKINS.some((item) => item.id === skin)) {
    throw new Error(
      `[fx:generate] 未知皮肤 ${skin}（可选：${SKINS.map((item) => item.id).join(' / ')}）`,
    );
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const skinIndex = args.indexOf('--skin');
  const skin = skinIndex >= 0 ? (args[skinIndex + 1] ?? 'default') : 'default';
  assertSkinId(skin);

  if (!fs.existsSync(path.join(PIXELFX_DIR, 'tools', 'render.mjs'))) {
    throw new Error(`[fx:generate] 找不到 pixelfx 库（${PIXELFX_DIR}）—— 用 PIXELFX_DIR 指定路径`);
  }

  // token 表：皮肤 CSS（--srf-*）叠在战场调色板（--srf-visual-*）之上。
  const skinCssPath = path.join(ROOT, 'src', 'hud', 'theme', `tokens-${skin}.css`);
  if (!fs.existsSync(skinCssPath)) {
    throw new Error(`[fx:generate] 找不到皮肤样式表 ${skinCssPath}`);
  }
  const tokens = new Map<string, string>([
    ...visualPaletteTokens(),
    ...parseCssTokens(fs.readFileSync(skinCssPath, 'utf8')),
  ]);

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
      const rendered = renderSheet(spec.pixelfxId, palette, tmpRoot);
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
      const durationMs =
        spec.loopHoldMs ?? Math.round((meta.frames / meta.fps) * 1000);

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
