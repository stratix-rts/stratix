/**
 * 测试夹具：**角色烘焙的真实素材形状**（@since v3.3，task_197 / CP-03）。
 *
 * why 需要它：CP-01 / CP-02 的单测用的是**假注册表 + 假合成器** ——
 *   那验证的是「服务怎么调度」，验证不了「合成出来的东西对不对」。
 *   本夹具换一套底：真 PartRegistry + 真 CharacterComposer（两者都是生产代码，不打桩），
 *   只把**素材元数据**换成一份仓内的小夹具（真素材 1.3G 不在仓内，.gitignore 排除）。
 *
 * ★ 夹具元数据照抄真素材（assets/spritesheets/item-metadata.json）的**形状**：
 *   图层路径、z 序、动画表、replaceInPath 表都按真素材抄 ——
 *   尤其**眼睛层的模板变量**（`eyes/human/${head}/${expression}/`）必须一模一样，
 *   否则测的就不是那个 bug 了。
 *
 * ★ 画布是**会画东西**的替身（不是只记录调用的空壳）：
 *   drawImage 真的把像素落到一张表里（每行落一个标记点），
 *   getImageData 真的把像素读回来 —— 于是「合成结果有没有内容」「画在第几行」
 *   都是对**真实合成输出**的断言，不是对调用参数的断言。
 */

import { CharacterComposer } from '../../character-composer';
import { PartRegistry } from '../../part-registry';
import { SHEET_HEIGHT, SHEET_WIDTH } from '../../constants';

import { createFakeFetch } from './fakes';

/**
 * LPC 素材元数据夹具（照抄真素材的形状）。
 *
 * why 是「照抄」而不是「编」：眼睛层的模板变量（`${head}` / `${expression}`）
 *   与 replaceInPath 表必须与真素材一致 —— 编一份就等于自说自话地测了个假的 bug。
 */
