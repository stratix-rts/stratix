/**
 * ThemeManager - 主题切换管理器
 * 管理四套皮肤纹理的加载和切换
 * 新增：监听 Vue design-system 主题变化，同步到 Phaser 场景
 */

import Phaser from 'phaser';

import { getDSColor, initThemeRuntime, isReducedMotion, onReducedMotionChange } from './ThemeColors';

export type ThemeName = 'fantasy' | 'cartoon' | 'cyberpunk' | 'nature';

export interface ThemeTextureSet {
  ground_base: string;
  ground_dark: string;
  ground_light: string;
  grass_tuft: string;
  rock_small: string;
  rock_large: string;
  flower: string;
  tree: string;
  water: string;
  cloud: string;
}

export interface ThemeConfig {
  name: string;
  displayName: string;
  textures: ThemeTextureSet;
}

// 纹理路径配置
const TEXTURE_BASE_PATH = 'rts-textures';

function getTexturePaths(theme: ThemeName): ThemeTextureSet {
  const base = `${TEXTURE_BASE_PATH}/${theme}`;
  return {
    ground_base: `${base}/ground_base.png`,
    ground_dark: `${base}/ground_dark.png`,
    ground_light: `${base}/ground_light.png`,
    grass_tuft: `${base}/grass_tuft.png`,
    rock_small: `${base}/rock_small.png`,
    rock_large: `${base}/rock_large.png`,
    flower: `${base}/flower.png`,
    tree: `${base}/tree.png`,
    water: `${base}/water.png`,
    cloud: `${base}/cloud.png`,
  };
}

export const THEMES: Record<ThemeName, ThemeConfig> = {
  fantasy: {
    name: 'fantasy',
    displayName: 'Fantasy',
    textures: getTexturePaths('fantasy'),
  },
  cartoon: {
    name: 'cartoon',
    displayName: 'Cartoon',
    textures: getTexturePaths('cartoon'),
  },
  cyberpunk: {
    name: 'cyberpunk',
    displayName: 'Cyberpunk',
    textures: getTexturePaths('cyberpunk'),
  },
  nature: {
    name: 'nature',
    displayName: 'Nature',
    textures: getTexturePaths('nature'),
  },
};

export class ThemeManager extends Phaser.Events.EventEmitter {
  private scene: Phaser.Scene;
  private currentTheme: ThemeName = 'fantasy';
  private loadedThemes: Set<ThemeName> = new Set();
  private dsThemeName: string = 'cyberpunk';
  private reducedMotion: boolean = false;
  private _removeMotionListener: (() => void) | null = null;
  private _removeThemeListener: (() => void) | null = null;
  private transitionOverlay: Phaser.GameObjects.Graphics | null = null;

  constructor(scene: Phaser.Scene) {
    super();
    this.scene = scene;
    this.reducedMotion = isReducedMotion();
    this.setupListeners();
  }

  private setupListeners(): void {
    initThemeRuntime();

    // Listen to design system theme:change events from Vue
    if (typeof window !== 'undefined') {
      const themeHandler = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (detail?.theme && detail.theme !== this.dsThemeName) {
          this.dsThemeName = detail.theme;
          this.emit('dsTheme:changed', {
            theme: detail.theme,
            tokens: detail.tokens,
            semantic: detail.semantic,
          });
          this.playTransitionEffect();
        }
      };
      window.addEventListener('theme:change', themeHandler);
      this._removeThemeListener = () => window.removeEventListener('theme:change', themeHandler);
    }

