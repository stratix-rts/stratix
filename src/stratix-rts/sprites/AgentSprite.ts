import Phaser from 'phaser';
import { StratixAgentConfig } from '../../stratix-core/stratix-protocol';
import { LPC_DIRECTION_ROWS } from '@/stratix-character-creator/constants';
import { getToken, getCurrentTheme } from '@/design-system/config';

export type AgentStatus = 'online' | 'offline' | 'busy' | 'error';
export type CommandStatus = 'pending' | 'running' | 'success' | 'failed';
export type AgentType = 'writer' | 'dev' | 'analyst' | string;

// 辅助函数：将十六进制颜色字符串转换为 Phaser 数字格式
const hexToNumber = (hex: string) => parseInt(hex.replace('#', ''), 16);

// 动态获取主题颜色
const getThemeColors = () => ({
  status: {
    online: hexToNumber(getToken('colors.status.success')),
    offline: hexToNumber(getToken('colors.text.muted')),
    busy: hexToNumber(getToken('colors.status.warning')),
    error: hexToNumber(getToken('colors.status.danger')),
    pending: hexToNumber(getToken('colors.status.info'))
  },
  type: {
    writer: hexToNumber(getToken('colors.brand.secondary')),
    dev: hexToNumber(getToken('colors.brand.primary')),
    analyst: hexToNumber(getToken('colors.status.warning')),
    custom: hexToNumber(getToken('colors.accent'))
  },
  ui: {
    selection: hexToNumber(getToken('colors.status.success'))
  }
});

// 向后兼容：保留 COLORS 对象，但使用 getter 动态获取
export const COLORS = {
  get status() { return getThemeColors().status; },
  get type() { return getThemeColors().type; },
  get ui() { return getThemeColors().ui; }
};

export class AgentSprite extends Phaser.GameObjects.Container {
  private sprite: Phaser.GameObjects.Sprite;
  private nameText: Phaser.GameObjects.Text;
  private statusIndicator: Phaser.GameObjects.Graphics;
  private selectionRing: Phaser.GameObjects.Graphics;
  private typeIcon: Phaser.GameObjects.Graphics;
  private agentId: string;
  private agentName: string;
  private agentType: AgentType;
  private currentStatus: AgentStatus = 'online';
  private isSelected: boolean = false;
  private busyTween: Phaser.Tweens.Tween | null = null;
  private breathingTween: Phaser.Tweens.Tween | null = null;
  private isDragging: boolean = false;
  private dragOffset: { x: number; y: number } = { x: 0, y: 0 };
  private customTextureKey: string | null = null;
  private placeholderTextureKey: string | null = null;
  private characterId: string | null = null;
  private currentDirection: number = 0;
  private currentAnimation: 'idle' | 'walk' | 'run' = 'idle';
  private isUsingPlaceholder: boolean = false;
  private renderMode: 'full' | 'thumbnail' = 'full';
  private thumbnailSprite: Phaser.GameObjects.Image | null = null;
  private thumbnailKey: string | null = null;
  private characterThumbnail: string | null = null;
  private zoneBadge: Phaser.GameObjects.Graphics | null = null;
  private currentZoneId: string | null = null;
  private currentZoneName: string | null = null;

