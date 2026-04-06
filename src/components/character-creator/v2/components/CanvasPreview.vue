<script setup lang="ts">
/**
 * CanvasPreview.vue - Phaser Canvas 预览组件
 *
 * V2 中唯一接触 Phaser 的组件。
 * 职责：接收 props → 调用 characterComposer 合成纹理 → 更新 Canvas 显示
 */

import { ref, watch, onMounted, onUnmounted } from 'vue';
import Phaser from 'phaser';
import { characterComposer } from '@/stratix-character-creator/core/CharacterComposer';
import {
  FRAME_SIZE,
  SHEET_WIDTH,
  SHEET_HEIGHT,
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

const containerRef = ref<HTMLDivElement | null>(null);
const game = ref<Phaser.Game | null>(null);
const previewScene = ref<Phaser.Scene | null>(null);

// 内部状态
const currentAnimation = ref<AnimationName>(props.animation);
const currentDirection = ref<number>(props.direction);
const currentScale = ref<number>(props.scale);

// animation frame tracking
const currentFrame = ref<number>(0);
let animationTimer: number | null = null;

const FRAMES_PER_ROW = 13;
const BASE_FRAMERATE = 8;

function getThemeColor(tokenPath: string): string {
  return getToken(tokenPath) ?? '#000000';
}

function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

function getBackgroundColor(): number {
  return hexToNumber(getThemeColor('colors.background.base'));
}

async function renderCharacter(): Promise<void> {
  if (!previewScene.value || !game.value) return;

  try {
    const result = await characterComposer.composeCharacter(props.parts, {
      bodyType: props.bodyType,
    });

    const textureKey = 'char_preview_texture';
    const scene = previewScene.value;

    // Remove existing texture
    if (scene.textures.exists(textureKey)) {
      scene.textures.remove(textureKey);
    }

    // Create canvas texture from composed character
    const texture = scene.textures.createCanvas(textureKey, SHEET_WIDTH, SHEET_HEIGHT);
    if (!texture) return;

    const ctx = texture.getContext();
    ctx.drawImage(result.canvas, 0, 0);
    texture.refresh();

    // Get animation config
    const animConfig = ANIMATION_CONFIGS[currentAnimation.value];
    if (!animConfig) return;

    const { row, cycle } = animConfig;
    const lpcRow = LOGICAL_TO_LPC[currentDirection.value] ?? 2;
    const dirRow = row + lpcRow;

    // Build frame indexes from cycle
    const frameIndexes = cycle.map(col => dirRow * FRAMES_PER_ROW + col);

    // Create frame textures and display first frame
    displayFrame(textureKey, frameIndexes, currentFrame.value);
  } catch (error) {
    console.error('[CanvasPreview] Failed to render character:', error);
  }
}

function displayFrame(textureKey: string, frameIndexes: number[], frameIdx: number): void {
  const scene = previewScene.value;
  if (!scene) return;

  // Clear existing game objects in scene
  scene.cameras.main.clearRenderList();
  scene.children.list.forEach(obj => obj.destroy(true));

  const frameIndex = frameIndexes[frameIdx % frameIndexes.length];

  const srcX = (frameIndex % FRAMES_PER_ROW) * FRAME_SIZE;
  const srcY = Math.floor(frameIndex / FRAMES_PER_ROW) * FRAME_SIZE;

  // Create frame canvas
  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = FRAME_SIZE;
  frameCanvas.height = FRAME_SIZE;
  const ctx = frameCanvas.getContext('2d');
  if (!ctx) return;

  // Get source texture
  const sourceTexture = scene.textures.get(textureKey);
  if (!sourceTexture || !(sourceTexture instanceof Phaser.Textures.CanvasTexture)) return;

  // Draw the frame
  ctx.drawImage(
    sourceTexture.canvas,
    srcX, srcY, FRAME_SIZE, FRAME_SIZE,
    0, 0, FRAME_SIZE, FRAME_SIZE
  );

  // Create frame texture
  const frameTextureKey = 'char_frame';
  if (scene.textures.exists(frameTextureKey)) {
    scene.textures.remove(frameTextureKey);
  }

  scene.textures.addCanvas(frameTextureKey, frameCanvas);

  // Add sprite centered in canvas
  const camera = scene.cameras.main;
  const centerX = camera.width / 2;
  const centerY = camera.height / 2;

  const sprite = scene.add.sprite(centerX, centerY, frameTextureKey);
  sprite.setScale(currentScale.value);
  sprite.setOrigin(0.5, 0.5);
}

function startAnimation(): void {
  stopAnimation();

  const animConfig = ANIMATION_CONFIGS[currentAnimation.value];
  if (!animConfig) return;

  const { cycle } = animConfig;
  const frameCount = cycle.length;
  const frameDuration = 1000 / BASE_FRAMERATE;

  let frameIdx = currentFrame.value;

  animationTimer = window.setInterval(() => {
    frameIdx = (frameIdx + 1) % frameCount;
    currentFrame.value = frameIdx;

    // Re-render current frame
    if (previewScene.value) {
      const textureKey = 'char_preview_texture';
      if (!previewScene.value.textures.exists(textureKey)) return;

      const { row } = animConfig;
      const lpcRow = LOGICAL_TO_LPC[currentDirection.value] ?? 2;
      const dirRow = row + lpcRow;
      const frameIndexes = cycle.map(col => dirRow * FRAMES_PER_ROW + col);

      displayFrame(textureKey, frameIndexes, frameIdx);
    }
  }, frameDuration);
}

function stopAnimation(): void {
  if (animationTimer !== null) {
    clearInterval(animationTimer);
    animationTimer = null;
  }
}

function createGame(): void {
  if (!containerRef.value) return;

  const bgColor = getBackgroundColor();

  const sceneConfig: Phaser.Types.Scenes.SceneConfig = {
    key: 'PreviewScene',
    create: () => {
      previewScene.value = game.value?.scene.getScene('PreviewScene') ?? null;
      renderCharacter();
    },
  };

  game.value = new Phaser.Game({
    type: Phaser.AUTO,
    parent: containerRef.value,
    width: containerRef.value.clientWidth || 280,
    height: containerRef.value.clientHeight || 280,
    backgroundColor: bgColor,
    pixelArt: true,
    scene: [sceneConfig],
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
  });
}

function destroyGame(): void {
  stopAnimation();
  if (game.value) {
    game.value.destroy(true);
    game.value = null;
    previewScene.value = null;
  }
}

// Watch props changes
watch(() => props.parts, () => {
  currentFrame.value = 0;
  renderCharacter();
}, { deep: true });

watch(() => props.bodyType, () => {
  currentFrame.value = 0;
  renderCharacter();
});

watch(() => props.animation, (newAnim) => {
  currentAnimation.value = newAnim;
  currentFrame.value = 0;
  renderCharacter();
  // Restart animation if playing
  if (animationTimer !== null) {
    startAnimation();
  }
});

watch(() => props.direction, (newDir) => {
  currentDirection.value = newDir;
  currentFrame.value = 0;
  renderCharacter();
});

watch(() => props.scale, (newScale) => {
  currentScale.value = newScale;
  if (previewScene.value) {
    const sprites = previewScene.value.children.list.filter(
      obj => obj instanceof Phaser.GameObjects.Sprite
    ) as Phaser.GameObjects.Sprite[];
    sprites.forEach(sprite => sprite.setScale(newScale));
  }
});

onMounted(() => {
  createGame();
});

onUnmounted(() => {
  destroyGame();
});
</script>

<template>
  <div
    ref="containerRef"
    class="canvas-preview"
  />
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