export const FIXTURE_METADATA = {
  shadow: {
    name: 'Shadow',
    typeName: 'shadow',
    required: ['male', 'female', 'teen', 'child', 'muscular', 'pregnant'],
    animations: ['spellcast', 'thrust', 'walk', 'slash', 'shoot', 'hurt', 'watering'],
    variants: ['shadow'],
    layers: {
      layer_1: {
        zPos: 0,
        male: 'shadow/adult/',
        muscular: 'shadow/adult/',
        female: 'shadow/adult/',
        pregnant: 'shadow/adult/',
        teen: 'shadow/adult/',
        child: 'shadow/child/',
      },
    },
    credits: [
      {
        file: 'shadow',
        authors: ['drjamgo@hotmail.com'],
        licenses: ['CC0'],
        urls: ['https://opengameart.org/content/shadow-for-lpc-sprite'],
      },
    ],
  },
  body: {
    name: 'Body Color',
    typeName: 'body',
    required: ['male', 'female', 'teen', 'child', 'muscular', 'pregnant'],
    animations: [
      'spellcast', 'thrust', 'walk', 'slash', 'shoot', 'hurt', 'watering',
      'idle', 'jump', 'run', 'sit', 'emote', 'climb', 'combat',
      '1h_slash', '1h_backslash', '1h_halfslash',
    ],
    variants: ['light', 'amber', 'brown', 'black'],
    layers: {
      layer_1: {
        zPos: 10,
        male: 'body/bodies/male/',
        muscular: 'body/bodies/muscular/',
        female: 'body/bodies/female/',
        pregnant: 'body/bodies/pregnant/',
        teen: 'body/bodies/teen/',
        child: 'body/bodies/child/',
      },
    },
    credits: [{ authors: ['ElizaWy'], licenses: ['CC-BY-SA-3.0'] }],
  },
  hair_afro: {
    name: 'Afro',
    typeName: 'hair',
    required: ['male', 'female', 'teen', 'muscular', 'pregnant'],
    animations: [
      'spellcast', 'thrust', 'walk', 'slash', 'shoot', 'hurt', 'watering',
      'idle', 'jump', 'run', 'sit', 'emote', 'climb', 'combat',
      '1h_slash', '1h_backslash', '1h_halfslash',
    ],
    variants: ['blonde', 'black', 'brown'],
    layers: {
      layer_1: {
        zPos: 120,
        male: 'hair/afro/adult/',
        muscular: 'hair/afro/adult/',
        female: 'hair/afro/adult/',
        pregnant: 'hair/afro/adult/',
        teen: 'hair/afro/adult/',
      },
    },
    credits: [{ authors: ['JaidynReiman'], licenses: ['CC-BY-SA-3.0'] }],
  },
  eye_color: {
    name: 'Eye Color',
    typeName: 'eye_color',
    required: ['male', 'female', 'teen', 'child', 'muscular', 'pregnant'],
    animations: [
      'spellcast', 'thrust', 'walk', 'slash', 'shoot', 'hurt', 'watering',
      'idle', 'jump', 'run', 'sit', 'emote', 'climb', 'combat',
      '1h_slash', '1h_backslash', '1h_halfslash',
    ],
    variants: ['blue', 'brown', 'gray', 'green'],
    // ★ 模板变量原样保留（真素材就是这样）—— 这正是本单要修的那个 bug。
    layers: {
      layer_1: {
        zPos: 105,
        male: 'eyes/human/${head}/${expression}/',
        muscular: 'eyes/human/${head}/${expression}/',
        female: 'eyes/human/${head}/${expression}/',
        teen: 'eyes/human/${head}/${expression}/',
        pregnant: 'eyes/human/${head}/${expression}/',
        child: 'eyes/human/child/${expression}/',
      },
    },
    replaceInPath: {
      head: {
        Human_male: 'adult',
        Human_male_small: 'adult',
        Human_male_plump: 'adult',
        Human_male_gaunt: 'adult',
        Human_female: 'adult',
        Human_female_small: 'adult',
        Human_male_elderly: 'elderly',
        Human_female_elderly: 'elderly',
        Human_elderly_small: 'elderly',
      },
      expression: {
        none: 'default',
        Neutral: 'neutral',
        Closing_Eyes: 'closing',
        Closed_Eyes: 'none',
        Looking_Left: 'look_l',
        Looking_Right: 'look_r',
        Rolling_Eyes: 'eyeroll',
        Shock: 'shock',
        Angry: 'anger',
        Angry_Alt: 'default',
        Sad: 'sad',
        Sad_Alt: 'sad2',
        Happy: 'none',
        Happy_Alt: 'none',
        Blush: 'none',
        Shame: 'shame',
      },
    },
    credits: [
      {
        file: 'eyes/human',
        authors: ['JaidynReiman', 'Matthew Krohn (makrohn)', 'Stephen Challener (Redshrike)'],
        licenses: ['CC-BY-SA-3.0'],
      },
    ],
  },
} as const;

/** LPC 单动画素材条的尺寸（真素材 576×256：9 帧 × 4 方向）。 */
const STRIP_WIDTH = 576;
const STRIP_HEIGHT = 256;

/** 一笔 drawImage 的记录。 */
export interface RecordedDraw {
  /** 被画上去的图片（= 精灵图 URL）。 */
  readonly src: string;
  /** 落点 x。 */
  readonly x: number;
  /** 落点 y（= 动画行偏移）。 */
  readonly y: number;
}

/** 会真的落像素的画布替身。 */
export interface PaintingCanvas {
  readonly canvas: HTMLCanvasElement;
  /** 每笔 drawImage 的记录（按顺序）。 */
  readonly draws: readonly RecordedDraw[];
  /** 某个矩形里有没有被画过的像素。 */
  hasPixels(x: number, y: number, width: number, height: number): boolean;
  /** 被画过的像素总数（诊断用）。 */
  paintedCount(): number;
}

