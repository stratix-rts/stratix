/**
 * 文件职责：**dev 态 fx 清单**（@since v3.3，task_211 / AP-05）的单测 ——
 *   dev 的清单（仓内快照派生）必须与发布期 manifest **同构**、**如实反映磁盘**、
 *   并且能被**运行时那一套消费代码**直接吃（消费代码不感知 dev/release）。
 *
 * ★ 为什么这几条断言重要：
 *   ① 「同构」：字段口径一旦漂，dev 好好的、release 解析不出来 —— 只在发布当天现形；
 *   ② 「如实反映磁盘」：清单说有、文件才在 —— 反过来也成立（图在却不列 = 运行时永远拿不到那张图）；
 *   ③ 「消费代码能直接吃」：这是 AP-05 的核心诉求（CodeFxLayer / fx-variants 不感知模式），
 *      所以这里真的 import 运行时的解析器来喂，而不是自己复刻一份解析逻辑。
 *
 * 禁止事项：
 *   1. 拿 mock 清单当对比对象 —— 派生自**真实的**仓内快照（assets/fx/）；
 *   2. 为了让测试变绿而放宽容差 —— 路径对不上就是对不上，没有中间态。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { SPRITE_FX_SOURCES } from '../../src/world/appearance/fx-sources.generated';
import {
  SPRITE_FX_RUNTIME_SKIN,
  spriteFxVariantsFromManifest,
} from '../../src/world/appearance/fx-variants';
import {
  FX_BAKE_MANIFEST_NAME,
  FX_BAKE_MANIFEST_VERSION,
  FX_BAKE_PARAM_PLAN,
  FX_BAKE_SEED_STRIDE,
} from '../../scripts/lib/fx-release-bake';
import { buildFxSnapshotManifest } from '../../scripts/lib/fx-snapshot-manifest';

/** 仓库根（测试在 tests/asset-pipeline/ 下）。 */
const ROOT = path.resolve(__dirname, '..', '..');

/** 快照根（= vite publicDir 挂站点根 /fx/ 的那一份）。 */
const SNAPSHOT_ROOT = path.join(ROOT, 'assets', 'fx');

describe('dev 态 fx 清单（task_211 / AP-05）', () => {
  const manifest = buildFxSnapshotManifest({ rootDir: ROOT, assetsRoot: SNAPSHOT_ROOT });

  it('是真 JSON（能被 JSON.parse 吃下）—— 不是 index.html', () => {
    const text = JSON.stringify(manifest, null, 2);
    expect(() => JSON.parse(text)).not.toThrow();
    // dev server 的清单文件名与发布期一致（运行时按同一个名字去取）。
    expect(FX_BAKE_MANIFEST_NAME).toBe('fx-bake-manifest.json');
  });

  it('字段口径与发布期 manifest 同构（共用 buildFxBakeManifest 的构造器）', () => {
    expect(manifest.bakeVersion).toBe(FX_BAKE_MANIFEST_VERSION);
    expect(manifest.fps).toBe(20);
    expect(manifest.seedStride).toBe(FX_BAKE_SEED_STRIDE);
    expect(manifest.paramPlan).toEqual(FX_BAKE_PARAM_PLAN);
    expect(Array.isArray(manifest.skins)).toBe(true);
    expect(Array.isArray(manifest.artifacts)).toBe(true);
    expect(manifest.artifacts.length).toBeGreaterThan(0);

    // 每条产物的字段集与发布期一致（不多不少 —— 消费代码按字段名取）。
    for (const artifact of manifest.artifacts) {
      expect(Object.keys(artifact).sort()).toEqual(
        [
          'frameHeight',
          'frameWidth',
          'frames',
          'fps',
          'json',
          'jsonBytes',
          'jsonSha256',
          'kind',
          'loop',
          'palette',
          'paletteTokens',
          'pivotX',
          'pivotY',
          'pixelfxId',
          'png',
          'pngBytes',
          'pngSha256',
          'scale',
          'seed',
          'skin',
          'variantId',
          'variantIndex',
        ].sort(),
      );
    }
  });

  it('「清单说有、文件才在」：清单里的每个产物在快照目录里都真实存在', () => {
    for (const artifact of manifest.artifacts) {
      expect(fs.existsSync(path.join(SNAPSHOT_ROOT, artifact.png))).toBe(true);
      expect(fs.existsSync(path.join(SNAPSHOT_ROOT, artifact.json))).toBe(true);
    }
  });

  it('「文件在、清单才说」：快照里的每张 sheet 都被列进了清单', () => {
    const listed = new Set(manifest.artifacts.map((artifact) => artifact.png));
    for (const skin of fs.readdirSync(SNAPSHOT_ROOT, { withFileTypes: true })) {
      if (!skin.isDirectory()) continue;
      const skinDir = path.join(SNAPSHOT_ROOT, skin.name);
      for (const name of fs.readdirSync(skinDir)) {
        if (!name.endsWith('.png')) continue;
        expect(listed.has(`${skin.name}/${name}`)).toBe(true);
      }
    }
  });

  it('基础变体的落位与运行时索引逐条对得上（运行时要哪张图，清单就写哪张）', () => {
    for (const source of SPRITE_FX_SOURCES) {
      const artifact = manifest.artifacts.find(
        (item) =>
          item.skin === SPRITE_FX_RUNTIME_SKIN &&
          item.kind === source.kind &&
          item.variantIndex === 0,
      );
      expect(artifact).toBeDefined();
      expect(artifact?.png).toBe(source.pngPath);
      expect(artifact?.json).toBe(source.jsonPath);
      expect(artifact?.variantId).toBe('base');
    }
  });

  it('运行时消费代码能直接吃这份清单（不感知 dev/release）', () => {
    // 运行时解析器吃的就是「HTTP 回来的那份 JSON」—— 这里喂同一份对象。
    const parsed = JSON.parse(JSON.stringify(manifest));
    expect(() => spriteFxVariantsFromManifest(parsed)).not.toThrow();
    // 快照当前只有基础变体（仓内入库的是 task_161 的基础 sheet）⇒ 变体清单为空，
    //   运行时只播基础变体 —— 与 release 的差异被如实记录，不是解析失败。
    const variants = spriteFxVariantsFromManifest(parsed, SPRITE_FX_RUNTIME_SKIN);
    expect(variants).toEqual([]);
  });

  it('确定性：同一份快照两次派生 → 逐字节一致（可复现）', () => {
    const again = buildFxSnapshotManifest({ rootDir: ROOT, assetsRoot: SNAPSHOT_ROOT });
    expect(JSON.stringify(again, null, 2)).toBe(JSON.stringify(manifest, null, 2));
  });
});
