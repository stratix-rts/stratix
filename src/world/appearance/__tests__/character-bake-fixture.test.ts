/**
 * 单测：**角色烘焙夹具 · 合成正确性 + 眼睛层模板 bug 回归**（@since v3.3，task_197 / CP-03）。
 *
 * 权威定义：docs/DESIGN-asset-pipelines.md
 *   - §2.2 纪律 1（缓存键含 Composer 版本 ⇒ 逻辑变了旧图自动失效）
 *   - §2.3（眼睛层 URL 模板变量未插值的已知 bug —— 本单一并修复）
 *
 * ★ 与 CP-01 / CP-02 单测的差别：那些用**假注册表 + 假合成器**（验的是「服务怎么调度」）；
 *   这里用**真 PartRegistry + 真 CharacterComposer**（生产代码不打桩），
 *   只把素材元数据换成仓内夹具 —— 断言的是**真实合成输出**（画在第几行、画的是哪张图）。
 *
 * ★ 为什么眼睛层值得单独立一组断言：
 *   LPC 的眼睛图层路径带模板变量（`eyes/human/${head}/${expression}/`），
 *   不插值 ⇒ 请求的是带花括号的字面量 URL ⇒ 必然 404 ⇒ 整层消失（角色没有眼睛）。
 *   这类 bug 在画面上表现为「角色没眼睛」，很容易被当成素材缺失放过 ——
 *   所以回归断言直接检查：**产出里不许再出现未插值的模板字面量**。
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { ANIMATION_OFFSETS, SHEET_WIDTH } from '../constants';

import {
  createFixtureComposer,
  FIXTURE_METADATA,
} from './helpers/bake-fixture';

/** 夹具里的部位选择（阴影 + 身体 + 头发 + 眼睛 —— 眼睛是被测的那一层）。 */
const SELECTIONS = {
  shadow: { itemId: 'shadow', variant: 'shadow' },
  body: { itemId: 'body', variant: 'light' },
  hair: { itemId: 'hair_afro', variant: 'black' },
  eyes: { itemId: 'eye_color', variant: 'blue' },
} as const;

/** 真素材元数据的路径（不在仓内 —— 有就对照，没有就跳过对照）。 */
const REAL_METADATA_PATH = join(__dirname, '../../../../assets/spritesheets/item-metadata.json');

describe('角色烘焙夹具：合成正确性（真注册表 + 真合成器）', () => {
  test('各部件层齐：阴影/身体/眼睛/头发四层都在，且按 z 序排好', async () => {
    const { composer } = await createFixtureComposer();

    const result = await composer.composeCharacter(SELECTIONS, {
      bodyType: 'male',
      animations: ['walk'],
    });

    expect(result.parts.map((part) => part.itemId)).toEqual([
      'shadow',
      'body',
      'eye_color',
      'hair_afro',
    ]);
    expect(result.parts.map((part) => part.zPos)).toEqual([0, 10, 105, 120]);
    expect(result.failedParts).toEqual([]);
  });

  test('坐标对：每层都画在该动画的行上（走路 = 第 8 行 × 64）', async () => {
    const { composer, painting } = await createFixtureComposer();

    await composer.composeCharacter(SELECTIONS, {
      bodyType: 'male',
      animations: ['walk', 'idle'],
    });

    const walkY = ANIMATION_OFFSETS.walk;
    const idleY = ANIMATION_OFFSETS.idle;
    expect(walkY).toBe(8 * 64);
    expect(idleY).toBe(22 * 64);

    // 阴影层没有 idle 动画（素材事实）⇒ 走路 4 层 + 待机 3 层 = 7 笔。
    expect(painting.draws).toHaveLength(7);
    for (const draw of painting.draws) {
      expect([walkY, idleY]).toContain(draw.y);
    }
    // 走路那几行确实有像素（合成真出了东西，不是空表）。
    expect(painting.hasPixels(0, walkY, SHEET_WIDTH, 4 * 64)).toBe(true);
    expect(painting.hasPixels(0, idleY, SHEET_WIDTH, 4 * 64)).toBe(true);
  });

  test('合成出来的是真精灵图（尺寸 = LPC 整表，且带版权署名）', async () => {
    const { composer, painting } = await createFixtureComposer();

    const result = await composer.composeCharacter(SELECTIONS, {
      bodyType: 'male',
      animations: ['walk'],
    });

    expect(painting.canvas.width).toBe(832);
    expect(painting.canvas.height).toBe(3456);
    expect(result.credits.length).toBeGreaterThan(0);
    expect(result.credits.map((credit) => credit.authors.join('/'))).toContain(
      'JaidynReiman/Matthew Krohn (makrohn)/Stephen Challener (Redshrike)'
    );
  });
});