/**
 * 造一张会落像素的画布。
 *
 * why 每行只落一个点：整块铺满的话，832×3456 的整图 × 几十层 = 百万级像素条目（纯浪费）。
 *   一行一个点足够回答「这一层画在第几行」「走路那几行有没有内容」，
 *   而 getImageData 读回来的是**真的像素数组**（判空口径与浏览器一致）。
 */
export function createPaintingCanvas(): PaintingCanvas {
  const painted = new Set<string>();
  const draws: RecordedDraw[] = [];

  const canvasRef = { width: 0, height: 0 } as HTMLCanvasElement;

  const ctx = {
    imageSmoothingEnabled: true,
    clearRect: (x: number, y: number, width: number, height: number): void => {
      for (const key of [...painted]) {
        const [px, py] = key.split(',').map(Number);
        if (px >= x && px < x + width && py >= y && py < y + height) painted.delete(key);
      }
    },
    drawImage: (
      image: HTMLImageElement,
      ...args: number[]
    ): void => {
      let destX = 0;
      let destY = 0;
      let destWidth: number;
      let destHeight: number;

      if (args.length >= 8) {
        // 9 参形态：drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)。
        destX = args[4];
        destY = args[5];
        destWidth = args[6];
        destHeight = args[7];
      } else {
        // 3 参形态：drawImage(img, dx, dy) —— 落点尺寸 = 图片自然尺寸。
        destX = args[0];
        destY = args[1];
        destWidth = image.width || STRIP_WIDTH;
        destHeight = image.height || STRIP_HEIGHT;
      }

      draws.push({ src: image.src, x: destX, y: destY });

      const maxY = Math.min(destY + destHeight, canvasRef.height);
      for (let row = destY; row < maxY; row += 1) {
        if (row < 0 || destX < 0 || destX >= canvasRef.width) continue;
        painted.add(`${destX},${row}`);
      }
    },
    getImageData: (
      x: number,
      y: number,
      width: number,
      height: number
    ): { data: Uint8ClampedArray } => {
      const data = new Uint8ClampedArray(width * height * 4);
      for (const key of painted) {
        const [px, py] = key.split(',').map(Number);
        if (px < x || px >= x + width || py < y || py >= y + height) continue;
        const offset = (py - y) * width + (px - x);
        data[offset * 4] = 12;
        data[offset * 4 + 1] = 34;
        data[offset * 4 + 2] = 56;
        data[offset * 4 + 3] = 255;
      }
      return { data };
    },
  };

  const canvas = {
    get width(): number {
      return canvasRef.width;
    },
    set width(value: number) {
      canvasRef.width = value;
    },
    get height(): number {
      return canvasRef.height;
    },
    set height(value: number) {
      canvasRef.height = value;
    },
    getContext: () => ctx,
    // 编码结果要**可判别**：把「画了多少点」编进去，测试才能断言「烤进缓存的是这次合成的产物」。
    toDataURL: (): string => {
      const summary = JSON.stringify({ pixels: painted.size, draws: draws.length });
      return `data:image/png;base64,${Buffer.from(summary, 'utf8').toString('base64')}`;
    },
  };

  return {
    canvas: canvas as unknown as HTMLCanvasElement,
    draws,
    hasPixels: (x, y, width, height): boolean => {
      for (const key of painted) {
        const [px, py] = key.split(',').map(Number);
        if (px >= x && px < x + width && py >= y && py < y + height) return true;
      }
      return false;
    },
    paintedCount: (): number => painted.size,
  };
}

/**
 * 图片工厂：按 **src 的形态**给图片自然尺寸。
 *
 * why 要分两种尺寸：LPC 的**素材条**是 576×256（一个动画的 4 行），
 *   而烘焙缓存里的**整精灵图**是 832×3456（data URL）——
 *   尺寸不同，画上去的范围就不同（坐标断言会依赖它）。
 *
 * ★ 缺件注入（@since v3.3，task_209 / CP-04）：素材库要能区分两种「取不到」——
 *   - `missingDirs`：整个动画目录**不存在**（素材库这层这动画本就没有文件）⇒ **合法缺失**；
 *   - `missingPaths`：目录在、**文件缺** ⇒ **真缺件**；
 *   - `fail`：所有图都取不到（模拟取图通道/网络整体坏了）。
 *   夹具按真实素材目录结构回答「目录在不在」—— 缺件分级就靠这条区分。
 */