    // Listen to prefers-reduced-motion changes
    this._removeMotionListener = onReducedMotionChange((reduced) => {
      this.reducedMotion = reduced;
      this.emit('motionPreference:changed', { reduced });
    });
  }

  /** Play a brief flash transition when theme changes */
  private playTransitionEffect(): void {
    if (this.reducedMotion) return;
    if (!this.scene || this.scene.scene.isPaused?.()) return;

    if (!this.transitionOverlay) {
      this.transitionOverlay = this.scene.add.graphics();
      this.transitionOverlay.setDepth(10000);
    }

    const cam = this.scene.cameras.main;
    const width = cam.width || 1600;
    const height = cam.height || 960;
    const primaryColor = getDSColor('color-primary');

    this.transitionOverlay.clear();
    this.transitionOverlay.fillStyle(primaryColor, 0.15);
    this.transitionOverlay.fillRect(0, 0, width, height);
    this.transitionOverlay.setAlpha(0);

    this.scene.tweens.add({
      targets: this.transitionOverlay,
      alpha: { from: 0, to: 1 },
      duration: 150,
      yoyo: true,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        this.transitionOverlay?.clear();
      },
    });
  }

  /**
   * 获取当前主题
   */
  getCurrentTheme(): ThemeName {
    return this.currentTheme;
  }

  /**
   * 获取当前 design system 主题名
   */
  getDSThemeName(): string {
    return this.dsThemeName;
  }

  /**
   * 获取是否减少动画
   */
  getReducedMotion(): boolean {
    return this.reducedMotion;
  }

  /**
   * 获取当前主题配置
   */
  getThemeConfig(): ThemeConfig {
    return THEMES[this.currentTheme];
  }

  /**
   * 获取纹理 key（用于 Phaser 引用）
   */
  getTextureKey(textureName: keyof ThemeTextureSet): string {
    // Key 格式: fantasy_ground_base
    return `${this.currentTheme}_${textureName}`;
  }

  /**
   * 预加载指定主题纹理（在 preload 阶段调用）
   */
  async preloadTheme(theme: ThemeName): Promise<void> {
    if (this.loadedThemes.has(theme)) {
      return Promise.resolve();
    }

    const paths = getTexturePaths(theme);
    const textureKeys: string[] = [];

    // 构建 Phaser 能识别的 key 和路径
    for (const [key, filePath] of Object.entries(paths)) {
      const textureKey = `${theme}_${key}`;
      textureKeys.push(textureKey);
      this.scene.load.image(textureKey, filePath);
    }

    return new Promise<void>((resolve) => {
      if (textureKeys.length === 0) {
        resolve();
        return;
      }

      // 使用 scene.load.once 监听这一批加载完成
      this.scene.load.once('complete', () => {
        this.loadedThemes.add(theme);
        console.log(`[ThemeManager] Loaded theme: ${theme}`);
        resolve();
      });

      this.scene.load.start();
    });
  }

  /**
   * 运行时加载主题纹理（用于主题切换）
   */
  async loadThemeRuntime(theme: ThemeName): Promise<void> {
    if (this.loadedThemes.has(theme)) {
      return Promise.resolve();
    }

    const paths = getTexturePaths(theme);

    // 加载新纹理
    for (const [key, filePath] of Object.entries(paths)) {
      const textureKey = `${theme}_${key}`;
      if (!this.scene.textures.exists(textureKey)) {
        this.scene.load.image(textureKey, filePath);
      }
    }

    return new Promise<void>((resolve) => {
      this.scene.load.once('complete', () => {
        this.loadedThemes.add(theme);
        console.log(`[ThemeManager] Runtime loaded theme: ${theme}`);
        resolve();
      });
      this.scene.load.start();
    });
  }

  /**
   * 切换主题
   */
  async setTheme(theme: ThemeName): Promise<void> {
    if (theme === this.currentTheme) {
      return;
    }

    // 如果主题未加载，运行时加载
    if (!this.loadedThemes.has(theme)) {
      await this.loadThemeRuntime(theme);
    }

    const oldTheme = this.currentTheme;
    this.currentTheme = theme;

    this.emit('theme:changed', {
      oldTheme,
      newTheme: theme,
      config: THEMES[theme],
    });
  }

  /**
   * 检查纹理是否已加载
   */
  isTextureLoaded(textureName: keyof ThemeTextureSet): boolean {
    const key = `${this.currentTheme}_${textureName}`;
    return this.scene.textures.exists(key);
  }

  destroy(): void {
    this._removeThemeListener?.();
    this._removeMotionListener?.();
    this.transitionOverlay?.destroy();
    this.transitionOverlay = null;
    this.removeAllListeners();
  }
}