  constructor(
    scene: Phaser.Scene, 
    x: number, 
    y: number, 
    config: StratixAgentConfig,
    textureKey?: string,
    isPlaceholder: boolean = false
  ) {
    super(scene, x, y);
    
    this.agentId = config.agentId;
    this.agentName = config.name;
    this.agentType = config.type;
    this.customTextureKey = textureKey || null;
    this.isUsingPlaceholder = isPlaceholder;
    
    console.log(`[AgentSprite] 🎭 Creating agent ${config.agentId}, textureKey: ${textureKey}, isPlaceholder: ${isPlaceholder}`);
    
    if (config.profile) {
      this.characterId = config.profile.characterId;
      if (config.profile.thumbnail) {
        this.characterThumbnail = config.profile.thumbnail;
      }
    }

    this.selectionRing = scene.add.graphics();
    this.drawSelectionRing();
    this.selectionRing.setVisible(false);
    this.add(this.selectionRing);

    const texture = textureKey || 'stratix-agent';
    this.sprite = scene.add.sprite(0, 0, texture);
    
    console.log(`[AgentSprite] Sprite created with texture: ${texture}`);
    console.log(`[AgentSprite] Sprite bounds:`, this.sprite.getBounds());
    console.log(`[AgentSprite] Sprite displayWidth: ${this.sprite.displayWidth}, displayHeight: ${this.sprite.displayHeight}`);
    
    if (isPlaceholder) {
      this.startBreathingAnimation();
    } else if (textureKey && config.profile) {
      this.sprite.setScale(0.75);
      console.log(`[AgentSprite] Applied scale 0.75, new size: ${this.sprite.displayWidth}x${this.sprite.displayHeight}`);
      this.playAnimation('idle', LPC_DIRECTION_ROWS.RIGHT);
    }
    
    this.add(this.sprite);

    this.typeIcon = scene.add.graphics();
    this.drawTypeIcon(config.type);
    this.add(this.typeIcon);

    this.statusIndicator = scene.add.graphics();
    this.drawStatusIndicator(COLORS.status.online);
    this.add(this.statusIndicator);

    this.nameText = scene.add.text(0, -32, config.name, {
      fontSize: '12px',
      fontFamily: 'Arial, sans-serif',
      color: '#ffffff',
      backgroundColor: '#000000',
      padding: { x: 6, y: 2 }
    });
    this.nameText.setOrigin(0.5);
    this.add(this.nameText);

    this.sprite.setInteractive({ useHandCursor: true });
    this.setData('agentId', config.agentId);
    this.setData('agentType', config.type);
    this.setData('isCustom', !!textureKey);
    
    this.setDepth(y);
  }

  public replaceTexture(newTextureKey: string): void {
    if (!this.scene) return;

    const wasPlaying = this.sprite.anims.isPlaying;
    const currentAnim = this.sprite.anims.currentAnim;
    
    this.customTextureKey = newTextureKey;
    this.isUsingPlaceholder = false;
    
    this.stopBreathingAnimation();
    
    this.scene.tweens.add({
      targets: this,
      scaleX: 0.5,
      scaleY: 0.5,
      duration: 150,
      ease: 'Power2',
      onComplete: () => {
        this.sprite.setTexture(newTextureKey);
        
        if (newTextureKey !== 'stratix-agent' && this.characterId) {
          this.sprite.setScale(0.75);
        }
        
        this.scene.tweens.add({
          targets: this,
          scaleX: 1,
          scaleY: 1,
          duration: 300,
          ease: 'Back.easeOut'
        });
      }
    });

    if (currentAnim) {
      const animName = currentAnim.key.split('_').slice(1, 3).join('_');
      const direction = this.currentDirection;
      this.playAnimation(animName as 'idle' | 'walk' | 'run', direction);
    } else {
      this.playAnimation('idle', this.currentDirection);
    }

    console.log(`[AgentSprite] Replaced texture for ${this.agentId} with ${newTextureKey}`);
  }

  private startBreathingAnimation(): void {
    if (!this.scene || this.breathingTween) return;
    
    console.log(`[AgentSprite] Starting Siri-style breathing animation for ${this.agentId}`);
    
    const theme = getCurrentTheme();
    const primaryColor = parseInt(theme.colors.brand.primary.replace('#', ''), 16);
    const secondaryColor = parseInt(theme.colors.brand.secondary.replace('#', ''), 16);
    
    const glowOuter = this.scene.add.graphics();
    const glowMiddle = this.scene.add.graphics();
    const glowInner = this.scene.add.graphics();
    
    glowOuter.setDepth(-1);
    glowMiddle.setDepth(-1);
    glowInner.setDepth(-1);
    
    this.add(glowOuter);
    this.add(glowMiddle);
    this.add(glowInner);
    
    const drawGlows = (phase: number) => {
      glowOuter.clear();
      glowMiddle.clear();
      glowInner.clear();
      
      const pulse1 = 0.5 + 0.5 * Math.sin(phase * 2);
      const pulse2 = 0.5 + 0.5 * Math.sin(phase * 2.5 + 1);
      const pulse3 = 0.5 + 0.5 * Math.sin(phase * 1.8 + 2);
      
      glowOuter.fillStyle(primaryColor, 0.08 + pulse1 * 0.12);
      glowOuter.fillCircle(0, 0, 50 + pulse1 * 20);
      
      glowMiddle.fillStyle(secondaryColor, 0.15 + pulse2 * 0.2);
      glowMiddle.fillCircle(0, 0, 35 + pulse2 * 12);
      
      glowInner.fillStyle(0xffffff, 0.4 + pulse3 * 0.3);
      glowInner.fillCircle(0, 0, 20 + pulse3 * 8);
    };
    
    drawGlows(0);
    
    this.breathingTween = this.scene.tweens.add({
      targets: this.sprite,
      scaleX: 1.15,
      scaleY: 1.15,
      alpha: 0.85,
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: (tween) => {
        const progress = tween.progress * Math.PI * 2;
        drawGlows(progress);
      }
    });
    
    this.setData('breathingGlows', [glowOuter, glowMiddle, glowInner]);
  }

