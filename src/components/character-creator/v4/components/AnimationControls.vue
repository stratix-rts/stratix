<script setup lang="ts">
/**
 * AnimationControls.vue — 动画/方向/缩放控制 (V4)
 *
 * 动画选择按钮组、方向循环按钮、缩放 ±、播放/暂停。
 * Props/Emits 与 V3 一致，样式全部使用 var(--ds-*) tokens。
 *
 * 美学约束: A1-A8
 * A1 — spacing tokens only, 嵌套内间距递减
 * A2 — flex/grid 布局, 显式对齐
 * A3 — ds tokens, typography/radii tokens
 * A4 — 8px 基准尺寸
 * A5 — 标题 12px/500 → 内容 11px/400, 单一视觉焦点
 * A6 — 选择器 ≤3 层, 样式属性 ≤15
 * A7 — 留白充足
 * A8 — 按钮等尺寸, 网格等宽
 */

import { computed } from 'vue';
import {
  type AnimationName,
} from '@/stratix-character-creator/constants';

// ============================================================================
// Props & Emits
// ============================================================================

const props = defineProps<{
  animation: AnimationName;
  direction: number;
  scale: number;
  isPlaying: boolean;
}>();

const emit = defineEmits<{
  'set-animation': [value: AnimationName];
  'set-direction': [value: number];
  'set-scale': [value: number];
  'toggle-play': [];
}>();

// ============================================================================
// 常量
// ============================================================================

const DISPLAY_ANIMATIONS: AnimationName[] = [
  'idle',
  'walk',
  'run',
  'slash',
  'shoot',
  'spellcast',
  'combat_idle',
];

const ANIMATION_LABELS: Record<AnimationName, string> = {
  idle: '待机',
  walk: '行走',
  run: '奔跑',
  spellcast: '施法',
  thrust: '刺击',
  slash: '挥砍',
  shoot: '射击',
  hurt: '受伤',
  climb: '攀爬',
  jump: '跳跃',
  sit: '坐下',
  emote: '表情',
  combat_idle: '战斗待机',
  backslash: '反挥',
  halfslash: '半挥',
};

const DIRECTION_LABELS = ['↑', '→', '↓', '←'];

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
const SCALE_STEP = 0.5;

// ============================================================================
// 计算属性
// ============================================================================

const canZoomIn = computed(() => props.scale < MAX_SCALE);
const canZoomOut = computed(() => props.scale > MIN_SCALE);

// ============================================================================
// 方法
// ============================================================================

function selectAnimation(anim: AnimationName): void {
  emit('set-animation', anim);
}

function cycleDirection(): void {
  emit('set-direction', (props.direction + 1) % 4);
}

function zoomIn(): void {
  emit('set-scale', Math.min(props.scale + SCALE_STEP, MAX_SCALE));
}

function zoomOut(): void {
  emit('set-scale', Math.max(props.scale - SCALE_STEP, MIN_SCALE));
}

function togglePlay(): void {
  emit('toggle-play');
}
</script>

