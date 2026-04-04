/**
 * useTheme composable
 *
 * Runtime theme switcher that:
 * - Manages current theme (cyberpunk, minimal, professional)
 * - Persists selection to localStorage
 * - Applies CSS custom properties (--stratix-*) to document.documentElement
 * - Provides a themes list for UI rendering
 * - Adds a brief CSS transition overlay during switch to avoid flash
 */

import { ref, computed, onMounted } from 'vue';

import { ThemeRegistry } from '../themes';
import { CyberpunkTheme } from '../themes/cyberpunk';
import { MinimalTheme } from '../themes/minimal';
import { ProfessionalTheme } from '../themes/professional';
import type { DesignSystemTokens, ThemeName } from '../types';

const STORAGE_KEY = 'stratix-theme';
const TRANSITION_CLASS = 'stratix-theme-transitioning';
const TRANSITION_DURATION_MS = 250;

// Theme name → token map
const themeTokens: Record<ThemeName, DesignSystemTokens> = {
  cyberpunk: CyberpunkTheme,
  minimal: MinimalTheme,
  professional: ProfessionalTheme,
};

// Singleton state
const currentThemeName = ref<ThemeName>('cyberpunk');
const isTransitioning = ref(false);

/** Flatten a nested object into CSS custom property entries */
function flattenToCssVars(
  obj: any,
  prefix = '--stratix',
  result: Record<string, string> = {}
): Record<string, string> {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const varName = `${prefix}-${key}`;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flattenToCssVars(value, varName, result);
    } else {
      result[varName] = String(value);
    }
  }
  return result;
}

/** Apply all CSS custom properties from a DesignSystemTokens object to :root */
function applyTokensToRoot(tokens: DesignSystemTokens): void {
  const root = document.documentElement;
  const vars = flattenToCssVars(tokens);
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
}

export interface ThemeOption {
  id: ThemeName;
  name: string;
  description: string;
  preview: {
    primary: string;
    background: string;
    text: string;
  };
}

export function useTheme() {
  const themes = computed<ThemeOption[]>(() =>
    (Object.keys(ThemeRegistry) as ThemeName[]).map((id) => ({
      id: id as ThemeName,
      name: ThemeRegistry[id].name,
      description: ThemeRegistry[id].description,
      preview: ThemeRegistry[id].preview,
    }))
  );

  const currentTheme = computed(() => themeTokens[currentThemeName.value]);

  function setTheme(name: ThemeName): void {
    if (name === currentThemeName.value) return;
    if (isTransitioning.value) return;
    if (typeof document === 'undefined') return;

    // Start transition overlay
    isTransitioning.value = true;
    document.documentElement.classList.add(TRANSITION_CLASS);

    // Apply new theme tokens
    currentThemeName.value = name;
    applyTokensToRoot(themeTokens[name]);

    // Persist to localStorage
    localStorage.setItem(STORAGE_KEY, name);

    // Remove transition overlay after duration
    setTimeout(() => {
      document.documentElement.classList.remove(TRANSITION_CLASS);
      isTransitioning.value = false;
    }, TRANSITION_DURATION_MS);
  }

  function initTheme(): void {
    // Restore from localStorage
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeName | null;
    if (saved && saved in themeTokens) {
      currentThemeName.value = saved;
    }
    applyTokensToRoot(themeTokens[currentThemeName.value]);
  }

  onMounted(() => {
    initTheme();
  });

  return {
    themes,
    currentTheme,
    currentThemeName,
    isTransitioning,
    setTheme,
    initTheme,
  };
}
