/**
 * useSound composable
 *
 * Provides sound feedback API for Vue components.
 * Wraps the singleton SoundService with reactive settings synced to UIStore.
 */

import { computed } from 'vue';
import { soundService } from '@/services/SoundService';
import { useUIStore } from '@/stores/ui';

export function useSound() {
  const uiStore = useUIStore();

  // Load persisted settings on first use
  soundService.loadSettings();

  // Sync enabled state to store
  function setEnabled(enabled: boolean): void {
    soundService.enabled = enabled;
  }

  function setVolume(volume: number): void {
    soundService.volume = volume;
  }

  function playClick(): void {
    soundService.playClick();
  }

  function playTaskComplete(): void {
    soundService.playTaskComplete();
  }

  function playAgentStatusChange(): void {
    soundService.playAgentStatusChange();
  }

  function playWarning(): void {
    soundService.playWarning();
  }

  return {
    enabled: computed({
      get: () => soundService.enabled,
      set: setEnabled,
    }),
    volume: computed({
      get: () => soundService.volume,
      set: setVolume,
    }),
    playClick,
    playTaskComplete,
    playAgentStatusChange,
    playWarning,
  };
}
