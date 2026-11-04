/**
 * 文件职责：HUD 排版与信息层级的**字阶 / 间距 token 源**（@since v3.8，task_137）。
 *
 * 背景：v3.8 之前 HUD 的字号只有「装饰性」四档（--srf-font-size-xs/sm/md/lg = 11/12/14/16），
 *   组件各取各的 —— 同一个语义（标题 / 正文 / 辅助说明）在不同面板落在不同档上，
 *   于是「字号梯度不清、留白节奏随意」（用户评估 r1-r3 反复点）。
 *   本文件把排版从「随手取一档」变成**三级语义字阶 + 一套间距节奏**：
 *     标题（title） > 正文（body） > 辅助（caption）—— 全 HUD 只有这三档语义。
 *
 * 为什么是**独立一层**而不是塞进 tokens-*.css：
 *   1. 皮肤表（tokens-default / tokens-pixel…）的键集合必须**严格一致**
 *      （见 hud/theme/__tests__/skin-tokens.test.ts 的 CANONICAL_TOKENS 清单）——
 *      在那层加 token 要同时改 8 张表，而像素皮那张表正被 task_135 在途编辑；
 *   2. 字阶是**跨皮肤的排版契约**，颜色才随皮肤变 —— 拆成独立层后，
 *      「一套字阶、两套皮肤数值」这件事在文件结构上就是显式的。
 *
 * 输入：无（纯 CSS 字符串常量）。
 * 输出：TYPE_SCALE_CSS（现代皮字阶）/ PIXEL_TYPE_SCALE_CSS（像素皮字阶）/ TRUNCATE_CSS（截断规则）。
 * 禁止事项：
 *   1. 出现颜色值 —— 本层只管字号 / 行高 / 间距；
 *   2. 组件级选择器 —— TRUNCATE_CSS 只给一条通用工具类，组件样式仍归各组件；
 *   3. 引入依赖 —— 纯常量，jest / 打包器都能直接吃（不经 css transform）。
 *
 * ★ 像素皮为什么要「整体 +1px」（task_137 口径）：
 *   Fusion Pixel 是 12px 网格上设计的像素字体，14px 会落在网格的半格上（发虚）；
 *   整体 +1px 让三档字阶都落在整数格附近，像素字骨不发虚 —— 这是"像素网格对齐"的正解，
 *   不是"随便放大一点"。
 */

/** 语义字阶（三级）+ 语义间距节奏 —— 现代皮。 */
export const TYPE_SCALE_CSS = `
:root {
  /* —— 字阶：标题 / 正文 / 辅助（全 HUD 只有这三档语义）—— */
  --srf-font-size-title: 18px;
  --srf-font-size-body: 14px;
  --srf-font-size-caption: 12px;

  /* —— 行高：与字阶一一对应（比值法：标题紧、正文松、辅助居中）—— */
  --srf-line-height-title: 1.25;
  --srf-line-height-body: 1.5;
  --srf-line-height-caption: 1.4;

  /* —— 内容字号（@since v3.9，task_145）：**内容 ≠ 铬** ——
     agent / CLI 输出是「读」的，字号起步 md(14px)、行高 1.6；
     UI 铬（标签 / 按钮 / 角标）仍走 caption/body，与内容分级。 */
  --srf-font-size-content: 14px;
  --srf-line-height-content: 1.6;

  /* —— 间距节奏（4 的倍数；语义别名，组件按「关系」取用而不是按数字取用）——
     组内紧贴 4 / 元素之间 8 / 行间字段 12 / 区块内边距 16 / 区块之间 24 / 大留白 32 */
  --srf-space-tight: 4px;
  --srf-space-base: 8px;
  --srf-space-comfy: 12px;
  --srf-space-room: 16px;
  --srf-space-section: 24px;
  --srf-space-block: 32px;
}
`;

/** 语义字阶（三级）+ 语义间距节奏 —— 像素皮（字号整体 +1px，间距与皮肤表一致）。 */
export const PIXEL_TYPE_SCALE_CSS = `
:root {
  /* 像素风字阶：整体 +1px（Fusion Pixel 落在 12px 网格上，14px 会发虚）——
     间距节奏不变（像素网格的间距单位仍是 4px 整）。 */
  --srf-font-size-title: 19px;
  --srf-font-size-body: 15px;
  --srf-font-size-caption: 13px;

  --srf-line-height-title: 1.25;
  --srf-line-height-body: 1.5;
  --srf-line-height-caption: 1.4;

  /* 内容字号（task_145）：像素皮同样 +1px（正文 15px），行高节奏不变。 */
  --srf-font-size-content: 15px;
  --srf-line-height-content: 1.6;

  --srf-space-tight: 4px;
  --srf-space-base: 8px;
  --srf-space-comfy: 12px;
  --srf-space-room: 16px;
  --srf-space-section: 24px;
  --srf-space-block: 32px;
}
`;

/**
 * 像素皮肤 id —— 只有它用像素字阶（其余皮肤都是"现代排版 + 换色板"）。
 * why 判定放在这一层而不是主题控制器里：字阶是排版事实，皮肤 id 是皮肤事实，
 *   两者的映射只此一处。
 */
const PIXEL_SKIN_ID = 'pixel';

/**
 * 取某套皮肤该用的字阶层。
 * @param skinId 皮肤 id（默认皮 / 像素皮 / 其余换色板皮肤）。
 * @returns 该皮肤的 `:root` 字阶 CSS（拼在皮肤 token 表之后注入）。
 */
export function typeScaleCssFor(skinId: string): string {
  return skinId === PIXEL_SKIN_ID ? PIXEL_TYPE_SCALE_CSS : TYPE_SCALE_CSS;
}

/**
 * 长文本截断规则（单行 ellipsis）—— 各表面样式表共用同一份文案。
 *
 * why 要「共用同一份」而不是各组件各写一遍：
 *   截断是**信息层级的一部分**（长文本不许把布局撑破），一旦各家自己写，
 *   就会出现"有的单行有的两行、有的省略号有的直接截断"的不一致 —— 那正是本次要消灭的东西。
 *
 * 配套纪律（各表面自行遵守）：凡是走 .truncate 的元素，**必须**同时给 title 属性，
 *   让被省略的内容仍可读（悬停可见）。CSS 只管省略号，完整文本由 DOM 提供。
 */
export const TRUNCATE_CSS = `
.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* min-width: 0 —— flex / grid 子项默认 min-width:auto，长文本会顶破容器；
     截断生效的前提是子项允许收缩。 */
  min-width: 0;
}
`;
