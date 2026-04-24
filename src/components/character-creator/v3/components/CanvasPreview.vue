<script setup lang="ts">
/**
 * CanvasPreview.vue - Phaser Canvas 预览组件 (V3)
 *
 * 唯一接触 Phaser 的组件。
 * 职责：接收 props → 调用 characterComposer 合成纹理 → 用 setInterval 手动推进帧显示动画
 *
 * ⚠️ 禁止使用不存在的 Phaser API:
 *   - scene.children.getByTag() — 不存在
 *   - sprite.setTag() — 不存在
 *   - scene.children.getByProperty() — 不存在
 */

import { ref, watch, onMounted, onUnmounted } from 'vue';
import Phaser from 'phaser';
import { characterComposer } from '@/stratix-character-creator/core/CharacterComposer';
import {
  FRAME_SIZE,
  SHEET_WIDTH,
  SHEET_HEIGHT,
  FRAMES_PER_ROW,
  ANIMATION_CONFIGS,
  LOGICAL_TO_LPC,
} from '@/stratix-character-creator/constants';
import type { AnimationName, BodyType } from '@/stratix-character-creator/constants';
import type { PartSelection } from '@/stratix-character-creator/types';
import { getToken } from '@/design-system/config';

const props = defineProps<{
  bodyType: BodyType;
  parts: Record<string, PartSelection>;
  animation: AnimationName;
  direction: number;
  scale: number;
}>();

// ============================================================
// 组件级引用 — 用变量追踪 Phaser 对象，不用 getByTag()
// ============================================================
const containerRef = ref<HTMLDivElement | null>(null);
let game: Phaser.Game | null = null;
let scene: Phaser.Scene | null = null;

// Sprite 引用
let spriteRef: Phaser.GameObjects.Sprite | null = null;
let bgRef: Phaser.GameObjects.Image | null = null;

// 纹理 key
let sheetTextureKey = 'char_preview_texture';
let frameTextureKey = 'char_frame';
let checkerboardKey = 'checkerboard_bg';

// 动画状态
let animTimer: ReturnType<typeof setInterval> | null = null;
let currentFrameIndex = 0;
let currentFrameIndexes: number[] = [];

// ============================================================
// 辅助函数
// ============================================================
function getThemeColor(tokenPath: string): string {
  return getToken(tokenPath) ?? '#000000';
}

function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

function getBackgroundColor(): number {
  return hexToNumber(getThemeColor('colors.background.base'));
}

const BASE_FRAMERATE = 8;

// ============================================================
// 棋盘格背景
// ============================================================
function createCheckerboardTexture(scene: Phaser.Scene, width: number, height: number): string {
  const key = checkerboardKey;
  if (scene.textures.exists(key)) return key;

  const size = 8;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // gray-200: #d1d5db, gray-400: #9ca3af
  const colorLight = '#d1d5db';
  const colorDark = '#9ca3af';

  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      const isLight = ((x / size) + (y / size)) % 2 === 0;
      ctx.fillStyle = isLight ? colorLight : colorDark;
      ctx.fillRect(x, y, size, size);
    }
  }

  scene.textures.addCanvas(key, canvas);
  return key;
}

// ============================================================
// 清理函数
// ============================================================
function clearAnimTimer(): void {
  if (animTimer !== null) {
    clearInterval(animTimer);
    animTimer = null;
  }
}

function cleanupTextures(): void {
  if (!scene) return;

  const keysToRemove = [sheetTextureKey, frameTextureKey, checkerboardKey];
  for (const key of keysToRemove) {
    if (scene.textures.exists(key)) {
      scene.textures.remove(key);
    }
  }
}

function destroyGame(): void {
  clearAnimTimer();
  cleanupTextures();

  if (spriteRef) {
    spriteRef.destroy();
    spriteRef = null;
  }
  if (bgRef) {
    bgRef.destroy();
    bgRef = null;
  }

  if (game) {
    game.destroy(true);
    game = null;
    scene = null;
  }
}

// ============================================================
// 渲染
// ============================================================
async function renderCharacter(): Promise<void> {
  if (!scene || !game) return;

  try {
    const result = await characterComposer.composeCharacter(props.parts, {
      bodyType: props.bodyType,
    });

    // Remove existing sheet texture
    if (scene.textures.exists(sheetTextureKey)) {
      scene.textures.remove(sheetTextureKey);
    }

    // Create canvas texture from composed character
    const texture = scene.textures.createCanvas(sheetTextureKey, SHEET_WIDTH, SHEET_HEIGHT);
    if (!texture) return;

    const ctx = texture.getContext();
    ctx.drawImage(result.canvas, 0, 0);
    texture.refresh();

    // Calculate frame indexes for current animation + direction
    updateFrameIndexes();
    displayCurrentFrame();
  } catch (error) {
    console.error('[CanvasPreview] Failed to render character:', error);
  }
}

