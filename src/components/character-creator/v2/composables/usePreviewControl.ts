/**
 * usePreviewControl - 预览控制状态管理
 * 管理动画、方向、缩放和播放状态
 */

import { ref, computed } from 'vue';
import type { AnimationName } from '@/stratix-character-creator/constants';
import { DEFAULT_ANIMATION, DEFAULT_DIRECTION } from '@/stratix-character-creator/constants';

export interface UsePreviewControlOptions {
  initialAnimation?: AnimationName;
  initialDirection?: number;
  initialScale?: number;
}

export function usePreviewControl(options: UsePreviewControlOptions = {}) {
  const animation = ref<AnimationName>(options.initialAnimation ?? DEFAULT_ANIMATION);
  const direction = ref<number>(options.initialDirection ?? DEFAULT_DIRECTION);
  const scale = ref<number>(options.initialScale ?? 2);
  const isPlaying = ref<boolean>(true);

  function setAnimation(anim: AnimationName): void {
    animation.value = anim;
  }

  function setDirection(dir: number): void {
    direction.value = Math.max(0, Math.min(3, dir));
  }

  function setScale(s: number): void {
    scale.value = Math.max(0.5, Math.min(4, s));
  }

  function togglePlay(): void {
    isPlaying.value = !isPlaying.value;
  }

  function cycleDirection(): number {
    direction.value = (direction.value + 1) % 4;
    return direction.value;
  }

  function zoomIn(): void {
    setScale(scale.value + 0.5);
  }

  function zoomOut(): void {
    setScale(scale.value - 0.5);
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