<template>
  <div class="ac">
    <!-- ================================================================
         动画选择
    ================================================================ -->
    <div class="ac-section">
      <span class="ac-section__label">动画</span>
      <div class="ac-anim-grid">
        <button
          v-for="anim in DISPLAY_ANIMATIONS"
          :key="anim"
          :class="['ac-anim-btn', { 'ac-anim-btn--active': animation === anim }]"
          @click="selectAnimation(anim)"
        >
          {{ ANIMATION_LABELS[anim] }}
        </button>
      </div>
    </div>

    <!-- ================================================================
         方向 · 缩放 · 播放
    ================================================================ -->
    <div class="ac-row">
      <!-- 方向 -->
      <div class="ac-group">
        <span class="ac-group__label">方向</span>
        <button
          class="ac-dir-btn"
          :title="`当前: ${DIRECTION_LABELS[direction]}`"
          @click="cycleDirection"
        >
          {{ DIRECTION_LABELS[direction] }}
        </button>
      </div>

      <!-- 缩放 -->
      <div class="ac-group">
        <span class="ac-group__label">缩放</span>
        <div class="ac-scale">
          <button
            class="ac-scale__btn"
            :disabled="!canZoomOut"
            title="缩小"
            @click="zoomOut"
          >
            −
          </button>
          <span class="ac-scale__value">{{ scale.toFixed(1) }}×</span>
          <button
            class="ac-scale__btn"
            :disabled="!canZoomIn"
            title="放大"
            @click="zoomIn"
          >
            +
          </button>
        </div>
      </div>

      <!-- 播放/暂停 -->
      <div class="ac-group">
        <span class="ac-group__label">播放</span>
        <button
          :class="['ac-play-btn', { 'ac-play-btn--playing': isPlaying }]"
          @click="togglePlay"
        >
          {{ isPlaying ? '⏸' : '▶' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ==========================================================================
   根容器
   A2: flex column  A1: gap/padding tokens
========================================================================== */
.ac {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-sm, 8px);
  padding: var(--ds-spacing-sm, 8px);
  background: var(--ds-bg-secondary, #1a1a2e);
  border: 1px solid var(--ds-border, #333);
  border-radius: var(--ds-radius-lg, 8px);
}

/* ==========================================================================
   区块标题
   A5: 层级 10px/uppercase  A3: text-muted
========================================================================== */
.ac-section__label,
.ac-group__label {
  display: block;
  font-size: var(--ds-typography-fontSize-xs, 10px);
  color: var(--ds-text-muted, #666);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  line-height: 1.5;
}

/* ==========================================================================
   动画区块
========================================================================== */
.ac-section {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-xs, 4px);
}

/* A2: grid auto-fill  A4: minmax 等宽  A8: 网格等宽等高 */
.ac-anim-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  gap: var(--ds-spacing-xs, 4px);
}

/* A6: ≤15 属性  A3: tokens only */
.ac-anim-btn {
  padding: var(--ds-spacing-xs, 4px) var(--ds-spacing-sm, 8px);
  background: var(--ds-bg-tertiary, #252540);
  border: 1px solid var(--ds-border, #333);
  border-radius: var(--ds-radius-md, 4px);
  color: var(--ds-text-secondary, #aaa);
  font-size: var(--ds-typography-fontSize-xs, 10px);
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
}

.ac-anim-btn:hover {
  border-color: var(--ds-color-primary, #00d4ff);
  color: var(--ds-color-primary, #00d4ff);
}

.ac-anim-btn--active {
  background: var(--ds-color-primary, #00d4ff);
  border-color: var(--ds-color-primary, #00d4ff);
  color: var(--ds-text-on-accent, #000);
}

.ac-anim-btn--active:hover {
  background: var(--ds-color-primary, #00d4ff);
  color: var(--ds-text-on-accent, #000);
}

/* ==========================================================================
   控制行 — 方向 / 缩放 / 播放
   A2: flex row  A1: gap token
========================================================================== */
.ac-row {
  display: flex;
  align-items: flex-end;
  gap: var(--ds-spacing-sm, 8px);
  flex-wrap: wrap;
}

.ac-group {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-xs, 4px);
}

/* ==========================================================================
   方向按钮
   A4: 32×32 (8px 基准)  A8: 等尺寸
========================================================================== */
.ac-dir-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ds-bg-tertiary, #252540);
  border: 1px solid var(--ds-border, #333);
  border-radius: var(--ds-radius-md, 4px);
  color: var(--ds-text-primary, #eee);
  font-size: var(--ds-typography-fontSize-lg, 16px);
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.ac-dir-btn:hover {
  border-color: var(--ds-color-primary, #00d4ff);
  background: var(--ds-color-primary, #00d4ff);
  color: var(--ds-text-on-accent, #000);
}

/* ==========================================================================
   缩放控制
   A4: 24×24 按钮 (8px 基准)  A2: flex row centered
========================================================================== */
.ac-scale {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-xs, 4px);
}

.ac-scale__btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ds-bg-tertiary, #252540);
  border: 1px solid var(--ds-border, #333);
  border-radius: var(--ds-radius-md, 4px);
  color: var(--ds-text-primary, #eee);
  font-size: var(--ds-typography-fontSize-md, 14px);
  font-weight: var(--ds-typography-fontWeight-bold, 700);
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.ac-scale__btn:hover:not(:disabled) {
  border-color: var(--ds-color-primary, #00d4ff);
  color: var(--ds-color-primary, #00d4ff);
}

.ac-scale__btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ac-scale__value {
  font-size: var(--ds-typography-fontSize-xs, 10px);
  color: var(--ds-text-primary, #eee);
  min-width: 32px;
  text-align: center;
}

/* ==========================================================================
   播放/暂停按钮
   A4: 32×32  A8: 与方向按钮等尺寸
========================================================================== */
.ac-play-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ds-bg-tertiary, #252540);
  border: 1px solid var(--ds-border, #333);
  border-radius: var(--ds-radius-md, 4px);
  color: var(--ds-text-primary, #eee);
  font-size: var(--ds-typography-fontSize-sm, 12px);
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.ac-play-btn:hover {
  border-color: var(--ds-color-primary, #00d4ff);
  background: var(--ds-color-primary, #00d4ff);
  color: var(--ds-text-on-accent, #000);
}

.ac-play-btn--playing {
  background: var(--ds-color-secondary, #7b61ff);
  border-color: var(--ds-color-secondary, #7b61ff);
  color: var(--ds-text-on-accent, #000);
}

.ac-play-btn--playing:hover {
  background: var(--ds-color-secondary, #7b61ff);
  border-color: var(--ds-color-secondary, #7b61ff);
  color: var(--ds-text-on-accent, #000);
}
</style>
