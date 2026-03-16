/**
 * CharacterCreator 常量定义
 * 基于 LPC (Liberated Pixel Cup) 精灵表格式
 */

export const FRAME_SIZE = 64;

export const SHEET_WIDTH = 832;
export const SHEET_HEIGHT = 3456;

export const FRAMES_PER_ROW = 13;
export const DIRECTIONS = 4;

/**
 * LPC Sprite Sheet 方向布局 (行号)
 * ↓ (下) = 2, ← (左) = 1, ↑ (上) = 0, → (右) = 3
 */
export const LPC_DIRECTION_ROWS = {
  UP: 0,
  LEFT: 1,
  DOWN: 2,
  RIGHT: 3
} as const;

/**
 * 角度 (度数) 直接转 LPC 行号
 * @param normalizedDegrees 已归一化的角度 (0-360)
 * @returns LPC 行号 (0=上, 1=左, 2=下, 3=右)
 */
export function angleToLPCRow(normalizedDegrees: number): number {
  // 0° = 右, 90° = 下, 180° = 左, 270° = 上
  if (normalizedDegrees >= 315 || normalizedDegrees < 45) return LPC_DIRECTION_ROWS.RIGHT;   // 右 → 3
  if (normalizedDegrees >= 45 && normalizedDegrees < 135) return LPC_DIRECTION_ROWS.DOWN;    // 下 → 2
  if (normalizedDegrees >= 135 && normalizedDegrees < 225) return LPC_DIRECTION_ROWS.LEFT;   // 左 → 1
  return LPC_DIRECTION_ROWS.UP;  // 上 → 0 (225°-315°)
}

/**
 * 逻辑方向到 LPC 行号的映射
 * 用于 CharacterPreview 等组件
 * 
 * CharacterCreatorScene 中的按钮布局:
 * const dirs = ['↓', '←', '↑', '→'];
 * const dirValues = [2, 1, 0, 3];  // 与 LPC 行号一致
 * 
 * 逻辑方向值 = LPC 行号:
 * 2 = ↓ (下)
 * 1 = ← (左)
 * 0 = ↑ (上)
 * 3 = → (右)
 * 
 * 由于按钮值已与 LPC 行号一致，此映射为 1:1
 */
export const LOGICAL_TO_LPC: Record<number, number> = {
  0: 0,  // ↑ 上
  1: 1,  // ← 左
  2: 2,  // ↓ 下
  3: 3,  // → 右
};

export type LogicalDirection = number;

export const BODY_TYPES = ['male', 'female', 'teen', 'muscular', 'pregnant'] as const;
export type BodyType = typeof BODY_TYPES[number];

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
  halfslash: 50 * FRAME_SIZE
};

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
  halfslash: { row: 50, num: 4, cycle: [0, 1, 2, 3, 4, 5] }
};

export const ANIMATION_NAMES = {
  SPELLCAST: 'spellcast',
  THRUST: 'thrust',
  WALK: 'walk',
  SLASH: 'slash',
  SHOOT: 'shoot',
  HURT: 'hurt',
  CLIMB: 'climb',
  IDLE: 'idle',
  JUMP: 'jump',
  SIT: 'sit',
  EMOTE: 'emote',
  RUN: 'run',
  COMBAT_IDLE: 'combat_idle',
  BACKSLASH: 'backslash',
  HALFSLASH: 'halfslash'
} as const;

export type AnimationName = typeof ANIMATION_NAMES[keyof typeof ANIMATION_NAMES];

export const ALL_ANIMATIONS: AnimationName[] = Object.values(ANIMATION_NAMES);

export const CORE_RTS_ANIMATIONS: AnimationName[] = [
  ANIMATION_NAMES.WALK,
  ANIMATION_NAMES.IDLE,
  ANIMATION_NAMES.RUN
];

export const COMBAT_ANIMATIONS: AnimationName[] = [
  ANIMATION_NAMES.SPELLCAST,
  ANIMATION_NAMES.THRUST,
  ANIMATION_NAMES.SLASH,
  ANIMATION_NAMES.SHOOT,
  ANIMATION_NAMES.BACKSLASH,
  ANIMATION_NAMES.HALFSLASH,
  ANIMATION_NAMES.COMBAT_IDLE
];

export const ANIMATION_FRAMERATES: Record<AnimationName, number> = {
  [ANIMATION_NAMES.SPELLCAST]: 8,
  [ANIMATION_NAMES.THRUST]: 8,
  [ANIMATION_NAMES.WALK]: 10,
  [ANIMATION_NAMES.SLASH]: 8,
  [ANIMATION_NAMES.SHOOT]: 10,
  [ANIMATION_NAMES.HURT]: 6,
  [ANIMATION_NAMES.CLIMB]: 8,
  [ANIMATION_NAMES.IDLE]: 3,
  [ANIMATION_NAMES.JUMP]: 8,
  [ANIMATION_NAMES.SIT]: 1,
  [ANIMATION_NAMES.EMOTE]: 6,
  [ANIMATION_NAMES.RUN]: 12,
  [ANIMATION_NAMES.COMBAT_IDLE]: 3,
  [ANIMATION_NAMES.BACKSLASH]: 8,
  [ANIMATION_NAMES.HALFSLASH]: 8
};

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
  'quiver'
] as const;

export type PartCategory = typeof PART_CATEGORIES[number];

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
  quiver: 96
};

export const DEFAULT_BODY_TYPE: BodyType = 'male';
export const DEFAULT_ANIMATION = 'walk';
export const DEFAULT_DIRECTION = 2;  // 默认朝下 (DOWN)

export const STORAGE_KEY = 'stratix_characters';
export const DB_NAME = 'stratix_character_creator';
export const DB_VERSION = 1;
export const STORE_NAME = 'characters';

export const SPRITESHEET_BASE_PATH = '/spritesheets';

export const THUMBNAIL_SIZE = 128;
export const PREVIEW_SCALE = 2;

export const EVENTS = {
  CHARACTER_CREATED: 'character:created',
  CHARACTER_UPDATED: 'character:updated',
  CHARACTER_DELETED: 'character:deleted',
  CHARACTER_SELECTED: 'character:selected',
  OPEN_CREATOR: 'character:open'
} as const;
