import Phaser from 'phaser';

import { MagicCircle } from './MagicCircle';
import { ParticleSystem } from './ParticleSystem';

export interface CharacterSpawnEffectConfig {
  x: number;
  y: number;
  characterId: string;
  characterName: string;
}

export class CharacterSpawnEffect {
  private scene: Phaser.Scene;
  private config: CharacterSpawnEffectConfig;
  
  private magicCircle: MagicCircle;
  private particles: ParticleSystem;
  private text: Phaser.GameObjects.Text;
  private flashOverlay: Phaser.GameObjects.Graphics | null = null;
  
  private phase: 'idle' | 'expanding' | 'gathering' | 'completing' | 'failed' | 'done' = 'idle';
  private startTime: number = 0;
  private updateEvent: Phaser.Time.TimerEvent | null = null;
  
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    characterId: string,
    characterName: string
  ) {
    console.log('[CharacterSpawnEffect] 🔵 Constructor called');
    console.log('[CharacterSpawnEffect] 📍 Position:', { x, y });
    console.log('[CharacterSpawnEffect] 🆔 Character ID:', characterId);
    console.log('[CharacterSpawnEffect] 📛 Character Name:', characterName);
    
    this.scene = scene;
    this.config = { x, y, characterId, characterName };
    
    console.log('[CharacterSpawnEffect] 🎨 Creating magic circle...');
    this.magicCircle = new MagicCircle(scene, { x, y });
    
    console.log('[CharacterSpawnEffect] ✨ Creating particle system...');
    this.particles = new ParticleSystem(scene, { x, y });
    
    console.log('[CharacterSpawnEffect] 📝 Creating status text...');
    this.text = scene.add.text(x, y - 120, '⚡ 召唤中...', {
      fontSize: '16px',
      color: '#00ffff',
      fontFamily: 'Arial, sans-serif',
      fontStyle: 'bold'
    });
    this.text.setOrigin(0.5);
    this.text.setDepth(1002);
    this.text.setAlpha(0);
    
    scene.tweens.add({
      targets: this.text,
      alpha: 1,
      duration: 300
    });
    
    console.log('[CharacterSpawnEffect] ✅ Constructor completed');
  }
  
  start(): void {
    console.log('[CharacterSpawnEffect] 🚀 start() called');
    console.log('[CharacterSpawnEffect] 📊 Current phase:', this.phase);
    
    this.phase = 'expanding';
    this.startTime = Date.now();
    console.log('[CharacterSpawnEffect] ⏱️ Start time:', this.startTime);
    
    console.log('[CharacterSpawnEffect] 🎬 Starting magic circle animation');
    this.magicCircle.start();
    
    console.log('[CharacterSpawnEffect] ⏰ Scheduling phase transition (500ms)');
    this.scene.time.delayedCall(500, () => {
      if (this.phase === 'expanding') {
        console.log('[CharacterSpawnEffect] 🔄 Phase transition: expanding → gathering');
        this.phase = 'gathering';
        this.particles.startGathering();
      }
    });
    
    console.log('[CharacterSpawnEffect] 🔄 Starting update loop');
    this.updateEvent = this.scene.time.addEvent({
      delay: 16,
      callback: this.update,
      callbackScope: this,
      loop: true
    });
    
    console.log('[CharacterSpawnEffect] ✅ start() completed');
  }
  
  private update(): void {
    if (this.phase === 'idle' || this.phase === 'done') return;
    
    const delta = 16;
    
    this.magicCircle.update(delta);
    this.particles.update(delta);
    
    if (this.phase === 'gathering') {
      const elapsed = Date.now() - this.startTime;
      if (elapsed > 3000 && this.text.alpha > 0) {
        const dots = '.'.repeat((Math.floor(elapsed / 500) % 4));
        this.text.setText(`⚡ 召唤中${dots}`);
      }
    }
  }
  
  async playCompleteAnimation(): Promise<void> {
    if (this.phase === 'done') return;
    
    this.phase = 'completing';
    
    await this.showFlashEffect();
    
    await this.particles.burst();
    
    await this.fadeOut();
    
    this.phase = 'done';
  }
  
  private async showFlashEffect(): Promise<void> {
    return new Promise(resolve => {
      const camera = this.scene.cameras.main;
      
      this.flashOverlay = this.scene.add.graphics();
      this.flashOverlay.fillStyle(0xffffff, 0.8);
      this.flashOverlay.fillRect(
        camera.scrollX,
        camera.scrollY,
        camera.width,
        camera.height
      );
      this.flashOverlay.setDepth(2000);
      
      this.scene.tweens.add({
        targets: this.flashOverlay,
        alpha: 0,
        duration: 400,
        ease: 'Power2',
        onComplete: () => {
          if (this.flashOverlay) {
            this.flashOverlay.destroy();
            this.flashOverlay = null;
          }
          resolve();
        }
      });
    });
  }
  
  private async fadeOut(): Promise<void> {
    return new Promise(resolve => {
      this.scene.tweens.add({
        targets: [this.text],
        alpha: 0,
        duration: 300,
        ease: 'Power2',
        onComplete: () => {
          resolve();
        }
      });
    });
  }
  
  playFailedAnimation(): void {
    if (this.phase === 'done') return;
    
    this.phase = 'failed';
    
    this.text.setColor('#ff0000');
    this.text.setText('❌ 召唤失败');
    
    if (this.updateEvent) {
      this.updateEvent.destroy();
      this.updateEvent = null;
    }
    
    const maxFlashes = 6;
    
    const flashInterval = this.scene.time.addEvent({
      delay: 150,
      callback: () => {
        const visible = flashInterval.elapsed % 300 < 150;
        this.magicCircle.setExpandProgress(visible ? 1 : 0);
        
        if (flashInterval.elapsed >= maxFlashes * 150) {
          flashInterval.destroy();
          
          this.scene.tweens.add({
            targets: [this.text],
            alpha: 0,
            duration: 500,
            onComplete: () => {
              this.destroy();
            }
          });
        }
      },
      loop: true
    });
  }
  
  getPosition(): { x: number; y: number } {
    return this.magicCircle.getPosition();
  }
  
  destroy(): void {
    if (this.updateEvent) {
      this.updateEvent.destroy();
      this.updateEvent = null;
    }
    
    this.magicCircle.destroy();
    this.particles.destroy();
    this.text.destroy();
    
    if (this.flashOverlay) {
      this.flashOverlay.destroy();
      this.flashOverlay = null;
    }
    
    this.phase = 'done';
  }
}
