/**
 * GroundDecorationSystem - 地面装饰系统
 * 管理地表层和装饰物（草地/岩石/树木/水/云）
 */

import Phaser from 'phaser';

import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from '../constants';
import { ThemeManager, ThemeName } from '../themes/ThemeManager';

export interface DecorationConfig {
  /** 装饰物类型 */
  type: 'grass' | 'rock_small' | 'rock_large' | 'flower' | 'tree' | 'water';
  /** 世界坐标 X */
  x: number;
  /** 世界坐标 Y */
  y: number;
  /** 缩放比例 */
  scale?: number;
  /** 深度偏移 */
  depthOffset?: number;
  /** 是否随机旋转 */
  randomRotation?: boolean;
}

export interface GroundDecorationSystemConfig {
  /** 装饰物数量密度（0-1），默认 0.1 */
  density?: number;
  /** 是否显示云朵（UI层） */
  showClouds?: boolean;
  /** 是否启用随机装饰 */
  randomDecorations?: boolean;
}

export class GroundDecorationSystem extends Phaser.Events.EventEmitter {
  private scene: Phaser.Scene;
  private themeManager: ThemeManager;
  private groundTileSprite: Phaser.GameObjects.TileSprite | null = null;
  private decorations: Phaser.GameObjects.Sprite[] = [];
  private cloudLayer: Phaser.GameObjects.Sprite[] = [];
  private config: Required<GroundDecorationSystemConfig>;
  private isInitialized: boolean = false;

  constructor(
    scene: Phaser.Scene,
    themeManager: ThemeManager,
    config: GroundDecorationSystemConfig = {}
  ) {
    super();
    this.scene = scene;
    this.themeManager = themeManager;
    this.config = {
      density: config.density ?? 0.08,
      showClouds: config.showClouds ?? false,
      randomDecorations: config.randomDecorations ?? true,
    };

    // 监听主题切换
    this.themeManager.on('theme:changed', this.onThemeChanged, this);
  }

  /**
   * 初始化地面系统
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // 纹理已在场景 preload() 中加载，这里只需创建地面
    // 等待一帧确保纹理已就绪
    await new Promise(resolve => this.scene.time.delayedCall(100, resolve));

    // 创建地表层
    this.createGroundLayer();

    // 生成随机装饰物
    if (this.config.randomDecorations) {
      this.generateRandomDecorations();
    }

    this.isInitialized = true;
  }

  /**
   * 创建地表层（平铺）
   */
  private createGroundLayer(): void {
    const textureKey = this.themeManager.getTextureKey('ground_base');

    if (!this.scene.textures.exists(textureKey)) {
      console.warn(`[GroundDecorationSystem] Texture not found: ${textureKey}`);
      return;
    }

    // 移除旧的 tile sprite
    if (this.groundTileSprite) {
      this.groundTileSprite.destroy();
    }

    // 创建新的 tile sprite 覆盖整个地图
    this.groundTileSprite = this.scene.add.tileSprite(
      MAP_WIDTH / 2,
      MAP_HEIGHT / 2,
      MAP_WIDTH,
      MAP_HEIGHT,
      textureKey
    );
    this.groundTileSprite.setDepth(0);
    this.groundTileSprite.setOrigin(0.5, 0.5);
  }

  /**
   * 生成随机装饰物
   */
  private generateRandomDecorations(): void {
    // 根据密度计算装饰物数量
    const totalArea = MAP_WIDTH * MAP_HEIGHT;
    const tileArea = TILE_SIZE * TILE_SIZE;
    const totalTiles = Math.floor(totalArea / tileArea);
    const decorationCount = Math.floor(totalTiles * this.config.density);

    // 装饰物类型权重
    const typeWeights: { type: DecorationConfig['type']; weight: number }[] = [
      { type: 'grass', weight: 40 },
      { type: 'rock_small', weight: 15 },
      { type: 'rock_large', weight: 8 },
      { type: 'flower', weight: 20 },
      { type: 'tree', weight: 10 },
      { type: 'water', weight: 7 },
    ];

    for (let i = 0; i < decorationCount; i++) {
      const x = Phaser.Math.Between(TILE_SIZE, MAP_WIDTH - TILE_SIZE);
      const y = Phaser.Math.Between(TILE_SIZE, MAP_HEIGHT - TILE_SIZE);

      // 根据权重随机选择类型
      const type = this.pickWeightedRandom(typeWeights);

      // 跳过水（避免重叠），每个水洼间隔至少 200px
      if (type === 'water' && this.hasNearbyDecoration(x, y, 200, 'water')) {
        continue;
      }

      // 树和大型岩石需要更大间距
      const minDist = type === 'tree' || type === 'rock_large' ? 80 : 40;
      if (this.hasNearbyDecoration(x, y, minDist)) {
        continue;
      }

      this.addDecoration({
        type,
        x,
        y,
        scale: this.getRandomScale(type),
        randomRotation: type !== 'water',
      });
    }
  }

  /**
   * 获取装饰物的随机缩放
   */
  private getRandomScale(type: DecorationConfig['type']): number {
    switch (type) {
      case 'tree':
        return Phaser.Math.FloatBetween(0.8, 1.4);
      case 'rock_large':
        return Phaser.Math.FloatBetween(0.7, 1.2);
      case 'grass':
        return Phaser.Math.FloatBetween(0.5, 1.0);
      default:
        return Phaser.Math.FloatBetween(0.6, 1.1);
    }
  }

