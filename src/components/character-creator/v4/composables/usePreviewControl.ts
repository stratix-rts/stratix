/**
 * usePreviewControl - 预览控制状态管理
 * 管理动画、方向、缩放和播放状态
 * 接口与 V2/V3 完全一致
 */

import { ref } from 'vue';
import type { AnimationName } from '@/stratix-character-creator/constants';

const DEFAULT_ANIMATION: AnimationName = 'idle';
const DEFAULT_DIRECTION = 2;
const DEFAULT_SCALE = 3;
const SCALE_STEP = 0.5;
const MIN_SCALE = 1;
const MAX_SCALE = 8;

export function usePreviewControl() {
  const animation = ref<AnimationName>(DEFAULT_ANIMATION);
  const direction = ref(DEFAULT_DIRECTION);
  const scale = ref(DEFAULT_SCALE);
  const isPlaying = ref(true);

  function setAnimation(value: AnimationName) {
    animation.value = value;
  }

  function setDirection(value: number) {
    direction.value = value;
  }

  function setScale(value: number) {
    scale.value = Math.max(MIN_SCALE, Math.min(MAX_SCALE, value));
  }

  function togglePlay() {
    isPlaying.value = !isPlaying.value;
  }

  function cycleDirection() {
    direction.value = (direction.value + 1) % 4;
  }

  function zoomIn() {
    setScale(scale.value + SCALE_STEP);
  }

  function zoomOut() {
    setScale(scale.value - SCALE_STEP);
  }

  return {
    animation,
    direction,
    scale,
    isPlaying,
    setAnimation,
    setDirection,
    setScale,
    togglePlay,
    cycleDirection,
    zoomIn,
    zoomOut,
  };
}
