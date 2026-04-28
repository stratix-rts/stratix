import { ref } from 'vue';
import type { Ref } from 'vue';

export interface ClipboardState {
  copy: (text: string) => Promise<boolean>;
  copied: Ref<boolean>;
}

export function useClipboard(): ClipboardState {
  const copied = ref(false);
  let resetTimer: ReturnType<typeof setTimeout> | null = null;

  const copy = async (text: string): Promise<boolean> => {
    if (resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = null;
    }

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        copied.value = true;
        resetTimer = setTimeout(() => {
          copied.value = false;
        }, 2000);
        return true;
      }
    } catch {
      // Fallback to execCommand
    }

    // execCommand fallback
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      copied.value = success;
      if (success) {
        resetTimer = setTimeout(() => {
          copied.value = false;
        }, 2000);
      }
      return success;
    } catch {
      document.body.removeChild(textarea);
      copied.value = false;
      return false;
    }
  };

  return { copy, copied };
}