  private stopBreathingAnimation(): void {
    if (this.breathingTween) {
      this.breathingTween.stop();
      this.breathingTween = null;
      this.sprite.setScale(1);
      this.sprite.setAlpha(1);
    }
    
    const glows = this.getData('breathingGlows') as Phaser.GameObjects.Graphics[];
    if (glows) {
      glows.forEach(g => g.destroy());
    }
  }

  public getCharacterId(): string | null {
    return this.characterId;
  }

  public isPlaceholderTexture(): boolean {
    return this.isUsingPlaceholder;
  }

  public playAnimation(animation: 'idle' | 'walk' | 'run', direction?: number): void {
    if (!this.customTextureKey || !this.sprite) {
      return;
    }

    const dir = direction ?? this.currentDirection;
    
    if (this.currentAnimation === animation && this.currentDirection === dir) {
      return;
    }

    this.currentDirection = dir;
    this.currentAnimation = animation;
    
    const animKey = `${this.customTextureKey}_${animation}_${dir}`;
    
    if (this.scene.anims.exists(animKey)) {
      const anim = this.scene.anims.get(animKey);
      if (!anim || !anim.frames || anim.frames.length === 0) {
        console.warn(`[AgentSprite] Animation ${animKey} has no valid frames`);
        return;
      }

      const textureManager = this.scene.textures;
      if (!textureManager.exists(this.customTextureKey)) {
        console.warn(`[AgentSprite] Texture ${this.customTextureKey} not loaded yet`);
        return;
      }

      const texture = textureManager.get(this.customTextureKey);
      if (!texture || !texture.source) {
        console.warn(`[AgentSprite] Texture ${this.customTextureKey} source not ready`);
        return;
      }

      try {
        this.sprite.play(animKey);
      } catch (error) {
        console.error(`[AgentSprite] ❌ Error playing ${animKey}:`, error);
      }
    }
  }

  public setDirection(direction: number): void {
    this.currentDirection = direction;
  }

  private drawSelectionRing(): void {
    this.selectionRing.clear();
    this.selectionRing.lineStyle(2, COLORS.ui.selection, 1);
    this.selectionRing.strokeCircle(0, 0, 22);
  }

  private drawStatusIndicator(color: number): void {
    this.statusIndicator.clear();
    this.statusIndicator.fillStyle(color, 1);
    this.statusIndicator.fillCircle(0, -16, 3);
  }

  private drawTypeIcon(type: AgentType): void {
    const color = COLORS.type[type as keyof typeof COLORS.type] || hexToNumber(getToken("colors.text.primary"));
    this.typeIcon.clear();
    this.typeIcon.fillStyle(color, 1);
    this.typeIcon.fillCircle(10, 10, 4);
  }

  public setAgentStatus(status: AgentStatus): void {
    this.currentStatus = status;
    const color = COLORS.status[status];
    
    this.drawStatusIndicator(color);
    
    this.stopBusyAnimation();

    if (status === 'offline') {
      this.sprite.setTint(hexToNumber(getToken("colors.text.muted")));
      this.setAlpha(0.5);
    } else if (status === 'busy') {
      this.sprite.setTint(color);
      this.startBusyAnimation();
    } else {
      this.sprite.setTint(color);
      this.setAlpha(1);
    }

    if (this.isSelected) {
      this.sprite.setTint(COLORS.ui.selection);
    }
  }

  public setCommandStatus(status: CommandStatus): void {
    const statusColorMap: Record<CommandStatus, number> = {
      pending: COLORS.status.pending,
      running: COLORS.status.busy,
      success: COLORS.status.online,
      failed: COLORS.status.error
    };
    const color = statusColorMap[status];
    this.sprite.setTint(color);

    switch (status) {
      case 'success':
        this.playSuccessAnimation();
        break;
      case 'failed':
        this.playErrorAnimation();
        break;
    }
  }

