/**
 * 文件职责：LPC 角色合成栈的**常量层** —— 精灵表几何、动画行偏移、部位类别、图层 z 序。
 *   来源：git 历史 a9498ae~1:src/stratix-character-creator/constants.ts（随 legacy 退役后复活）。
 *   任务：.long-run-agent/tasks/task_027.md「world: 复活 LPC 角色合成器」。
 * 输入：无（纯常量）。
 * 输出：合成器 / 注册表 / 部位配置共用的常量。
 * 禁止事项：
 *   1. 放业务逻辑 —— 本文件只有常量与常量表；
 *   2. 引入 DOM / Phaser / core 之外的东西 —— 纯零依赖模块，node 环境下可直接单测；
 *   3. 再写一份体型词表 —— 体型词表的事实源在 core/types.ts（APPEARANCE_BODY_TYPES），
 *      本文件只做转出，避免 core 与 world 各留一份（两份真相必漂移）。
 *
 * ★ 素材与路径（读这份文件前先看这段）：
 *   LPC 素材**不挪动、不复制**：真源在 `assets/spritesheets/`（1.3G，.gitignore 排除），
 *   由 vite `publicDir: 'assets'` 提供静态服务：
 *     - dev server：http://127.0.0.1:7523/spritesheets/**（publicDir 挂在站点根）；
 *     - 构建产物：publicDir 被拷进 outDir，即 `dist/frontend/spritesheets/**`（与真源同构）。
 *   故 `SPRITESHEET_BASE_PATH = '/spritesheets'` 对 **http(s) 部署**开箱即用。
 *   但 electron 正式包用 `file://` 加载 `dist/frontend/index.html`，
 *   此时绝对路径 `/spritesheets` 会被解析到文件系统根 —— 必须改用相对基址。
 *   相对基址的算法见 spritesheet-path.ts，绑定见 src/app/services/appearance-environment.ts。
 */

import { APPEARANCE_BODY_TYPES, type AppearanceBodyType } from '../../core/types';

/** 单帧尺寸（LPC 精灵表一格 64×64）。 */
export const FRAME_SIZE = 64;

/** LPC 精灵表宽度（13 列 × 64）。 */
export const SHEET_WIDTH = 832;

/** LPC 精灵表高度（54 行 × 64）。 */
export const SHEET_HEIGHT = 3456;

/** 每行帧数（13 列）。 */
export const FRAMES_PER_ROW = 13;

/** 方向数（上下左右 4 行）。 */
export const DIRECTIONS = 4;

/**
 * LPC 精灵表方向行号（行内偏移 = 行号 × FRAME_SIZE）。
 * ↓(下)=2 · ←(左)=1 · ↑(上)=0 · →(右)=3。
 */
export const LPC_DIRECTION_ROWS = {
  UP: 0,
  LEFT: 1,
  DOWN: 2,
  RIGHT: 3,
} as const;

/** 体型词表（转出 core 的事实源，见文件头「禁止事项 3」）。 */
export const BODY_TYPES = APPEARANCE_BODY_TYPES;

/** 体型类型（= core 的 AppearanceBodyType）。 */
export type BodyType = AppearanceBodyType;

/**
 * 动画 → 在精灵表中的行偏移（像素）。
 * 每个动画占 4 行（上下左右各一行），行内偏移 = 行号 × FRAME_SIZE。
 */
export const ANIMATION_OFFSETS: Record<string, number> = {
  spellcast: 0,
  thrust: 4 * FRAME_SIZE,
  walk: 8 * FRAME_SIZE,
  slash: 12 * FRAME_SIZE,
  shoot: 16 * FRAME_SIZE,
  hurt: 20 * FRAME_SIZE,
  climb: 21 * FRAME_SIZE,
  idle: 22 * FRAME_SIZE,
  jump: 26 * FRAME_SIZE,
  sit: 30 * FRAME_SIZE,
  emote: 34 * FRAME_SIZE,
  run: 38 * FRAME_SIZE,
  combat_idle: 42 * FRAME_SIZE,
  backslash: 46 * FRAME_SIZE,
  halfslash: 50 * FRAME_SIZE,
};

/**
 * 动画 → 帧参数（起始行 / 帧数 / 播放循环序列）。
 * why 要循环序列：LPC 的 idle 只有 3 帧但有 15 帧的循环表，
 * 照抄播放序列才不会"脚步乱跳"。
 */
