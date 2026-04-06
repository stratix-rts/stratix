<script setup lang="ts">
/**
 * AnimationControls.vue - 动画控制组件
 *
 * 动画选择（ANIMATION_CONFIGS / ANIMATION_NAMES）
 * 方向切换（4方向）
 * 缩放控制（+/-）
 * 播放/暂停
 *
 * 这些控件操作 usePreviewControl 返回的状态
 */

import { computed } from 'vue';
import { StratixButton } from '@/components/ui';
import {
  ALL_ANIMATIONS,
  ANIMATION_CONFIGS,
  type AnimationName,
} from '@/stratix-character-creator/constants';

const props = defineProps<{
  animation: AnimationName;
  direction: number;
  scale: number;
  isPlaying: boolean;
}>();

const emit = defineEmits<{
  'update:animation': [value: AnimationName];
  'update:direction': [value: number];
  'update:scale': [value: number];
  'update:isPlaying': [value: boolean];
  'set-animation': [value: AnimationName];
  'set-direction': [value: number];
  'set-scale': [value: number];
  'toggle-play': [];
  'cycle-direction': [];
  'zoom-in': [];
  'zoom-out': [];
}>();

// 动画名称中文映射
const animationLabels: Record<AnimationName, string> = {
  spellcast: '施法',
  thrust: '刺击',
  walk: '行走',
  slash: '挥砍',
  shoot: '射击',
  hurt: '受伤',
  climb: '攀爬',
  idle: '待机',
  jump: '跳跃',
  sit: '坐下',
  emote: '表情',
  run: '奔跑',
  combat_idle: '战斗待机',
  backslash: '反挥',
  halfslash: '半挥',
};

// 方向标签
const directionLabels = ['↑', '←', '↓', '→'];

// 当前选中动画
const selectedAnimation = computed({
  get: () => props.animation,
  set: (value: AnimationName) => {
    emit('update:animation', value);
    emit('set-animation', value);
  },
});

// 当前方向
const currentDirection = computed({
  get: () => props.direction,
  set: (value: number) => {
    emit('update:direction', value);
    emit('set-direction', value);
  },
});

// 当前缩放
const currentScale = computed({
  get: () => props.scale,
  set: (value: number) => {
    emit('update:scale', value);
    emit('set-scale', value);
  },
});

// 当前播放状态
const playing = computed({
  get: () => props.isPlaying,
  set: (value: boolean) => {
    emit('update:isPlaying', value);
  },
});

// 切换播放/暂停
function togglePlay(): void {
  playing.value = !playing.value;
  emit('toggle-play');
}

// 切换方向
function cycleDirection(): void {
  currentDirection.value = (currentDirection.value + 1) % 4;
  emit('cycle-direction');
}

// 缩放值范围
const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
const SCALE_STEP = 0.5;

// 放大
function zoomIn(): void {
  const newScale = Math.min(currentScale.value + SCALE_STEP, MAX_SCALE);
  currentScale.value = newScale;
  emit('zoom-in');
}

// 缩小
function zoomOut(): void {
  const newScale = Math.max(currentScale.value - SCALE_STEP, MIN_SCALE);
  currentScale.value = newScale;
  emit('zoom-out');
}

// 是否可以放大/缩小
const canZoomIn = computed(() => currentScale.value < MAX_SCALE);
const canZoomOut = computed(() => currentScale.value > MIN_SCALE);
</script>

<template>
  <div class="animation-controls">
    <!-- 动画选择 -->
    <div class="control-section">
      <div class="control-section__label">动画</div>
      <div class="animation-grid">
        <button
          v-for="anim in ALL_ANIMATIONS"
          :key="anim"
          class="animation-btn"
          :class="{ 'animation-btn--active': selectedAnimation === anim }"
          @click="selectedAnimation = anim"
        >
          {{ animationLabels[anim] || anim }}
        </button>
      </div>
    </div>

    <!-- 方向和缩放控制 -->
    <div class="control-row">
      <!-- 方向控制 -->
      <div class="control-group">
        <div class="control-group__label">方向</div>
        <div class="direction-controls">
          <button
            class="direction-btn"
            :class="{ 'direction-btn--active': true }"
            @click="cycleDirection"
            :title="`当前: ${directionLabels[currentDirection]}`"
          >
            {{ directionLabels[currentDirection] }}
          </button>
        </div>
      </div>

      <!-- 缩放控制 -->
      <div class="control-group">
        <div class="control-group__label">缩放</div>
        <div class="scale-controls">
          <button
            class="scale-btn"
            :disabled="!canZoomOut"
            @click="zoomOut"
            title="缩小"
          >
            −
          </button>
          <span class="scale-value">{{ currentScale.toFixed(1) }}x</span>
          <button
            class="scale-btn"
            :disabled="!canZoomIn"
            @click="zoomIn"
            title="放大"
          >
            +
          </button>
        </div>
      </div>

      <!-- 播放/暂停 -->
      <div class="control-group">
        <div class="control-group__label">播放</div>
        <button
          class="play-btn"
          :class="{ 'play-btn--playing': playing }"
          @click="togglePlay"
        >
          {{ playing ? '⏸' : '▶' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.animation-controls {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 12px;
  background: var(--ds-bg-secondary);
  border: 1px solid var(--ds-border);
  border-radius: 8px;
  font-family: 'SF Mono', 'Monaco', monospace;
}

.control-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.control-section__label {
  font-size: 11px;
  color: var(--ds-text-muted);
  text-transform: uppercase;
  letter-spacing: 1px;
}

.animation-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(70px, 1fr));
  gap: 6px;
}

.animation-btn {
  padding: 6px 8px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: 4px;
  color: var(--ds-text-secondary);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.animation-btn:hover {
  border-color: var(--ds-color-primary);
  color: var(--ds-color-primary);
}

.animation-btn--active {
  background: var(--ds-color-primary);
  border-color: var(--ds-color-primary);
  color: var(--ds-text-on-accent);
}

.control-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.control-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.control-group__label {
  font-size: 10px;
  color: var(--ds-text-muted);
  text-transform: uppercase;
  letter-spacing: 1px;
}

.direction-controls {
  display: flex;
  gap: 4px;
}

.direction-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: 6px;
  color: var(--ds-text-primary);
  font-size: 16px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.direction-btn:hover {
  border-color: var(--ds-color-primary);
  background: var(--ds-color-primary);
  color: var(--ds-text-on-accent);
}

.direction-btn--active {
  background: var(--ds-color-primary);
  border-color: var(--ds-color-primary);
  color: var(--ds-text-on-accent);
}

.scale-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.scale-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: 4px;
  color: var(--ds-text-primary);
  font-size: 16px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.15s ease;
}

.scale-btn:hover:not(:disabled) {
  border-color: var(--ds-color-primary);
  color: var(--ds-color-primary);
}

.scale-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.scale-value {
  font-size: 12px;
  color: var(--ds-text-primary);
  min-width: 40px;
  text-align: center;
}

.play-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: 6px;
  color: var(--ds-text-primary);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.play-btn:hover {
  border-color: var(--ds-color-primary);
  background: var(--ds-color-primary);
  color: var(--ds-text-on-accent);
}

.play-btn--playing {
  background: var(--ds-color-secondary);
  border-color: var(--ds-color-secondary);
  color: var(--ds-text-on-accent);
}
</style>