  /**
   * Show a zone badge on the agent sprite indicating which zone it belongs to
   * @param zoneId The ID of the zone
   * @param zoneName The display name of the zone (optional, will be truncated)
   */
  public setZoneBadge(zoneId: string, zoneName?: string): void {
    this.currentZoneId = zoneId;
    this.currentZoneName = zoneName || null;

    // Create zone badge if doesn't exist
    if (!this.zoneBadge) {
      this.zoneBadge = this.scene.add.graphics();
      this.add(this.zoneBadge);
      // Place badge below the name text
      this.zoneBadge.setPosition(0, -48);
    }

    // Draw badge with zone color (using a gradient-like effect)
    this.zoneBadge.clear();

    // Badge background
    const badgeWidth = zoneName ? Math.min(zoneName.length * 6 + 16, 80) : 40;
    const badgeHeight = 14;

    this.zoneBadge.fillStyle(0x4a9eff, 0.9); // Blue badge
    this.zoneBadge.fillRoundedRect(-badgeWidth / 2, 0, badgeWidth, badgeHeight, 4);

    // Badge border
    this.zoneBadge.lineStyle(1, 0xffffff, 0.5);
    this.zoneBadge.strokeRoundedRect(-badgeWidth / 2, 0, badgeWidth, badgeHeight, 4);

    // Zone icon (small rectangle representing zone)
    this.zoneBadge.fillStyle(0xffffff, 0.8);
    this.zoneBadge.fillRect(-badgeWidth / 2 + 4, 4, 6, 6);

    // Zone text
    if (zoneName) {
      const truncatedName = zoneName.length > 8 ? zoneName.substring(0, 8) + '...' : zoneName;
      const zoneText = this.scene.add.text(0, 0, truncatedName, {
        fontSize: '9px',
        fontFamily: 'Arial, sans-serif',
        color: '#ffffff'
      });
      zoneText.setOrigin(0.5);
      zoneText.setPosition(4, badgeHeight / 2);

      // Remove old text if exists
      const existingText = this.zoneBadge.getData('zoneText');
      if (existingText) {
        existingText.destroy();
      }
      this.zoneBadge.setData('zoneText', zoneText);
      this.add(zoneText);
    }

    this.zoneBadge.setVisible(true);
    console.log(`[AgentSprite] Zone badge set for agent ${this.agentId}: ${zoneName || zoneId}`);
  }

  /**
   * Remove the zone badge from the agent sprite
   */
  public clearZoneBadge(): void {
    this.currentZoneId = null;
    this.currentZoneName = null;

    if (this.zoneBadge) {
      // Destroy zone text if exists
      const zoneText = this.zoneBadge.getData('zoneText');
      if (zoneText) {
        zoneText.destroy();
      }
      this.zoneBadge.setVisible(false);
    }
    console.log(`[AgentSprite] Zone badge cleared for agent ${this.agentId}`);
  }

  /**
   * Get the current zone ID the agent is in
   */
  public getCurrentZone(): string | null {
    return this.currentZoneId;
  }

  public setHighlight(selected: boolean): void {
    this.isSelected = selected;
    this.selectionRing.setVisible(selected);
    this.setData('isSelected', selected);
    
    if (selected) {
      this.sprite.setTint(COLORS.ui.selection);
      this.scene.tweens.add({
        targets: this.sprite,
        scale: { from: 1, to: 1.1 },
        duration: 100,
        yoyo: true
      });
    } else {
      this.setAgentStatus(this.currentStatus);
    }
  }

  private startBusyAnimation(): void {
    this.busyTween = this.scene.tweens.add({
      targets: this.sprite,
      alpha: { from: 1, to: 0.7 },
      duration: 500,
      yoyo: true,
      repeat: -1
    });
  }

  private stopBusyAnimation(): void {
    if (this.busyTween) {
      this.busyTween.stop();
      this.busyTween = null;
      this.sprite.setAlpha(1);
    }
  }

