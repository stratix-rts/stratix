/**
 * 文件职责：**发布期特效烘焙**（task_192 / AP-02）的单测 ——
 *   ① 变体计划（皮肤闭集 × 效果 × seed 变体）与命名规则；
 *   ② 烘焙产物的**确定性断言**（同输入两次烘焙，逐字节一致 —— DESIGN §1.2 约束1）；
 *   ③ 「产物不入库」闸门（产物目录落在 assets/ 里直接报错）。
 *
 * why ② 走真烘焙（而不是只测哈希函数）：确定性是**渲染链**的性质 —— 参数没钉死、
 *   调色板取到不同值、上游渲染器改动，都会让同输入产出不同图。
 *   只测一个纯函数等于没测。这里只烘一个最轻的效果（despawn，33 帧），
 *   两次烘焙约 3 秒，断言却覆盖了整条链路。
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  FX_BAKE_MANIFEST_NAME,
  FX_BAKE_SEED_STRIDE,
  FX_BAKE_SEED_VARIANTS,
  FX_BAKE_SKINS,
  assertBakeOutDir,
  bakeFxRelease,
  planFxBakeVariants,
} from '../../scripts/lib/fx-release-bake';

/** 仓库根（测试在 tests/asset-pipeline/ 下）。 */
const ROOT = path.resolve(__dirname, '..', '..');

/** 列出一个目录下的全部文件（相对路径 → sha256）。 */
function hashTree(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        files.set(
          path.relative(dir, full).split(path.sep).join('/'),
          createHash('sha256').update(fs.readFileSync(full)).digest('hex'),
        );
      }
    }
  };
  walk(dir);
  return files;
}

describe('发布期特效烘焙（task_192 / AP-02）', () => {
  describe('变体计划', () => {
    it('皮肤闭集 = modern(default) / pixel 两套', () => {
      expect(FX_BAKE_SKINS).toEqual(['default', 'pixel']);
    });

    it('计划 = 皮肤 × 效果 × seed 变体，顺序固定', () => {
      const plans = planFxBakeVariants();
      expect(plans).toHaveLength(FX_BAKE_SKINS.length * 6 * FX_BAKE_SEED_VARIANTS);
      // 顺序固定 = 皮肤 → 效果 → 变体（manifest 逐字节可比的前提）。
      expect(plans.map((plan) => `${plan.skin}/${plan.kind}/${plan.variantId}`)).toEqual(
        expect.arrayContaining([
          'default/celebrate/base',
          'default/celebrate/s1',
          'pixel/despawn/s1',
        ]),
      );
      const first = plans[0];
      const second = plans[1];
      expect(first?.skin).toBe('default');
      expect(second?.variantIndex).toBe(1);
    });

    it('基础变体沿用运行时索引的文件名（<kind>.png），变体带 __sN 后缀', () => {
      const plans = planFxBakeVariants({ skins: ['default'], kinds: ['celebrate'] });
      expect(plans.map((plan) => plan.fileBase)).toEqual(['celebrate', 'celebrate__s1']);
    });

    it('seed 钉死：变体 seed = 基础 seed + 变体序号 × 固定步长', () => {
      const plans = planFxBakeVariants({ skins: ['default'], kinds: ['celebrate'] });
      const base = plans[0];
      const variant = plans[1];
      expect(base?.seed).toBe(11);
      expect(variant?.seed).toBe((base?.seed ?? 0) + FX_BAKE_SEED_STRIDE);
      // 两次调用同参数 → 同计划（计划本身也必须是确定性的）。
      expect(planFxBakeVariants({ skins: ['default'], kinds: ['celebrate'] })).toEqual(plans);
    });
  });

  describe('确定性（DESIGN §1.2 约束1）', () => {
    it('同输入两次烘焙，产物与 manifest 逐字节一致', () => {
      const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-fx-test-a-'));
      const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-fx-test-b-'));
      try {
        const options = {
          rootDir: ROOT,
          skins: ['default'] as const,
          seedVariants: 2,
          kinds: ['despawn'] as const,
        };
        const manifestA = bakeFxRelease({ ...options, outDir: dirA });
        const manifestB = bakeFxRelease({ ...options, outDir: dirB });

        // 1) 产物树逐文件一致（sha256）。
        expect([...hashTree(dirA).entries()].sort()).toEqual([...hashTree(dirB).entries()].sort());
        // 2) manifest 逐字节一致（故 manifest 里不能有时间戳 / 绝对路径）。
        expect(fs.readFileSync(path.join(dirA, FX_BAKE_MANIFEST_NAME), 'utf8')).toBe(
          fs.readFileSync(path.join(dirB, FX_BAKE_MANIFEST_NAME), 'utf8'),
        );
        // 3) 基础变体落在运行时索引对得上的路径上（<skin>/<kind>.png）。
        expect(manifestA.artifacts.map((item) => item.png)).toEqual([
          'default/despawn.png',
          'default/despawn__s1.png',
        ]);
        expect(manifestA.artifacts[0]?.pngSha256).toBe(manifestB.artifacts[0]?.pngSha256);
      } finally {
        fs.rmSync(dirA, { recursive: true, force: true });
        fs.rmSync(dirB, { recursive: true, force: true });
      }
    });
  });

  describe('「产物不入库」闸门', () => {
    it('产物目录落在 assets/（入库资产目录）里 → 报错', () => {
      expect(() => assertBakeOutDir(ROOT, path.join(ROOT, 'assets', 'fx'))).toThrow(/入库资产目录/);
      expect(() => assertBakeOutDir(ROOT, path.join(ROOT, 'assets'))).toThrow(/入库资产目录/);
    });

    it('产物目录落在构建产物目录里 → 放行', () => {
      expect(() =>
        assertBakeOutDir(ROOT, path.join(ROOT, 'dist', 'frontend', 'fx')),
      ).not.toThrow();
    });
  });
});