export function createFixtureImageFactory(
  options: {
    fail?: boolean;
    /** 这些目录下的文件全部取不到（合法缺失：目录不存在）。 */
    missingDirs?: readonly string[];
    /** 这些文件取不到（真缺件：目录在、文件缺）。 */
    missingPaths?: readonly string[];
  } = {}
): {
  createImage: () => HTMLImageElement;
  requested: string[];
} {
  const requested: string[] = [];

  /** 这个 src 在素材库里取不到吗？ */
  const isMissing = (src: string): boolean => {
    if (options.fail) return true;
    if (options.missingPaths?.includes(src)) return true;
    return (options.missingDirs ?? []).some((dir) => src.startsWith(dir));
  };

  const createImage = (): HTMLImageElement => {
    let currentSrc = '';
    const image = {
      width: STRIP_WIDTH,
      height: STRIP_HEIGHT,
      onload: null as (() => void) | null,
      onerror: null as (() => void) | null,
    };

    Object.defineProperty(image, 'src', {
      get() {
        return currentSrc;
      },
      set(value: string) {
        currentSrc = value;
        requested.push(value);
        // 整精灵图（烘焙缓存的 data URL）与素材条尺寸不同。
        if (value.startsWith('data:image/png')) {
          image.width = SHEET_WIDTH;
          image.height = SHEET_HEIGHT;
        } else {
          image.width = STRIP_WIDTH;
          image.height = STRIP_HEIGHT;
        }
        setTimeout(() => {
          if (isMissing(value)) {
            image.onerror?.();
          } else {
            image.onload?.();
          }
        }, 0);
      },
    });

    return image as unknown as HTMLImageElement;
  };

  return { createImage, requested };
}

/** 夹具里的注册表（真 PartRegistry，元数据来自 FIXTURE_METADATA）。 */
export async function createFixtureRegistry(
  options: { failMetadata?: boolean } = {}
): Promise<PartRegistry> {
  const { fetch } = createFakeFetch(() => {
    if (options.failMetadata) {
      // 真素材取不到（网络失败）—— 注册表会退化成空表，与真素材缺失同一形状。
      throw new Error('元数据取不到');
    }
    return {
      ok: true,
      status: 200,
      json: async () => FIXTURE_METADATA,
    };
  });
  const registry = new PartRegistry({ fetchImpl: fetch });
  await registry.loadMetadata();
  return registry;
}

/** 夹具里的合成器（真 CharacterComposer + 会落像素的画布 + 假图片工厂）。 */
export async function createFixtureComposer(
  options: {
    failImages?: boolean;
    failMetadata?: boolean;
    /** 整个动画目录不存在（合法缺失）。 */
    missingDirs?: readonly string[];
    /** 目录在、文件缺（真缺件）。 */
    missingPaths?: readonly string[];
  } = {}
): Promise<{
  composer: CharacterComposer;
  registry: PartRegistry;
  painting: PaintingCanvas;
  images: ReturnType<typeof createFixtureImageFactory>;
}> {
  const registry = await createFixtureRegistry({ failMetadata: options.failMetadata ?? false });
  const images = createFixtureImageFactory({
    fail: options.failImages,
    ...(options.missingDirs ? { missingDirs: options.missingDirs } : {}),
    ...(options.missingPaths ? { missingPaths: options.missingPaths } : {}),
  });
  const painting = createPaintingCanvas();
  const composer = new CharacterComposer({
    registry,
    createCanvas: () => painting.canvas,
    createImage: images.createImage,
  });
  return { composer, registry, painting, images };
}
