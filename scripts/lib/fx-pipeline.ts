/**
 * 文件职责：pixelfx 特效**烘焙管线的共享层** —— 效果清单 / 调色板取色 / 渲染调用 / atlas 元数据读取。
 *
 * 消费者（两条管线共用同一份事实）：
 *   ① scripts/generate-pixelfx-sheets.ts（task_161 一期：**开发期**烘焙，产物入库）；
 *   ② scripts/lib/fx-release-bake.ts（task_192 / AP-02：**发布期**烘焙，产物不入库，见
 *      docs/DESIGN-asset-pipelines.md §1.1 release 烘焙 + §1.2 约束1 确定性）。
 *
 * why 抽成共享层：效果清单与取色口径一旦有两份，换皮肤 / 换效果就会漂 ——
 *   「发布期现烘的图」与「开发期提交的图」必须是同一套参数出的，否则线上线下对不上，
 *   而这种漂移要到用户眼前才发现（同一特效两种颜色）。
 *
 * 输入：仓库根 rootDir + 皮肤 id（skin，取 src/hud/theme/tokens-<skin>.css 的 token 表 + 战场调色板
 *   PALETTE_CSS_VARS）+ 效果 spec（EFFECT_SPECS 里的 kind / pixelfxId / scale / paletteTokens / 钉死的 seed）
 *   + 渲染参数（fps = RENDER_FPS）；pixelfx 库根默认取仓内 vendor/pixelfx，可用 PIXELFX_DIR 覆盖。
 * 输出：纯函数返回值 —— TokenTable（token 名 → #hex）、AtlasMeta（fps / frames / frameSize / pivot / loop）、
 *   RenderedSheet（{ png, json } 两个产物路径，落在调用方给的 outDir/<分类>/<名字>/ 下）；
 *   本层不落最终产物目录、不写 manifest（落盘与 manifest 构造归 fx-release-bake.ts）。
 *
 * 禁止事项：
 *   1. 引入 pixelfx 的**运行时代码** —— 本层只调用 vendor/pixelfx/tools/render.mjs 这个
 *      离线渲染 CLI（一期纪律：运行时零新增依赖）；
 *   2. 写字面色值 —— 调色板一律从皮肤 token + 战场调色板取（换皮肤重跑即对齐）；
 *   3. import hud / world —— 本层只认 core；
 *   4. 改 vendor/pixelfx 里的源码 —— 那是上游快照（上游 commit 记在 vendor/pixelfx/UPSTREAM），
 *      要动效果本身去上游改，本仓只重跑烘焙。
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { PALETTE_CSS_VARS, VISUAL_PALETTE } from '../../src/core/theme/visual-spec';
import { SKINS, type SkinId } from '../../src/core/theme/skin-registry';

/**
 * 特效清单：**语义 kind → pixelfx 效果 id**。
 *
 * why kind 用通用语义词（celebrate / levelUp / error / spawn / despawn / command）而不是
 *   pixelfx 的效果名 —— 契约里只说「要什么演出」，不说「用哪个库的效果」；
 *   pixelfx 的名字只出现在本层与生成产物里（core/types 里一个都不许有）。
 *
 * ★ 选材硬约束：**只挑 meta 里没有 `actor` 的效果** —— 带 actor 的效果会把自己的
 *   占位小人（stock hero）画进帧里，叠在战场真实单位头上会变成"两个人"（幽灵替身）。
 *   这条筛掉了 glitch / respawn-beam / level-up / heal 等常用候选，故本清单改用
 *   同族但无替身的效果（emp-blast / spawn-portal / heal-aoe）。
 */