function updateFrameIndexes(): void {
  const animConfig = ANIMATION_CONFIGS[props.animation];
  if (!animConfig) {
    currentFrameIndexes = [];
    return;
  }

  const { row, cycle } = animConfig;
  const lpcRow = LOGICAL_TO_LPC[props.direction] ?? 2;
  const dirRow = row + lpcRow;

  currentFrameIndexes = cycle.map(col => dirRow * FRAMES_PER_ROW + col);
}

function displayCurrentFrame(): void {
  if (!scene || currentFrameIndexes.length === 0) return;

  const frameIndex = currentFrameIndexes[currentFrameIndex % currentFrameIndexes.length];

  const srcX = (frameIndex % FRAMES_PER_ROW) * FRAME_SIZE;
  const srcY = Math.floor(frameIndex / FRAMES_PER_ROW) * FRAME_SIZE;

  // Create frame canvas
  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = FRAME_SIZE;
  frameCanvas.height = FRAME_SIZE;
  const ctx = frameCanvas.getContext('2d');
  if (!ctx) return;

  // Get source texture
  const sourceTexture = scene.textures.get(sheetTextureKey);
  if (!sourceTexture || !(sourceTexture instanceof Phaser.Textures.CanvasTexture)) return;

  // Draw the frame
  ctx.drawImage(
    sourceTexture.canvas,
    srcX, srcY, FRAME_SIZE, FRAME_SIZE,
    0, 0, FRAME_SIZE, FRAME_SIZE
  );

  // Remove existing frame texture
  if (scene.textures.exists(frameTextureKey)) {
    scene.textures.remove(frameTextureKey);
  }

  scene.textures.addCanvas(frameTextureKey, frameCanvas);

  // Get canvas size
  const width = scene.cameras.main.width;
  const height = scene.cameras.main.height;
  const centerX = width / 2;
  const centerY = height / 2;

  // Update checkerboard
  if (!scene.textures.exists(checkerboardKey)) {
    createCheckerboardTexture(scene, width, height);
  }

  // Destroy old bg and sprite
  if (bgRef) {
    bgRef.destroy();
    bgRef = null;
  }
  if (spriteRef) {
    spriteRef.destroy();
    spriteRef = null;
  }

  // Add checkerboard background
  bgRef = scene.add.image(0, 0, checkerboardKey);
  bgRef.setOrigin(0, 0);

  // Add sprite centered
  spriteRef = scene.add.sprite(centerX, centerY, frameTextureKey);
  spriteRef.setScale(props.scale);
  spriteRef.setOrigin(0.5, 0.5);
}

// ============================================================
// 动画循环 — 用 setInterval 手动推进帧，不用 Phaser anim 系统
// ============================================================
function startAnimation(): void {
  clearAnimTimer();

  const animConfig = ANIMATION_CONFIGS[props.animation];
  if (!animConfig) return;

  const frameCount = animConfig.cycle.length;
  const frameDuration = 1000 / BASE_FRAMERATE;

  animTimer = setInterval(() => {
    currentFrameIndex = (currentFrameIndex + 1) % frameCount;
    displayCurrentFrame();
  }, frameDuration);
}

function stopAnimation(): void {
  clearAnimTimer();
}

// ============================================================
// 游戏创建
// ============================================================
function createGame(): void {
  if (!containerRef.value) return;

  const width = containerRef.value.clientWidth || 280;
  const height = containerRef.value.clientHeight || 280;
  const bgColor = getBackgroundColor();

  const sceneConfig = {
    key: 'PreviewScene',
    create() {
      // 赋值给组件级 scene 变量，供 renderCharacter/startAnimation 使用
      scene = this as Phaser.Scene;

      renderCharacter();
      startAnimation();
    },
  };

  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: containerRef.value,
    width,
    height,
    backgroundColor: bgColor,
    pixelArt: true,
    scene: [sceneConfig],
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
  });
}

// ============================================================
// Props 监听
// ============================================================
watch(() => props.parts, () => {
  currentFrameIndex = 0;
  renderCharacter();
}, { deep: true });

watch(() => props.bodyType, () => {
  currentFrameIndex = 0;
  renderCharacter();
});

watch(() => props.animation, () => {
  currentFrameIndex = 0;
  updateFrameIndexes();
  renderCharacter();
  startAnimation();
});

watch(() => props.direction, () => {
  currentFrameIndex = 0;
  updateFrameIndexes();
  renderCharacter();
});

watch(() => props.scale, (newScale) => {
  if (spriteRef) {
    spriteRef.setScale(newScale);
  }
});

// ============================================================
// 生命周期
// ============================================================
onMounted(() => {
  createGame();
});

onUnmounted(() => {
  destroyGame();
});
</script>

<template>
  <div ref="containerRef" class="canvas-preview" />
</template>

<style scoped>
.canvas-preview {
  width: 100%;
  height: 100%;
  min-width: 200px;
  min-height: 200px;
  background-color: var(--ds-bg-base, #0a0a0f);
  border-radius: var(--ds-radius-md, 6px);
  overflow: hidden;
}

.canvas-preview :deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
}
</style>