  private playSuccessAnimation(): void {
    this.scene.tweens.add({
      targets: this.sprite,
      alpha: { from: 1, to: 0.3 },
      duration: 200,
      yoyo: true,
      repeat: 2,
      onComplete: () => {
        this.setAgentStatus(this.currentStatus);
      }
    });
  }

  private playErrorAnimation(): void {
    const originalX = this.x;
    this.scene.tweens.add({
      targets: this,
      x: { from: originalX - 3, to: originalX + 3 },
      duration: 50,
      yoyo: true,
      repeat: 3,
      onComplete: () => {
        this.x = originalX;
        this.setAgentStatus(this.currentStatus);
      }
    });
  }

  public playSpawnAnimation(): void {
    // 初始状态：透明 + 缩小
    this.setAlpha(0);
    this.setScale(0.3);
    this.setDepth(10000);

    // 创建光柱效果
    const lightBeam = this.scene.add.graphics();
    lightBeam.setDepth(9999);
    this.add(lightBeam);

    // 光柱动画参数
    const beamHeight = 200;
    const beamData = { alpha: 0 };

    // 光柱展开动画
    this.scene.tweens.add({
      targets: beamData,
      alpha: 0.8,
      duration: 300,
      onUpdate: () => {
        lightBeam.clear();
        
        // 外层光柱（青色）
        lightBeam.fillStyle(hexToNumber(getToken("colors.brand.primary")), beamData.alpha * 0.3);
        lightBeam.fillRoundedRect(-30, -beamHeight / 2, 60, beamHeight, 10);
        
        // 内层光柱（白色）
        lightBeam.fillStyle(hexToNumber(getToken("colors.text.primary")), beamData.alpha * 0.5);
        lightBeam.fillRoundedRect(-15, -beamHeight / 3, 30, beamHeight * 0.66, 5);
      },
      onComplete: () => {
        // 光柱保持后淡出
        this.scene.tweens.add({
          targets: beamData,
          alpha: 0,
          duration: 500,
          delay: 200,
          onUpdate: () => {
            lightBeam.setAlpha(beamData.alpha);
          },
          onComplete: () => {
            lightBeam.destroy();
          }
        });
      }
    });

    // 角色显现动画
    this.scene.tweens.add({
      targets: this,
      alpha: { from: 0, to: 1 },
      scale: { from: 0.3, to: 1 },
      duration: 600,
      ease: 'Back.easeOut',
      delay: 200,
      onComplete: () => {
        this.setScale(1);
        this.updateDepth();
        
        // 角色显现时的闪光效果
        this.sprite.setTint(hexToNumber(getToken("colors.text.primary")));
        this.scene.time.delayedCall(100, () => {
          this.sprite.setTint(hexToNumber(getToken("colors.brand.primary")));
          this.scene.time.delayedCall(100, () => {
            this.setAgentStatus(this.currentStatus);
          });
        });
      }
    });

    // 生成上升粒子
    for (let i = 0; i < 12; i++) {
      const particle = this.scene.add.graphics();
      particle.setDepth(9998);
      this.add(particle);

      const angle = (i / 12) * Math.PI * 2;
      const radius = 40 + Math.random() * 20;
      const startX = Math.cos(angle) * radius;
      const startY = 50;

      particle.fillStyle(hexToNumber(getToken("colors.brand.primary")), 0.8);
      particle.fillCircle(0, 0, 3 + Math.random() * 3);
      particle.setPosition(startX, startY);

      // 粒子动画
      const particleData = { y: startY, alpha: 0.8 };
      this.scene.tweens.add({
        targets: particleData,
        y: startY - 80 - Math.random() * 40,
        alpha: 0,
        duration: 800 + Math.random() * 400,
        delay: 100 + i * 50,
        ease: 'Cubic.easeOut',
        onUpdate: () => {
          particle.setPosition(startX, particleData.y);
          particle.setAlpha(particleData.alpha);
        },
        onComplete: () => {
          particle.destroy();
        }
      });
    }

    // 地面光环效果
    const groundRing = this.scene.add.graphics();
    groundRing.setDepth(9997);
    this.add(groundRing);

    // 光环扩散动画
    const ringData = { radius: 0, alpha: 0.8 };
    this.scene.tweens.add({
      targets: ringData,
      radius: 60,
      alpha: 0,
      duration: 800,
      ease: 'Cubic.easeOut',
      delay: 100,
      onUpdate: () => {
        groundRing.clear();
        groundRing.lineStyle(3, hexToNumber(getToken("colors.brand.primary")), ringData.alpha);
        groundRing.strokeCircle(0, 0, ringData.radius);
      },
      onComplete: () => {
        groundRing.destroy();
      }
    });
  }