export const ANIMATION_CONFIGS: Record<string, { row: number; num: number; cycle: number[] }> = {
  spellcast: { row: 0, num: 4, cycle: [0, 1, 2, 3, 4, 5, 6] },
  thrust: { row: 4, num: 4, cycle: [0, 1, 2, 3, 4, 5, 6, 7] },
  walk: { row: 8, num: 4, cycle: [1, 2, 3, 4, 5, 6, 7, 8] },
  slash: { row: 12, num: 4, cycle: [0, 1, 2, 3, 4, 5] },
  shoot: { row: 16, num: 4, cycle: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  hurt: { row: 20, num: 1, cycle: [0, 1, 2, 3, 4, 5] },
  climb: { row: 21, num: 1, cycle: [0, 1, 2, 3, 4, 5] },
  idle: { row: 22, num: 4, cycle: [0, 0, 1] },
  jump: { row: 26, num: 4, cycle: [0, 1, 2, 3, 4, 1] },
  sit: { row: 30, num: 4, cycle: [0] },
  emote: { row: 34, num: 4, cycle: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2] },
  run: { row: 38, num: 4, cycle: [0, 1, 2, 3, 4, 5, 6, 7] },
  combat_idle: { row: 42, num: 4, cycle: [0, 0, 1] },
  backslash: { row: 46, num: 4, cycle: [0, 1, 2, 3, 4, 5, 6] },
  halfslash: { row: 50, num: 4, cycle: [0, 1, 2, 3, 4, 5] },
};

/**
 * 动画别名映射：代码里的动画名 → LPC 素材里的动画名。
 * why 需要：素材里叫 `combat` / `1h_slash` / `magic`，代码里叫 `combat_idle` / `slash` / `spellcast`。
 * 注册表与合成器共用这一张表（两边各写一份必然对不齐）。
 */
export const ANIM_ALIASES: Record<string, string[]> = {
  combat_idle: ['combat', 'idle'],
  backslash: ['1h_slash', '1h_backslash', 'slash', 'slash_oversize', 'slash_reverse_oversize'],
  halfslash: ['1h_halfslash', 'slash', 'slash_oversize'],
  slash: ['slash', 'slash_oversize', 'slash_reverse_oversize', '1h_slash'],
  thrust: ['thrust', 'thrust_oversize'],
  shoot: ['shoot', 'bow'],
  spellcast: ['spellcast', 'magic'],
  walk: ['walk'],
  run: ['run', 'walk'],
  idle: ['idle'],
  hurt: ['hurt'],
};

/** 部位类别词表（代码侧的类别名，与素材的 typeName 通过别名表互相映射）。 */
export const PART_CATEGORIES = [
  'shadow',
  'body',
  'head',
  'eyes',
  'hair',
  'ears',
  'nose',
  'facial',
  'torso',
  'arms',
  'hands',
  'legs',
  'feet',
  'cape',
  'backpack',
  'neck',
  'shoulders',
  'wrists',
  'shield',
  'weapon',
  'hat',
  'quiver',
] as const;

/** 部位类别类型。 */
export type PartCategory = (typeof PART_CATEGORIES)[number];

/**
 * 部位类别 → 绘制层级（z 序，小的先画 = 在下面）。
 * why 需要：LPC 的一个"身体"由多层素材叠成（阴影 → 身体 → 衣服 → 头发 → 帽子），
 * 顺序错了会穿模（头发盖在帽子里）。
 */
export const LAYER_Z_POSITIONS: Record<string, number> = {
  shadow: 0,
  body: 10,
  legs: 20,
  feet: 25,
  torso: 40,
  dress: 45,
  arms: 50,
  armor: 60,
  cape: 70,
  head: 80,
  hair: 85,
  hat: 90,
  ears: 82,
  eyes: 83,
  nose: 84,
  facial: 86,
  neck: 87,
  shoulders: 88,
  wrists: 89,
  hands: 91,
  backpack: 92,
  shield: 95,
  weapon: 100,
  quiver: 96,
};

/** 默认体型。 */
export const DEFAULT_BODY_TYPE: BodyType = 'male';

/** 默认动画。 */
export const DEFAULT_ANIMATION = 'walk';

/** 默认方向（朝下 = LPC 行号 2）。 */
export const DEFAULT_DIRECTION = 2;

/**
 * 素材根路径（http(s) 部署下的站点绝对路径）。
 * why 是这个值：vite `publicDir: 'assets'` → `assets/spritesheets/` 挂在站点根的 `/spritesheets`；
 * 构建时 publicDir 原样拷进 `dist/frontend/`（即 `dist/frontend/spritesheets/`），两边同构。
 * file:// 场景（electron 正式包）不能用它 —— 见 spritesheet-path.ts。
 */
export const SPRITESHEET_BASE_PATH = '/spritesheets';

/** 缩略图默认边长（像素）。 */
export const THUMBNAIL_SIZE = 128;
