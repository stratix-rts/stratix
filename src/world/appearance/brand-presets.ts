/**
 * 文件职责：**品牌 agent 默认形象库** —— 每个可检出的本地 CLI agent 一份固定品牌预设
 *   （DetectableAgentKind → CharacterAppearance），替代纯随机 —— 消除随机不确定性，
 *   同时让各 agent 在战场上一眼可辨。用户可后续在形象编辑器里改（预设只是"出厂默认"）。
 *   任务：.long-run-agent/tasks/task_031.md。
 * 输入：无（纯静态数据 + 纯查表函数）。素材事实来源：dist/frontend/spritesheets/item-metadata.json
 *   —— 本文件里每个 itemId + variant 都是**从元数据里实挑的**（单测逐一断言存在，
 *   见 __tests__/brand-presets.test.ts；素材改名会被测出来，不许手滑编造）。
 * 输出：BRAND_PRESETS（12 种 kind 全量预设）/ COMMONER_FALLBACK_PRESET（未知 kind 的中性
 *   平民兜底）/ getBrandPreset(kind)（查表 + 兜底，**确定性** —— 同一 kind 永远同一份）。
 * 禁止事项：
 *   1. 在 getBrandPreset 里调随机 —— 品牌预设的存在意义就是"确定性"，兜底也用静态
 *      中性平民预设（等价于 appearance-randomizer minimal 档的一次生成结果被冻结），
 *      要随机长相请走 randomizeAppearance；
 *   2. 引用元数据里不存在的 itemId / variant —— 编造 = 渲染侧拼出不存在的图片路径；
 *   3. 用"不体面"素材（伤口 / 轮椅 / 绷带 / 僵尸 / 骷髅 / 兽毛 / 独眼……）——
 *      品牌形象要体面，怪素材留给全随机档（单测有黑名单断言）；
 *   4. import app / hud —— 本模块属 world 层，只认 core 的类型；
 *   5. 引入新依赖 —— 零依赖纯数据模块。
 *
 * ★ 配色口径（与 task_031 需求一一对应；变体名全部实挑自元数据）：
 *   - claude-code（Anthropic）：暖橙/赤陶/米白/暖棕发 —— 沉稳学者（赤陶开衫 + 栗棕分发）；
 *   - kimi（月之暗面 Moonshot）：黑/深蓝/月光银 —— 夜行风（乌黑长发 + 深蓝长衫 + 黑靴）；
 *   - opencode：紫色系终端黑客（紫色刺猬头 + 紫瞳 + 紫 T 恤）；
 *   - openclaw：橙色利落（爪/猛禽感 —— 元数据无 claws 类素材，用"莫西干头 = 猛禽冠羽"
 *     + 尖尖的精灵耳 + 皮革甲表达利落感）；
 *   - codex（OpenAI）：冷绿/白/灰极简（灰色板寸 + 绿瞳 + 白衬衫 + 灰西裤）；
 *   - gemini：蓝色系（蓝刘海 + 蓝瞳 + 蓝衣）；
 *   - dsh（DeepSeek Harness）：深蓝/银白（蓝色短狼尾 + 蓝开衫 + 银靴）；
 *   - T2/T3 其余：中性色平民兜底（共用一套选配，仅发色按 kind 微调以便战场上区分）。
 */

import type {
  AppearancePartSelection,
  CharacterAppearance,
  DetectableAgentKind,
} from '../../core/types';

// ============================================================================
// 预设构造辅助（纯缩写，避免 12 份重复字面量）
// ============================================================================

/** 精确选择的缩写（品牌预设一律带 itemId —— 不带就退化回"第一个命中项"）。 */
function sel(variant: string, itemId: string): AppearancePartSelection {
  return { variant, itemId };
}

/**
 * 一套"人形基底"（阴影 + 肤色一致的 头/耳/鼻/眼）。
 * why 抽出来：品牌差异靠 发型发色/衣裤鞋/瞳色/肤色 表达，五官款式全库共用一套
 * （体面的普通人脸 —— ears 用 medium / nose 用 straight 是最不显怪的组合）。
 * 眼睛单独传：瞳色是品牌信号之一。
 */