describe('眼睛层模板 bug 回归（task_197 / CP-03 修的就是它）', () => {
  test('眼睛层的 URL 模板变量被插值（不再出现 ${head} / ${expression} 字面量）', async () => {
    const { composer } = await createFixtureComposer();

    const result = await composer.composeCharacter(SELECTIONS, {
      bodyType: 'male',
      animations: ['walk'],
    });

    const eyes = result.parts.find((part) => part.itemId === 'eye_color');
    expect(eyes?.spritePath).toBe('/spritesheets/eyes/human/adult/default/walk/blue.png');
  });

  test('产出里不许有未插值的模板字面量（所有层的路径 + 实际请求的 URL）', async () => {
    const { composer, images } = await createFixtureComposer();

    const result = await composer.composeCharacter(SELECTIONS, {
      bodyType: 'male',
      animations: ['walk', 'idle'],
    });

    for (const part of result.parts) {
      expect(part.spritePath).not.toContain('$');
      expect(part.spritePath).not.toContain('{');
      expect(part.spritePath).not.toContain('}');
    }
    for (const src of images.requested) {
      expect(src).not.toContain('${');
      expect(src).not.toContain('{');
    }
  });

  test('眼睛层真的被画上去了（渲染输出里含眼睛那张图）', async () => {
    const { composer, painting, images } = await createFixtureComposer();

    await composer.composeCharacter(SELECTIONS, {
      bodyType: 'male',
      animations: ['walk'],
    });

    expect(images.requested).toContain('/spritesheets/eyes/human/adult/default/walk/blue.png');
    expect(painting.draws.map((draw) => draw.src)).toContain(
      '/spritesheets/eyes/human/adult/default/walk/blue.png'
    );
  });

  test('child 体型：眼睛素材没有表情目录 ⇒ 表情段整段省略（不留空目录）', async () => {
    const { composer } = await createFixtureComposer();

    const result = await composer.composeCharacter(
      {
        body: { itemId: 'body', variant: 'light' },
        eyes: { itemId: 'eye_color', variant: 'blue' },
      },
      { bodyType: 'child', animations: ['walk'] }
    );

    const eyes = result.parts.find((part) => part.itemId === 'eye_color');
    expect(eyes?.spritePath).toBe('/spritesheets/eyes/human/child/walk/blue.png');
  });

  test('其它体型的眼睛也插值成真实目录（teen/muscular/pregnant 都走 adult）', async () => {
    for (const bodyType of ['teen', 'muscular', 'pregnant'] as const) {
      const { composer } = await createFixtureComposer();
      const result = await composer.composeCharacter(
        { eyes: { itemId: 'eye_color', variant: 'blue' } },
        { bodyType, animations: ['walk'] }
      );

      const eyes = result.parts.find((part) => part.itemId === 'eye_color');
      expect(eyes?.spritePath).toBe('/spritesheets/eyes/human/adult/default/walk/blue.png');
    }
  });
});

describe('夹具保真（夹具元数据与真素材形状一致）', () => {
  test('眼睛层的图层路径与 replaceInPath 表与真素材一致（真素材不在仓内时跳过）', () => {
    if (!existsSync(REAL_METADATA_PATH)) return;

    const real = JSON.parse(readFileSync(REAL_METADATA_PATH, 'utf8')) as Record<string, {
      layers?: Record<string, Record<string, unknown>>;
      replaceInPath?: Record<string, Record<string, string>>;
    }>;
    const realEyes = real.eye_color;
    const fixtureEyes = FIXTURE_METADATA.eye_color as unknown as {
      layers: Record<string, Record<string, unknown>>;
      replaceInPath: Record<string, Record<string, string>>;
    };

    expect(fixtureEyes.layers.layer_1).toEqual(realEyes.layers?.layer_1);
    expect(fixtureEyes.replaceInPath).toEqual(realEyes.replaceInPath);
  });
});

