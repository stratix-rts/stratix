/**
 * 文件职责：**形象预览的 Phaser 迷你实例**（app 层）—— 在向导屏的容器里跑一个小 Phaser 游戏，
 *   把合成好的 LPC 精灵表按"走路动画"逐帧显示出来。
 *   来源思路：git 历史 a9498ae~1:src/components/character-creator/v3/components/CanvasPreview.vue
 *   （Phaser sprite + 手动帧步进；本文件把那段 Vue 逻辑搬成**纯 TS 句柄**，不依赖 UI 框架）。
 *   任务：.long-run-agent/tasks/task_028.md。
 * 输入：宿主容器元素（hud 屏给的 shadow DOM 里的一个 div）+ 合成好的精灵表画布。
 * 输出：PreviewGameHandle（换表 / 销毁）。
 * 禁止事项：
 *   1. import hud —— 本文件不认识向导屏（屏只拿到句柄）；
 *   2. import core 的状态 —— 这里只管画；
 *   3. 自己合成角色 —— 合成在 world/appearance/character-composer.ts，本文件只显示；
 *   4. 泄漏定时器 / Phaser 实例 —— destroy() 必须把两者都收干净（perf 硬约束）。
 *
 * ★ 为什么用 Phaser 而不是直接画 canvas：
 *   战场侧已经是 Phaser，形象预览复用同一套渲染栈（像素对齐、缩放策略一致），
 *   免得同一份 LPC 素材在两个渲染器里长得不一样。
 *   但这里**不建场景**（world 的 BattlefieldScene 是另一回事），只建一个空场景放一个 sprite。
 *
 * ★ 帧步进为什么手写而不是用 Phaser 的 anim 系统：
 *   LPC 的走路动画是"8 帧循环，但每帧停留时间不同"的固定序列（见 ANIMATION_CONFIGS.walk.cycle），
 *   Phaser 的 anim 只能等间隔播放 —— 等间隔播放会让脚步节奏变味。故按历史实现手动步进。
 */

import Phaser from 'phaser';

import {
  ANIMATION_CONFIGS,
  ANIMATION_OFFSETS,
  FRAME_SIZE,
  LPC_DIRECTION_ROWS,
} from '../../world/appearance/constants';

/** 预览画布边长（像素）。 */
export const PREVIEW_SIZE = 128;

/** 预览播放帧率（每秒帧数）。 */
export const PREVIEW_FPS = 8;

/** 帧纹理在 Phaser 里的 key（单例场景内唯一）。 */
export const PREVIEW_FRAME_TEXTURE_KEY = 'strat-appearance-frame';

/** 预览画布的场景 key。 */
export const PREVIEW_SCENE_KEY = 'StratAppearancePreview';

/**
 * 预览游戏句柄：外部只认这两个动作。
 * why 抽成接口：单测里注入假句柄即可验证"销毁时机"，不必真跑 WebGL。
 */
export interface PreviewGameHandle {
  /** 换一张合成好的精灵表（立即重画当前帧）。 */
  setSheet(canvas: HTMLCanvasElement): void;
  /** 销毁实例（定时器 + sprite + Phaser 游戏）。 */
  destroy(): void;
}

/** 创建预览游戏的函数（app 层注入给预览服务，单测可替换成假实现）。 */
export type PreviewGameCreator = (host: HTMLElement) => PreviewGameHandle;

/**
 * 造一个 Phaser 迷你预览实例。
 *
 * @param host 宿主容器（Phaser 的 canvas 挂进去）。
 */
export function createPhaserPreviewGame(host: HTMLElement): PreviewGameHandle {
  let scene: Phaser.Scene | null = null;
  let game: Phaser.Game | null = null;
  let sprite: Phaser.GameObjects.Sprite | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  /** 当前显示的精灵表（合成结果）。 */
  let sheet: HTMLCanvasElement | null = null;
  /** 当前动画的帧序号（cycle 下标）。 */
  let frameIndex = 0;
  let destroyed = false;

  const walk = ANIMATION_CONFIGS.walk;
  /** 精灵表里"朝下"那一行的行号（动画起始行 + 方向行）。 */
  const sheetRow = ANIMATION_OFFSETS.walk / FRAME_SIZE + LPC_DIRECTION_ROWS.DOWN;

  /** 画当前帧：从精灵表裁 64×64 画进帧纹理。 */
  const drawFrame = (): void => {
    if (!scene || !sheet || !sprite) return;
    const texture = scene.textures.get(PREVIEW_FRAME_TEXTURE_KEY) as
      | Phaser.Textures.CanvasTexture
      | undefined;
    if (!texture) return;
    const ctx = texture.getContext();
    if (!ctx) return;
    const column = walk.cycle[frameIndex % walk.cycle.length] ?? 0;
    ctx.clearRect(0, 0, FRAME_SIZE, FRAME_SIZE);
    ctx.drawImage(
      sheet,
      column * FRAME_SIZE, sheetRow * FRAME_SIZE, FRAME_SIZE, FRAME_SIZE,
      0, 0, FRAME_SIZE, FRAME_SIZE
    );
    texture.refresh();
  };

  /** 启动帧步进定时器。 */
  const startTimer = (): void => {
    if (timer !== null) return;
    timer = setInterval(() => {
      frameIndex = (frameIndex + 1) % walk.cycle.length;
      drawFrame();
    }, Math.round(1000 / PREVIEW_FPS));
  };

  const sceneConfig = {
    key: PREVIEW_SCENE_KEY,
    create(this: Phaser.Scene): void {
      scene = this;
      const texture = this.textures.createCanvas(PREVIEW_FRAME_TEXTURE_KEY, FRAME_SIZE, FRAME_SIZE);
      if (texture) {
        sprite = this.add.sprite(PREVIEW_SIZE / 2, PREVIEW_SIZE / 2, PREVIEW_FRAME_TEXTURE_KEY);
        sprite.setOrigin(0.5, 0.5);
        sprite.setScale(PREVIEW_SIZE / FRAME_SIZE);
      }
      drawFrame();
      startTimer();
    },
  };

  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    width: PREVIEW_SIZE,
    height: PREVIEW_SIZE,
    pixelArt: true,
    transparent: true,
    scene: [sceneConfig],
    scale: { mode: Phaser.Scale.NONE },
    // 预览不需要音频 / 物理：省掉这两块，Phaser 也不会去建对应的系统。
    audio: { noAudio: true },
    banner: false,
  });

  return {
    setSheet(canvas: HTMLCanvasElement): void {
      if (destroyed) return;
      sheet = canvas;
      frameIndex = 0;
      drawFrame();
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      if (sprite) {
        sprite.destroy();
        sprite = null;
      }
      if (game) {
        game.destroy(true);
        game = null;
      }
      scene = null;
      sheet = null;
    },
  };
}