function humanoidBase(
  skin: string,
  eyeColor: string
): Readonly<Record<string, AppearancePartSelection>> {
  return {
    shadow: sel('shadow', 'shadow'),
    body: sel(skin, 'body'),
    head: sel(skin, 'heads_human_male'),
    eyes: sel(eyeColor, 'eye_color'),
    ears: sel(skin, 'head_ears_medium'),
    nose: sel(skin, 'head_nose_straight'),
  };
}

// ============================================================================
// T1 品牌预设（具名 agent —— 战场辨识度的主战场）
// ============================================================================

/** claude-code（Anthropic）：赤陶开衫 + 栗棕分发 + 米棕长裤 —— 沉稳学者。 */
const CLAUDE_CODE_PRESET: CharacterAppearance = {
  bodyType: 'male',
  parts: {
    ...humanoidBase('amber', 'brown'),
    hair: sel('chestnut', 'hair_parted'),
    torso: sel('orange', 'torso_clothes_longsleeve2_cardigan'),
    legs: sel('tan', 'legs_pants'),
    feet: sel('brown', 'feet_shoes_revised'),
  },
};

/** kimi（月之暗面）：乌黑长直发 + 深蓝长衫 + 黑长裤黑靴 —— 夜行风。 */
const KIMI_PRESET: CharacterAppearance = {
  bodyType: 'male',
  parts: {
    ...humanoidBase('light', 'blue'),
    hair: sel('raven', 'hair_long_straight'),
    torso: sel('navy', 'torso_clothes_longsleeve'),
    legs: sel('black', 'legs_pants'),
    feet: sel('black', 'feet_boots_basic'),
  },
};

/** opencode：紫色刺猬头 + 紫瞳 + 紫 T 恤 + 炭色长裤 —— 终端黑客。 */
const OPENCODE_PRESET: CharacterAppearance = {
  bodyType: 'male',
  parts: {
    ...humanoidBase('taupe', 'purple'),
    hair: sel('purple', 'hair_spiked'),
    torso: sel('purple', 'torso_clothes_tshirt'),
    legs: sel('charcoal', 'legs_pants'),
    feet: sel('black', 'feet_shoes_basic'),
  },
};

/**
 * openclaw：橙色莫西干（猛禽冠羽）+ 精灵尖耳（利落）+ 橙色皮革甲 —— 爪感战士。
 * why 精灵耳替掉 humanoidBase 默认耳：尖耳更贴"猛禽/爪"的锋利感。
 */
const OPENCLAW_PRESET: CharacterAppearance = {
  bodyType: 'male',
  parts: {
    ...humanoidBase('amber', 'orange'),
    ears: sel('amber', 'head_ears_elven'),
    hair: sel('orange', 'hair_shorthawk'),
    torso: sel('orange', 'torso_armour_leather'),
    legs: sel('leather', 'legs_pants2'),
    feet: sel('brown', 'feet_boots_revised'),
  },
};

/** codex（OpenAI）：灰板寸 + 绿瞳 + 白衬衫 + 灰西裤 —— 冷感极简。 */
const CODEX_PRESET: CharacterAppearance = {
  bodyType: 'male',
  parts: {
    ...humanoidBase('light', 'green'),
    hair: sel('ash', 'hair_buzzcut'),
    torso: sel('white', 'torso_clothes_longsleeve_formal'),
    legs: sel('gray', 'legs_formal'),
    feet: sel('gray', 'feet_shoes_revised'),
  },
};

/**
 * dsh（DeepSeek Harness，@since v3.33 task_088）：蓝色短狼尾 + 蓝色开衫 + 银靴 —— 深蓝/银白。
 * why 蓝色：DeepSeek 的品牌色是深蓝（#4D6BFE 一系）；与 gemini（亮蓝刘海）靠**发型型与鞋**
 *   区分（dsh 短狼尾 + 银靴），避免两个蓝系在战场上撞脸。
 */