export interface EffectSpec {
  /** 语义 kind（= 运行时契约里的 SpriteFxKind）。 */
  readonly kind: string;
  /** pixelfx 效果 id（`分类/名字`）。 */
  readonly pixelfxId: string;
  /** 战场显示缩放（1 = 原生像素尺寸；战场单位约 64px，故多数特效要缩）。 */
  readonly scale: number;
  /**
   * 调色板的 token 名序列（**由暗到亮**）—— 逐个从皮肤 token / 战场调色板解析成色值。
   * why 按 token 取而不写死色值：换皮肤重跑烘焙即对齐（palette 对齐验收项）。
   */
  readonly paletteTokens: readonly string[];
  /** 循环效果的驻留时长（ms）；一次性效果留空（按帧数自然结束）。 */
  readonly loopHoldMs?: number;
  /**
   * 烘焙 seed（**钉死**，AP-02 确定性硬约束）。
   *
   * why 要显式钉：效果自带 meta.options.seed 虽是确定的，但它随上游快照变 ——
   *   上游一改默认值，同一份输入就烘出不同的图，构建不再可重现。钉在本层后，
   *   「同输入 → 同输出」由本仓自己保证（DESIGN §1.2 约束1）。
   * why 取值 = 上游默认值：这样「基础变体」与代码路由现算帧的默认 seed 一致，
   *   双路由像素一致性测试（DESIGN §1.2 约束2）才有可比性。
   */
  readonly seed: number;
}

/**
 * 渲染帧率（覆盖效果自带的 meta.fps=30）。
 * why 降到 20：贴图面积与帧数成正比 —— 30fps 时六个效果的贴图合计约 67MB 显存，
 *   20fps 砍掉三分之一，而像素特效在 0.3~0.5 缩放下 20fps 依然流畅（像素画的老规矩是 12~15fps 起）。
 */
export const RENDER_FPS = 20;

/** 效果清单（两条烘焙管线共用 —— 见文件头 why 抽成共享层）。 */
export const EFFECT_SPECS: readonly EffectSpec[] = [
  {
    kind: 'celebrate',
    pixelfxId: 'ui/confetti',
    scale: 0.45,
    seed: 11,
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
    seed: 6,
    paletteTokens: ['--srf-visual-background', '--srf-warn', '--srf-text'],
  },
  {
    kind: 'error',
    pixelfxId: 'scifi/emp-blast',
    scale: 0.7,
    seed: 33,
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
    seed: 6,
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
    seed: 21,
    paletteTokens: ['--srf-visual-background', '--srf-text-muted', '--srf-text'],
  },
  {
    kind: 'command',
    pixelfxId: 'projectiles/flare',
    scale: 0.3,
    seed: 2,
    paletteTokens: ['--srf-visual-background', '--srf-warn', '--srf-danger', '--srf-text'],
  },
];

/** 皮肤 token 表：CSS 变量名 → 色值。 */
export type TokenTable = ReadonlyMap<string, string>;

/**
 * 解析 pixelfx 库根目录：默认取**仓内 vendor**（task_191 / AP-01 起 pixelfx 已 vendor 进仓），
 * 可用 PIXELFX_DIR 环境变量覆盖（用于临时比对手改副本）。
 */
export function resolvePixelfxDir(rootDir: string): string {
  return path.resolve(process.env.PIXELFX_DIR ?? path.join(rootDir, 'vendor', 'pixelfx'));
}