  /**
   * 加权随机选择
   */
  private pickWeightedRandom(
    items: { type: DecorationConfig['type']; weight: number }[]
  ): DecorationConfig['type'] {
    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    let random = Phaser.Math.Between(1, totalWeight);

    for (const item of items) {
      random -= item.weight;
      if (random <= 0) {
        return item.type;
      }
    }

    return items[0].type;
  }

  /**
   * 检查附近是否有指定类型的装饰物
   */
  private hasNearbyDecoration(
    x: number,
    y: number,
    minDist: number,
    type?: DecorationConfig['type']
  ): boolean {
    for (const deco of this.decorations) {
      if (type) {
        const decoType = deco.getData('decorationType') as DecorationConfig['type'];
        if (decoType !== type) continue;
      }

      const dist = Phaser.Math.Distance.Between(x, y, deco.x, deco.y);
      if (dist < minDist) {
        return true;
      }
    }
    return false;
  }

  /**
   * 添加单个装饰物
   */
  private addDecoration(config: DecorationConfig): void {
    const textureName = this.getTextureNameForType(config.type);
    const textureKey = this.themeManager.getTextureKey(textureName);

    if (!this.scene.textures.exists(textureKey)) {
      return;
    }

    const sprite = this.scene.add.sprite(config.x, config.y, textureKey);
    sprite.setScale(config.scale ?? 1);

    if (config.randomRotation) {
      sprite.setRotation(Phaser.Math.FloatBetween(-0.3, 0.3));
    }

    // 设置深度
    const baseDepth = this.getDepthForType(config.type);
    sprite.setDepth(baseDepth + (config.depthOffset ?? 0));

    // 存储类型数据
    sprite.setData('decorationType', config.type);

    // 对于树木，添加轻微的漂浮动画
    if (config.type === 'tree') {
      this.scene.tweens.add({
        targets: sprite,
        y: config.y - 3,
        duration: 2000 + Math.random() * 1000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    this.decorations.push(sprite);
  }

  /**
   * 获取装饰物类型的纹理名称
   */
  private getTextureNameForType(type: DecorationConfig['type']): 'grass_tuft' | 'rock_small' | 'rock_large' | 'flower' | 'tree' | 'water' {
    switch (type) {
      case 'grass':
        return 'grass_tuft';
      case 'rock_small':
        return 'rock_small';
      case 'rock_large':
        return 'rock_large';
      case 'flower':
        return 'flower';
      case 'tree':
        return 'tree';
      case 'water':
        return 'water';
    }
  }

  /**
   * 获取装饰物的基础深度
   */
  private getDepthForType(type: DecorationConfig['type']): number {
    switch (type) {
      case 'water':
        return 1;
      case 'grass':
        return 2;
      case 'flower':
        return 3;
      case 'rock_small':
        return 4;
      case 'rock_large':
        return 5;
      case 'tree':
        return 6;
      default:
        return 2;
    }
  }

  /**
   * 主题切换回调
   */
  private async onThemeChanged(_event: { oldTheme: ThemeName; newTheme: ThemeName }): Promise<void> {
    await this.preloadCurrentThemeTextures();

    // 更新地表层
    this.createGroundLayer();

    // 重新生成装饰物（使用新主题纹理）
    this.refreshDecorations();
  }

  /**
   * 预加载当前主题的装饰纹理
   */
  private async preloadCurrentThemeTextures(): Promise<void> {
    const types: DecorationConfig['type'][] = [
      'grass',
      'rock_small',
      'rock_large',
      'flower',
      'tree',
      'water',
    ];

    for (const type of types) {
      const textureName = this.getTextureNameForType(type);
      if (!this.themeManager.isTextureLoaded(textureName)) {
        await this.themeManager.preloadTheme(this.themeManager.getCurrentTheme());
        break;
      }
    }
  }

  /**
   * 刷新所有装饰物（切换主题时调用）
   */
  private refreshDecorations(): void {
    // 清除旧装饰物
    for (const deco of this.decorations) {
      deco.destroy();
    }
    this.decorations = [];

    // 重新生成
    this.generateRandomDecorations();
  }

  /**
   * 手动添加装饰物
   */
  addDecorationAt(
    type: DecorationConfig['type'],
    x: number,
    y: number,
    config: Partial<DecorationConfig> = {}
  ): void {
    this.addDecoration({
      type,
      x,
      y,
      scale: config.scale ?? this.getRandomScale(type),
      randomRotation: config.randomRotation ?? true,
      ...config,
    });
  }

  /**
   * 清除所有装饰物
   */
  clearDecorations(): void {
    for (const deco of this.decorations) {
      deco.destroy();
    }
    this.decorations = [];
  }

  /**
   * 获取所有装饰物
   */
  getDecorations(): Phaser.GameObjects.Sprite[] {
    return this.decorations;
  }

  /**
   * 销毁系统
   */
  destroy(): void {
    this.themeManager.off('theme:changed', this.onThemeChanged, this);

    for (const deco of this.decorations) {
      deco.destroy();
    }
    this.decorations = [];

    for (const cloud of this.cloudLayer) {
      cloud.destroy();
    }
    this.cloudLayer = [];

    if (this.groundTileSprite) {
      this.groundTileSprite.destroy();
    }
  }
}