  public getAgentId(): string {
    return this.agentId;
  }

  public getAgentName(): string {
    return this.agentName;
  }

  public getAgentType(): AgentType {
    return this.agentType;
  }

  public getCurrentStatus(): AgentStatus {
    return this.currentStatus;
  }

  public isAgentSelected(): boolean {
    return this.isSelected;
  }

  public updateDepth(): void {
    this.setDepth(this.y);
  }

  public startDrag(worldX: number, worldY: number): void {
    this.isDragging = true;
    this.dragOffset.x = this.x - worldX;
    this.dragOffset.y = this.y - worldY;
    this.setDepth(10000);
  }

  public updateDrag(worldX: number, worldY: number): void {
    if (!this.isDragging) return;
    this.x = worldX + this.dragOffset.x;
    this.y = worldY + this.dragOffset.y;
  }

  public endDrag(): void {
    this.isDragging = false;
    this.updateDepth();
  }

  public isSpriteDragging(): boolean {
    return this.isDragging;
  }

  public isCustomCharacter(): boolean {
    return this.customTextureKey !== null;
  }

  public setRenderMode(mode: 'full' | 'thumbnail'): void {
    if (this.renderMode === mode) return;
    
    this.renderMode = mode;
    
    if (mode === 'thumbnail') {
      this.sprite.setVisible(false);
      this.nameText.setVisible(false);
      this.typeIcon.setVisible(false);
      this.statusIndicator.setVisible(false);
      this.showThumbnail();
    } else {
      this.sprite.setVisible(true);
      this.nameText.setVisible(this.getData('showName') !== false);
      this.typeIcon.setVisible(true);
      this.statusIndicator.setVisible(true);
      this.hideThumbnail();
    }
  }

  public setShowName(show: boolean): void {
    this.setData('showName', show);
    if (this.renderMode === 'full') {
      this.nameText.setVisible(show);
    }
  }

  private showThumbnail(): void {
    if (!this.thumbnailSprite) {
      this.createThumbnail();
    }
    
    if (this.thumbnailSprite) {
      this.thumbnailSprite.setVisible(true);
    }
  }

  private hideThumbnail(): void {
    if (this.thumbnailSprite) {
      this.thumbnailSprite.setVisible(false);
    }
  }

  private createThumbnail(): void {
    if (this.thumbnailSprite) return;

    const thumbnailKey = this.getThumbnailKey();
    
    if (thumbnailKey && this.scene.textures.exists(thumbnailKey)) {
      this.thumbnailSprite = this.scene.add.image(0, 0, thumbnailKey);
      this.thumbnailSprite.setScale(0.5);
      this.add(this.thumbnailSprite);
      this.thumbnailSprite.setDepth(-1);
    }
  }

  private getThumbnailKey(): string | null {
    if (this.thumbnailKey) {
      return this.thumbnailKey;
    }

    if (this.characterThumbnail) {
      this.thumbnailKey = `thumbnail-${this.agentId}`;
      return this.thumbnailKey;
    }

    this.thumbnailKey = `type-${this.agentType}-thumbnail`;
    return this.thumbnailKey;
  }

  public async loadThumbnail(): Promise<void> {
    if (!this.characterThumbnail) return;

    try {
      const { thumbnailGenerator } = await import('../services/ThumbnailGenerator');
      const textureKey = await thumbnailGenerator.loadCharacterThumbnail(
        this.characterThumbnail,
        this.agentId
      );
      
      this.thumbnailKey = textureKey;
      
      if (this.renderMode === 'thumbnail' && this.thumbnailSprite) {
        this.thumbnailSprite.setTexture(textureKey);
      }
    } catch (error) {
      console.warn(`[AgentSprite] Failed to load thumbnail for ${this.agentId}:`, error);
    }
  }

  public getRenderMode(): 'full' | 'thumbnail' {
    return this.renderMode;
  }

  public destroy(): void {
    this.stopBusyAnimation();
    
    if (this.thumbnailSprite) {
      this.thumbnailSprite.destroy();
      this.thumbnailSprite = null;
    }
    
    super.destroy();
  }
}
