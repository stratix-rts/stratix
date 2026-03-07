import Phaser from 'phaser';
import { StratixAgentConfig } from '../../stratix-core/stratix-protocol';
import { LPC_DIRECTION_ROWS } from '@/stratix-character-creator/constants';

export type AgentStatus = 'online' | 'offline' | 'busy' | 'error';
export type CommandStatus = 'pending' | 'running' | 'success' | 'failed';
export type AgentType = 'writer' | 'dev' | 'analyst' | string;

export const COLORS = {
  status: {
    online: 0x00ff00,
    offline: 0x888888,
    busy: 0xffff00,
    error: 0xff4444,
    pending: 0x00ffff
  },
  type: {
    writer: 0x4A90E2,
    dev: 0x9B59B6,
    analyst: 0xE67E22,
    custom: 0x00ffff
  },
  ui: {
    selection: 0x00ff00
  }
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
    
    if (textureKey && config.profile) {
      this.sprite.setScale(0.75);
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
    
    this.sprite.setTexture(newTextureKey);
    
    if (currentAnim) {
      const animName = currentAnim.key.split('_').slice(1, 3).join('_');
      const direction = this.currentDirection;
      this.playAnimation(animName as 'idle' | 'walk' | 'run', direction);
    } else {
      this.playAnimation('idle', this.currentDirection);
    }

    this.scene.tweens.add({
      targets: this.sprite,
      alpha: { from: 0.5, to: 1 },
      duration: 300,
      ease: 'Sine.easeOut'
    });

    console.log(`[AgentSprite] Replaced texture for ${this.agentId} with ${newTextureKey}`);
  }

  public getCharacterId(): string | null {
    return this.characterId;
  }

  public isPlaceholderTexture(): boolean {
    return this.isUsingPlaceholder;
  }

  public playAnimation(animation: 'idle' | 'walk' | 'run', direction?: number): void {
    if (!this.customTextureKey) {
      return;
    }
    
    const dir = direction ?? this.currentDirection;
    this.currentDirection = dir;
    this.currentAnimation = animation;
    
    const animKey = `${this.customTextureKey}_${animation}_${dir}`;
    
    if (this.scene.anims.exists(animKey)) {
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
    const color = COLORS.type[type as keyof typeof COLORS.type] || 0xffffff;
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
      this.sprite.setTint(0x888888);
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
        lightBeam.fillStyle(0x00ffff, beamData.alpha * 0.3);
        lightBeam.fillRoundedRect(-30, -beamHeight / 2, 60, beamHeight, 10);
        
        // 内层光柱（白色）
        lightBeam.fillStyle(0xffffff, beamData.alpha * 0.5);
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
        this.sprite.setTint(0xffffff);
        this.scene.time.delayedCall(100, () => {
          this.sprite.setTint(0x00ffff);
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

      particle.fillStyle(0x00ffff, 0.8);
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
        groundRing.lineStyle(3, 0x00ffff, ringData.alpha);
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