/** 解析 `--name: #hex;` 形式的 CSS 自定义属性（只认块内、以分号结尾的声明）。 */
export function parseCssTokens(css: string): TokenTable {
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
export function visualPaletteTokens(): TokenTable {
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
export function resolveToken(tokens: TokenTable, name: string): string {
  const value = tokens.get(name);
  if (value === undefined) {
    throw new Error(`[fx] 找不到 token ${name}（皮肤 token 表 + 战场调色板都没有）`);
  }
  return value;
}

/**
 * 载入一套皮肤的 token 表（战场调色板打底，皮肤样式表覆盖）。
 * @param rootDir 仓库根（皮肤样式表在 src/hud/theme/ 下）。
 * @param skin 皮肤 id。
 */
export function loadSkinTokens(rootDir: string, skin: SkinId): TokenTable {
  const skinCssPath = path.join(rootDir, 'src', 'hud', 'theme', `tokens-${skin}.css`);
  if (!fs.existsSync(skinCssPath)) {
    throw new Error(`[fx] 找不到皮肤样式表 ${skinCssPath}`);
  }
  return new Map<string, string>([
    ...visualPaletteTokens(),
    ...parseCssTokens(fs.readFileSync(skinCssPath, 'utf8')),
  ]);
}

/** 皮肤 id 合法性检查（只用皮肤登记表里的 id —— 免得拼错名字静默生成一套没人用的产物）。 */
export function assertSkinId(skin: string): asserts skin is SkinId {
  if (!SKINS.some((item) => item.id === skin)) {
    throw new Error(
      `[fx] 未知皮肤 ${skin}（可选：${SKINS.map((item) => item.id).join(' / ')}）`,
    );
  }
}

/** atlas JSON 里的 pixelfx 元数据（帧率 / 帧数 / 帧尺寸 / 枢轴）。 */
export interface AtlasMeta {
  readonly fps: number;
  readonly frames: number;
  readonly frameSize: readonly [number, number];
  readonly pivot: readonly [number, number];
  readonly loop: boolean;
}

/** 读 atlas JSON 的 meta 段（不是 pixelfx 产的 sheet 直接报错）。 */
export function readAtlasMeta(jsonPath: string): AtlasMeta {
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
    throw new Error(`[fx] atlas JSON 缺 meta.pixelfx（${jsonPath}）—— 不是 pixelfx 产的 sheet`);
  }
  return {
    fps: pixelfx.fps,
    frames: pixelfx.frames,
    frameSize: pixelfx.frameSize ?? [0, 0],
    pivot: pixelfx.pivot ?? [0, 0],
    loop: pixelfx.loop === true,
  };
}

/** 一次渲染的产物（sheet 的 PNG + atlas JSON）。 */
export interface RenderedSheet {
  readonly png: string;
  readonly json: string;
}

/** 渲染一次 sheet 的入参。 */
export interface RenderSheetOptions {
  /** pixelfx 库根目录。 */
  readonly pixelfxDir: string;
  /** 效果 id（`分类/名字`）。 */
  readonly pixelfxId: string;
  /** 调色板（色值序列，由暗到亮）。 */
  readonly palette: readonly string[];
  /** 产物落盘目录（临时目录即可 —— 调用方负责搬到最终位置）。 */
  readonly outDir: string;
  /** 渲染帧率。 */
  readonly fps: number;
  /** 烘焙 seed（钉死；不给则用效果自带默认值）。 */
  readonly seed?: number;
}

/**
 * 跑一次 pixelfx 渲染，返回产物路径（sheet 落在 `<out>/<category>/<name>/` 下）。
 *
 * why 走 CLI（spawn vendor/pixelfx/tools/render.mjs）而不是 import 库：
 *   渲染器是上游快照里的离线工具，CLI 是它对外的稳定接口 —— 换上游版本时改动面最小。
 */
export function renderSheet(options: RenderSheetOptions): RenderedSheet {
  const renderScript = path.join(options.pixelfxDir, 'tools', 'render.mjs');
  if (!fs.existsSync(renderScript)) {
    throw new Error(`[fx] 找不到 pixelfx 渲染器 ${renderScript}`);
  }
  const args = [
    renderScript,
    options.pixelfxId,
    '--sheet',
    '--fps',
    String(options.fps),
  ];
  if (options.seed !== undefined) args.push('--seed', String(options.seed));
  args.push('--out', options.outDir, '--opts', JSON.stringify({ palette: options.palette }));

  const result = spawnSync(process.execPath, args, {
    cwd: options.pixelfxDir,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `[fx] 渲染 ${options.pixelfxId} 失败（status=${result.status}）：\n${result.stderr ?? ''}${result.stdout ?? ''}`,
    );
  }
  const name = options.pixelfxId.split('/')[1];
  const dir = path.join(options.outDir, options.pixelfxId);
  const png = path.join(dir, `${name}.png`);
  const json = path.join(dir, `${name}.json`);
  if (!fs.existsSync(png) || !fs.existsSync(json)) {
    throw new Error(`[fx] ${options.pixelfxId} 没有产出 sheet（缺 ${png} 或 ${json}）`);
  }
  return { png, json };
}