const DSH_PRESET: CharacterAppearance = {
  bodyType: 'male',
  parts: {
    ...humanoidBase('light', 'blue'),
    hair: sel('blue', 'hair_shorthawk'),
    torso: sel('blue', 'torso_clothes_longsleeve2_cardigan'),
    legs: sel('navy', 'legs_pants'),
    feet: sel('silver', 'feet_boots_basic'),
  },
};

// ============================================================================
// T2 品牌预设（gemini 有明确配色方向；其余 T2/T3 共用平民选配、仅发色区分）
// ============================================================================

/** gemini：蓝色刘海 + 蓝瞳 + 蓝衣深蓝裤 —— 蓝系。 */
const GEMINI_PRESET: CharacterAppearance = {
  bodyType: 'male',
  parts: {
    ...humanoidBase('light', 'blue'),
    hair: sel('blue', 'hair_swoop'),
    torso: sel('blue', 'torso_clothes_longsleeve'),
    legs: sel('navy', 'legs_pants'),
    feet: sel('blue', 'feet_shoes_basic'),
  },
};

/** 中性平民选配（灰 T + 棕裤棕鞋 + 普通短发 hair_plain），发色按 kind 微调 ——
 * T2/T3 未给品牌方向的 agent（qwen/crush/goose/aider/copilot）共用这套选配，
 * 战场上至少发色可辨。全部发色都是 hair_plain 真实存在的变体。
 */
function commoner(hairVariant: string): CharacterAppearance {
  return {
    bodyType: 'male',
    parts: {
      ...humanoidBase('light', 'brown'),
      hair: sel(hairVariant, 'hair_plain'),
      torso: sel('gray', 'torso_clothes_tshirt'),
      legs: sel('brown', 'legs_pants'),
      feet: sel('brown', 'feet_shoes_basic'),
    },
  };
}

// ============================================================================
// 预设库（12 种 kind 全量）
// ============================================================================

/**
 * 品牌 agent 默认形象库（key 与 agent-detector 的 DetectableAgentKind 一致）。
 * why 全量而不是只放 T1：检测器 T1-T3 都会注册进战场，漏一个就有一个 agent
 *   掉进兜底 —— 兜底该留给"词表外"的未知 kind，不该留给已知却忘写的。
 */
export const BRAND_PRESETS: Readonly<Record<DetectableAgentKind, CharacterAppearance>> = {
  // —— T1 ——
  'claude-code': CLAUDE_CODE_PRESET,
  codex: CODEX_PRESET,
  opencode: OPENCODE_PRESET,
  kimi: KIMI_PRESET,
  openclaw: OPENCLAW_PRESET,
  dsh: DSH_PRESET,
  // —— T2 ——
  gemini: GEMINI_PRESET,
  qwen: commoner('black'),
  crush: commoner('dark brown'),
  goose: commoner('gray'),
  // —— T3 ——
  aider: commoner('light brown'),
  copilot: commoner('chestnut'),
};

/**
 * 未知 kind 的中性平民兜底（确定性静态配置 —— 等价于 minimal 档随机一次后冻结）。
 * why 不在 getBrandPreset 里现场调随机：见文件头禁止事项 1。
 */
export const COMMONER_FALLBACK_PRESET: CharacterAppearance = commoner('dark brown');

// ============================================================================
// 查表入口
// ============================================================================

/**
 * 取某 agent 种类的品牌默认形象。
 *
 * @param kind agent 种类（检测器的 kind；词表外的任意字符串也接受 —— 走兜底）。
 * @returns 命中词表 → 对应品牌预设；未命中 → COMMONER_FALLBACK_PRESET。
 *   **确定性**：同一输入永远同一输出（无随机），调用方可以放心在渲染热路径上反复调。
 */
export function getBrandPreset(kind: string): CharacterAppearance {
  return BRAND_PRESETS[kind as DetectableAgentKind] ?? COMMONER_FALLBACK_PRESET;
}
