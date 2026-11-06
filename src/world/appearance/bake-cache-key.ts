/**
 * 文件职责：**角色烘焙缓存键** —— 「agent 标识 + 皮肤 + Composer 版本号」三要素（@since v3.3，task_195 / CP-01）。
 *   权威定义：docs/DESIGN-asset-pipelines.md §2.2 纪律 1。
 * 输入：角色 id + 角色外观（core 的 CharacterAppearance）+（可选）合成器版本号。
 * 输出：缓存键字符串 + 皮肤指纹。
 * 禁止事项：
 *   1. 碰 DOM / 文件系统 —— 本模块是**纯函数**（world 层零 DOM，也零 IO）；
 *   2. 把「皮肤」简化成几个字段 —— 皮肤 = 角色外观的**全部**信息（体型 + 每个部位的
 *      itemId 与变体）；少算一项 = 换个发型还吃旧缓存（画面上是上一个人的脸）。
 *   3. 引入 npm 依赖 —— 指纹用仓内自带的 32 位哈希（两路）拼成 16 位十六进制。
 *
 * ★ 为什么键要三要素齐：
 *   - **agent 标识**：缓存是「某个角色的那张整图」，不同角色各自一份（互不覆盖）。
 *   - **皮肤**：同一角色换肤 ⇒ 键变 ⇒ 旧图自动作废（不用手动清缓存）。
 *   - **Composer 版本号**：合成器逻辑或素材升级 ⇒ 键变 ⇒ 旧图自动作废
 *     （否则合成器的 bug 会被烤进缓存里永久存活 —— DESIGN §2.2 纪律 1 的原话）。
 */

import {
  appearancePartItemId,
  appearancePartVariant,
  type CharacterAppearance,
} from '../../core/types';

import { COMPOSER_VERSION } from './composer-version';

/**
 * 缓存键输入（三要素）。
 */
export interface CharacterBakeKeyInput {
  /** agent 标识（= 角色 id；角色在建档后才拿到，故建档/换肤两处触发都拿得到同一个值）。 */
  readonly agentId: string;
  /** 皮肤（= 角色外观：体型 + 部位选择）。 */
  readonly appearance: CharacterAppearance;
  /**
   * 合成器版本号（缺省 = 当前 COMPOSER_VERSION）。
   * why 留这个口子：单测要能注入另一个版本，验证「版本变 ⇒ 旧缓存失效」。
   */
  readonly composerVersion?: string;
}

/**
 * 外观的**规范化文本**（指纹的输入）。
 *
 * why 要规范化：同一份外观在 JSON 里的部位顺序可能不同（存档回读 / 随机化产出），
 *   直接对对象求哈希会得到不同的值 → 明明没换肤却重烘一遍。
 *   规范化 = 体型一行 + 各部位按**类别名排序**一行，于是「同样的长相」永远同一个串。
 */
export function appearanceCanonicalForm(appearance: CharacterAppearance): string {
  const lines: string[] = [`bodyType=${appearance.bodyType}`];
  for (const category of Object.keys(appearance.parts).sort()) {
    const value = appearance.parts[category];
    const itemId = appearancePartItemId(value) ?? '';
    const variant = appearancePartVariant(value);
    lines.push(`${category}=${itemId}:${variant}`);
  }
  return lines.join('\n');
}

/**
 * 皮肤指纹（16 位十六进制）。
 *
 * why 两路哈希：单个 32 位哈希在几千个外观规模下已有可观的碰撞概率，
 *   而碰撞的后果是「换了肤却吃到旧图」（画面上是上一个人的脸）——
 *   两路独立哈希拼一起，碰撞概率降到可以忽略，代价只是几行代码。
 */
export function appearanceFingerprint(appearance: CharacterAppearance): string {
  const canonical = appearanceCanonicalForm(appearance);
  return `${hex8(fnv1a(canonical))}${hex8(djb2(canonical))}`;
}

/**
 * 缓存键（三要素拼一个串）。
 *
 * 格式：`<agent 段>__<皮肤指纹>__<版本段>`（双下划线分隔，三段都不含下划线之外的歧义字符）。
 */
export function characterBakeKey(input: CharacterBakeKeyInput): string {
  const version = input.composerVersion ?? COMPOSER_VERSION;
  return [
    sanitizeKeySegment(input.agentId),
    appearanceFingerprint(input.appearance),
    sanitizeKeySegment(version),
  ].join('__');
}

/**
 * 键片段消毒：只留 `[A-Za-z0-9._-]`，其余（含路径分隔符）一律换成 `-`。
 *
 * why 必须做：agent id 与版本串会进**文件路径**（缓存目录下的 `<键>.png`），
 *   一个带 `../` 的 id 就等于把文件写到目录外面去。消毒是最后一道防线，
 *   主进程侧还会再校验一次（纵深防御）。
 */
export function sanitizeKeySegment(value: string): string {
  const cleaned = value
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    // 连续的点号（`..`）一并换掉：它能拼出目录层级（`../../etc`），主进程那道校验会直接拒收。
    .replace(/\.{2,}/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64);
  return cleaned.length > 0 ? cleaned : 'unknown';
}

/** FNV-1a 32 位哈希。 */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** djb2 32 位哈希（与 FNV-1a 独立的一路）。 */
function djb2(text: string): number {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = (Math.imul(hash, 33) + text.charCodeAt(index)) >>> 0;
  }
  return hash >>> 0;
}

/** 32 位哈希转 8 位十六进制（定长，便于做键与文件名）。 */
function hex8(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}
