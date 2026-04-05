/**
 * useAutoRefresh — 面板级自动刷新 composable
 *
 * - 组件挂载时启动 interval 轮询
 * - 页面不可见时暂停（visibilitychange）
 * - 组件卸载时自动清理
 * - 返回手动触发方法
 */
import { onMounted, onUnmounted, ref } from 'vue';

export interface AutoRefreshOptions {
  /** 轮询间隔 ms，默认 30000 */
  interval?: number;
  /** 是否立即执行一次，默认 true */
  immediate?: boolean;
}

export function useAutoRefresh(
  callback: () => Promise<void>,
  options: AutoRefreshOptions = {}
) {
  const { interval = 30000, immediate = true } = options;

  const refreshing = ref(false);
  let timer: ReturnType<typeof setInterval> | null = null;
  let isVisible = true;

  async function refresh() {
    if (!isVisible || refreshing.value) return;
    refreshing.value = true;
    try {
      await callback();
    } finally {
      refreshing.value = false;
    }
  }

  function handleVisibility() {
    isVisible = document.visibilityState === 'visible';
  }

  function start() {
    stop();
    timer = setInterval(() => {
      if (isVisible) refresh();
    }, interval);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', handleVisibility);
    if (immediate) refresh();
    start();
  });

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', handleVisibility);
    stop();
  });

  return { refreshing, refresh, start, stop };
}