/**
 * 缺件分级（@since v3.3，task_209 / CP-04）。
 *
 * ★ 两种缺件（权威口径见 .long-run-agent/tasks/task_209.md）：
 *   ① **合法缺失**：素材库该层该动画**本就没有文件**（动画目录不存在）——
 *      LPC 真素材的人眼层就是这一类（`eyes/human/adult/default/climb/` 目录不存在，
 *      而元数据声称支持 climb）⇒ 该格留空/透明，烘焙照常成功。
 *   ② **真缺件**：元数据声称存在、目录也在，只是**文件丢了/坏了** ⇒ 仍走 parts-missing 失败面。
 *
 * ★ 判定依据 = 素材目录结构：目录在不在 ⇒ 用「同目录兄弟变体文件能否取到」来探
 *   （静态服务没有目录列表，列不出目录内容 —— 见 character-composer.ts 的 classifyFailure）。
 */
describe('缺件分级（task_209 / CP-04）：合法缺失 vs 真缺件', () => {
  /** 眼睛层 climb 动画目录（素材库里压根不存在）。 */
  const EYES_CLIMB_DIR = '/spritesheets/eyes/human/adult/default/climb/';
  /** 眼睛层 walk 动画目录（素材库里存在）。 */
  const EYES_WALK_BLUE = '/spritesheets/eyes/human/adult/default/walk/blue.png';

  test('合法缺失（动画目录不存在）⇒ 该格留空，合成照常成功（不算缺件）', async () => {
    const { composer, painting } = await createFixtureComposer({
      missingDirs: [EYES_CLIMB_DIR],
    });

    const result = await composer.composeCharacter(SELECTIONS, {
      bodyType: 'male',
      animations: ['walk', 'climb'],
    });

    // 分类正确：climb 那格是**合法缺失**，不是真缺件。
    expect(result.missingParts).toEqual([
      `${EYES_CLIMB_DIR}blue.png`,
    ]);
    expect(result.failedParts).toEqual([]);

    // 该格**透明**：climb 那一行没有画眼睛那张图（别的层照画）。
    const climbY = ANIMATION_OFFSETS.climb;
    const climbDraws = painting.draws.filter((draw) => draw.y === climbY).map((draw) => draw.src);
    expect(climbDraws).not.toContain(`${EYES_CLIMB_DIR}blue.png`);
    expect(climbDraws.length).toBeGreaterThan(0);
  });

  test('合法缺失不影响同一层的其它动画（眼睛的 walk 照常画）', async () => {
    const { composer, painting } = await createFixtureComposer({
      missingDirs: [EYES_CLIMB_DIR],
    });

    await composer.composeCharacter(SELECTIONS, {
      bodyType: 'male',
      animations: ['walk', 'climb'],
    });

    const walkY = ANIMATION_OFFSETS.walk;
    const walkDraws = painting.draws.filter((draw) => draw.y === walkY).map((draw) => draw.src);
    expect(walkDraws).toContain(EYES_WALK_BLUE);
  });

  test('真缺件（目录在、文件缺）⇒ 计入缺件面（烘焙期的失败面）', async () => {
    const { composer } = await createFixtureComposer({
      missingPaths: [EYES_WALK_BLUE],
    });

    const result = await composer.composeCharacter(SELECTIONS, {
      bodyType: 'male',
      animations: ['walk'],
    });

    expect(result.failedParts).toEqual([EYES_WALK_BLUE]);
    expect(result.missingParts).toEqual([]);
  });

  test('取图通道整体坏了（一格都没成功）⇒ 保守判真缺件，不误判成合法缺失', async () => {
    const { composer } = await createFixtureComposer({ failImages: true });

    const result = await composer.composeCharacter(SELECTIONS, {
      bodyType: 'male',
      animations: ['walk'],
    });

    // 全部失败 ⇒ 判真缺件（降级比烤进一张坏图安全）。
    expect(result.failedParts?.length).toBeGreaterThan(0);
    expect(result.missingParts).toEqual([]);
  });

  test('目录存在性探针集 = 同目录兄弟变体文件（注册表口径）', async () => {
    const { registry } = await createFixtureComposer();

    // 眼睛层的兄弟变体（夹具元数据里眼睛层有 4 个变体）。
    expect(registry.getDirectoryProbeFiles('eye_color', 1, 'male')).toEqual([
      'blue',
      'brown',
      'gray',
      'green',
    ]);
    // 不同体型 → 不同目录 → 不同探针集（child 走 child 目录）。
    expect(registry.getDirectoryProbeFiles('eye_color', 1, 'child')).toEqual([
      'blue',
      'brown',
      'gray',
      'green',
    ]);
    // 查不到的部位/图层 ⇒ 空集（调用方据此判「不可判定」）。
    expect(registry.getDirectoryProbeFiles('eye_color', 9, 'male')).toEqual([]);
    expect(registry.getDirectoryProbeFiles('no_such_item', 1, 'male')).toEqual([]);
  });
});
