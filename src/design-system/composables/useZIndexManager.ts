/**
 * z-index 全局管理器
 * 设计系统级别，所有弹窗共享
 */

const BASE_Z_INDEX = 3000;
let zIndexCounter = 0;

export interface ZIndexManager {
  acquire: () => number;
  release: () => void;
  current: () => number;
}

export function useZIndexManager(): ZIndexManager {
  return {
    acquire: () => {
      zIndexCounter += 1;
      return BASE_Z_INDEX + zIndexCounter;
    },
    release: () => {
      if (zIndexCounter > 0) {
        zIndexCounter -= 1;
      }
    },
    current: () => BASE_Z_INDEX + zIndexCounter,
  };
}

export function resetZIndexCounter(): void {
  zIndexCounter = 0;
}

export function getZIndexCounter(): number {
  return zIndexCounter;
}
