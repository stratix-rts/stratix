/**
 * 单测：**生产代码路由特效源**的装配（app/fx/code-fx-sources.ts）。
 *
 * 覆盖（task_194 / AP-04 验收标准 ② 的「效果缺失 ⇒ 静默回落」前置）：
 *   ① 真实的 pixelfx 效果模块能装成 world 层认的特效源（尺寸 / 原点 / 时长 / 调色板槽位）；
 *   ② 装出来的源**过得了护栏**（画布面积 ≤ 生产档上限）—— 装上了也要能播；
 *   ③ 效果加载失败 ⇒ 那个 kind **静默**没有源（⇒ 战场自动回落 sheet 路由），**不抛异常**；
 *   ④ 一个失败不影响其它效果（逐个 try/catch）。
 *
 * 依赖：真实 pixelfx 源码（vendor 进仓，jest 里已按 vite 同一套别名映射）——
 *   why 不 mock：mock 出来的"加载成功"证明不了真实模块能被装成特效源。
 *
 * @since v3.3（task_194 / AP-04）
 */

import { CODE_FX_METRICS } from '../../core/theme/visual-spec';
import {
  PRODUCTION_CODE_FX_SPECS,
  loadProductionCodeFxSources,
  type CodeFxSourceSpec,
} from '../fx/code-fx-sources';

describe('生产代码路由特效源：装配', () => {
  test('真实的 heal-aoe 装成特效源（尺寸 / 原点 / 时长 / 缩放 / 调色板槽位都对得上）', async () => {
    const sources = await loadProductionCodeFxSources();

    expect(sources).toHaveLength(1);
    const heal = sources[0];
    expect(heal.kind).toBe('heal');
    // 与 pixelfx 的 holy/heal-aoe 的 meta 一致（256×136，原点落在光环中心偏下）。
    expect(heal.width).toBe(256);
    expect(heal.height).toBe(136);
    expect(heal.originX).toBe(128);
    expect(heal.originY).toBe(104);
    expect(heal.durationMs).toBe(2900);
    expect(heal.loop).toBe(false);
    // 与同名 sheet 同 scale ⇒ 代码路由与回落路由（sheet）长相一致（"不少演"）。
    expect(heal.scale).toBe(0.4);
    expect(heal.paletteRoles).toHaveLength(8);
  });

  test('装出来的源过得了护栏（画布面积 ≤ 生产档上限 ⇒ 真能上屏）', async () => {
    const [heal] = await loadProductionCodeFxSources();

    expect(heal.width * heal.height).toBeLessThanOrEqual(CODE_FX_METRICS.maxCanvasAreaPx);
  });

  test('生产清单只列 runtime-only 效果（通用演出不在里头）', () => {
    const kinds = PRODUCTION_CODE_FX_SPECS.map((spec) => spec.kind);

    expect(kinds).toContain('heal');
    for (const general of ['celebrate', 'spawn', 'despawn', 'error', 'command']) {
      expect(kinds).not.toContain(general);
    }
  });
});

describe('生产代码路由特效源：静默降级（加载失败 ⇒ 该 kind 没有源 ⇒ 回落 sheet）', () => {
  test('加载失败 → 空清单，**不抛异常**', async () => {
    const failing: CodeFxSourceSpec[] = [
      {
        kind: 'heal',
        scale: 0.4,
        paletteRoles: ['success'],
        load: () => Promise.reject(new Error('chunk 没打出来')),
      },
    ];

    let sources: Awaited<ReturnType<typeof loadProductionCodeFxSources>> | null = null;
    await expect(
      (async () => {
        sources = await loadProductionCodeFxSources(failing);
      })(),
    ).resolves.toBeUndefined();

    expect(sources).toEqual([]);
  });

  test('模块形状不对（不是 pixelfx 效果）→ 同样静默跳过', async () => {
    const broken: CodeFxSourceSpec[] = [
      {
        kind: 'heal',
        scale: 0.4,
        paletteRoles: ['success'],
        load: () => Promise.resolve({ notAnEffect: true }),
      },
    ];

    await expect(loadProductionCodeFxSources(broken)).resolves.toEqual([]);
  });

  test('一个失败不影响其它效果（逐个 try/catch）', async () => {
    const specs: CodeFxSourceSpec[] = [
      {
        kind: 'broken',
        scale: 0.4,
        paletteRoles: ['success'],
        load: () => Promise.reject(new Error('炸了')),
      },
      ...PRODUCTION_CODE_FX_SPECS,
    ];

    const sources = await loadProductionCodeFxSources(specs);

    expect(sources).toHaveLength(1);
    expect(sources[0].kind).toBe('heal');
  });
});
