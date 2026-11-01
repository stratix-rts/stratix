/**
 * 单测：**品牌 agent 默认形象库**（src/world/appearance/brand-presets.ts）。
 *
 * 覆盖四件事：
 *   1. 全量性 —— DETECTABLE_AGENT_KINDS 的 12 种 kind 每个都有预设（漏一个 = 有 agent 掉兜底）；
 *   2. 有效性 —— 每个预设引用的 itemId + variant **逐一**存在于真实素材元数据
 *      （加载 dist/frontend/spritesheets/item-metadata.json，1.4MB 直接加载可接受，
 *      见 task_031 需求 4；素材改名会被测出来）；
 *   3. 可解析性 —— 预设经 PartRegistry.resolveSelections 逐类别**精确命中**
 *      （itemId 属于该类别、变体真实存在，不触发任何回落路径）；
 *   4. 确定性与体面 —— getBrandPreset 同输入同输出（无随机）、未知 kind 走中性兜底、
 *      全部素材避开"不体面"黑名单（伤口/轮椅/绷带/僵尸/骷髅/兽毛/独眼…）。
 *
 * 与其它 appearance 单测的区别：那些用**手写小夹具**锁规则，本测试**读真文件**锁数据 ——
 *   品牌预设的价值就在"挑了真实素材里的具体条目"，用手写夹具等于测了个寂寞。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { DETECTABLE_AGENT_KINDS, type CharacterAppearance } from '../../../core/types';
import { BRAND_PRESETS, COMMONER_FALLBACK_PRESET, getBrandPreset } from '../brand-presets';
import { PartRegistry } from '../part-registry';

/** 真实素材元数据（构建产物里的那份，与渲染侧 fetch 到的是同一份内容）。 */
const METADATA_PATH = path.resolve(
  __dirname,
  '../../../../dist/frontend/spritesheets/item-metadata.json'
);

// 解析成 PartRegistry 一次，全部断言复用（parseMetadata 是纯逻辑，不需要 fetch）。
const registry = new PartRegistry();
registry.parseMetadata(JSON.parse(fs.readFileSync(METADATA_PATH, 'utf-8')));

/** 所有要校验的预设（品牌库 + 兜底）。 */
const ALL_PRESETS: ReadonlyArray<readonly [string, CharacterAppearance]> = [
  ...DETECTABLE_AGENT_KINDS.map((kind) => [kind, BRAND_PRESETS[kind]] as const),
  ['<fallback>', COMMONER_FALLBACK_PRESET] as const,
];

// ============================================================================
// 1. 全量性
// ============================================================================

describe('品牌预设库 · 全量性', () => {
  test('DETECTABLE_AGENT_KINDS 的每种 kind 都有具名预设', () => {
    expect(Object.keys(BRAND_PRESETS).sort()).toEqual([...DETECTABLE_AGENT_KINDS].sort());
  });

  test('T1 各家（claude-code/codex/opencode/kimi/openclaw/dsh）各有独立预设且互不相同', () => {
    const t1 = ['claude-code', 'codex', 'opencode', 'kimi', 'openclaw', 'dsh'] as const;
    const seen = new Set<string>();
    for (const kind of t1) {
      const preset = BRAND_PRESETS[kind];
      expect(preset).toBeDefined();
      const key = JSON.stringify(preset);
      expect(seen.has(key)).toBe(false); // T1 预设两两不同（品牌辨识度的底线）
      seen.add(key);
    }
  });
});

// ============================================================================
// 2. 有效性（itemId + variant 真实存在 + 体型支持）
// ============================================================================

describe('品牌预设库 · 素材有效性（真元数据）', () => {
  test.each(ALL_PRESETS)('%s：每个部位的 itemId 存在、variant 在其变体清单内、支持该体型', (_label, preset) => {
    expect(Object.keys(preset.parts).length).toBeGreaterThan(0);
    for (const [category, value] of Object.entries(preset.parts)) {
      expect(typeof value).toBe('object'); // 品牌预设一律是精确形态（带 itemId）
      const { variant, itemId } = value as { variant: string; itemId?: string };
      expect(itemId).toBeDefined();

      const meta = registry.getPart(itemId as string);
      expect(meta).not.toBeNull(); // itemId 必须真实存在
      expect(meta!.variants).toContain(variant); // variant 必须在该素材的变体清单里
      expect(meta!.required).toContain(preset.bodyType); // 该体型必须有图，否则画不出来
      expect(category).toBeTruthy();
    }
  });

  test.each(ALL_PRESETS)('%s：部位键都是已知代码类别', (_label, preset) => {
    for (const category of Object.keys(preset.parts)) {
      expect(registry.getPartsByCategory(category).length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// 3. 可解析性（resolveSelections 精确命中，不触发回落）
// ============================================================================

describe('品牌预设库 · 渲染侧可解析', () => {
  test.each(ALL_PRESETS)('%s：resolveSelections 逐类别精确命中指定素材', (_label, preset) => {
    const selections = registry.resolveSelections(preset);
    expect(Object.keys(selections).length).toBe(Object.keys(preset.parts).length); // 一个都不许丢
    for (const [category, value] of Object.entries(preset.parts)) {
      const { variant, itemId } = value as { variant: string; itemId?: string };
      // 精确命中 = 解析结果与预设完全一致（没走"第一个命中项"顶替、也没换变体兜底）
      expect(selections[category]).toEqual({ itemId, variant });
    }
  });
});

// ============================================================================
// 4. 确定性与体面
// ============================================================================

describe('品牌预设库 · 兜底与体面', () => {
  test('getBrandPreset 对词表内 kind 返回品牌预设（与库内同一份数据）', () => {
    for (const kind of DETECTABLE_AGENT_KINDS) {
      expect(getBrandPreset(kind)).toBe(BRAND_PRESETS[kind]);
    }
  });

  test('未知 kind 走中性平民兜底，且确定性（重复调用同结果）', () => {
    const first = getBrandPreset('not-a-real-agent');
    expect(first).toBe(COMMONER_FALLBACK_PRESET);
    expect(getBrandPreset('another-unknown')).toBe(first); // 未知 kind 都同一份
    expect(getBrandPreset('not-a-real-agent')).toBe(first); // 无随机：同输入同输出
  });

  test('兜底不是空壳（有身体/头/衣裤鞋，能画出一个体面的人）', () => {
    const categories = Object.keys(COMMONER_FALLBACK_PRESET.parts);
    for (const must of ['body', 'head', 'hair', 'torso', 'legs', 'feet']) {
      expect(categories).toContain(must);
    }
  });

  test.each(ALL_PRESETS)('%s：不使用不体面素材（伤口/轮椅/绷带/僵尸/骷髅/兽毛/独眼…）', (_label, preset) => {
    const indecentToken = /wound|wheelchair|bandage|zombie|skeleton|cyclops|prosthesis|fur_|frankenstein|vampire/;
    for (const value of Object.values(preset.parts)) {
      const { variant, itemId } = value as { variant: string; itemId?: string };
      expect(`${itemId ?? ''}|${variant}`).not.toMatch(indecentToken);
    }
  });
});
