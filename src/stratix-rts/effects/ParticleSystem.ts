/**
 * ParticleSystem - 粒子系统
 * 
 * 聚集阶段：粒子从四周向中心移动
 * 爆发阶段：粒子向外扩散
 */

import Phaser from 'phaser';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alpha: number;
  scale: number;
  color: number;
  graphics: Phaser.GameObjects.Graphics;
  trail: Phaser.GameObjects.Graphics;
  trailPositions: Array<{ x: number; y: number }>;
}

export interface ParticleSystemConfig {
  x: number;
  y: number;
  particleCount?: number;
  color1?: number;
  color2?: number;
}

export class ParticleSystem {
  private scene: Phaser.Scene;
  private config: Required<ParticleSystemConfig>;
  private particles: Particle[] = [];
  private container: Phaser.GameObjects.Container;
  private phase: 'idle' | 'gathering' | 'bursting' | 'done' = 'idle';
  
  constructor(scene: Phaser.Scene, config: ParticleSystemConfig) {
    this.scene = scene;
    this.config = {
      x: config.x,
      y: config.y,
      particleCount: config.particleCount ?? 40,
      color1: config.color1 ?? 0x00ffff,
      color2: config.color2 ?? 0xff00ff
    };
    
    this.container = scene.add.container(0, 0);
    this.container.setDepth(1001);
    
    this.createParticles();
  }
  
  private createParticles(): void {
    const { particleCount, color1, color2 } = this.config;
    
    for (let i = 0; i < particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = 150 + Math.random() * 100;
      const startX = this.config.x + Math.cos(angle) * distance;
      const startY = this.config.y + Math.sin(angle) * distance;
      
      const graphics = this.scene.add.graphics();
      const trail = this.scene.add.graphics();
      
      const particle: Particle = {
        x: startX,
        y: startY,
        vx: 0,
        vy: 0,
        alpha: 0,
        scale: 0.5 + Math.random() * 0.5,
        color: Math.random() > 0.5 ? color1 : color2,
        graphics,
        trail,
        trailPositions: []
      };
      
      this.container.add([trail, graphics]);
      this.particles.push(particle);
    }
  }
  
  startGathering(): void {
    this.phase = 'gathering';
    
    this.scene.tweens.add({
      targets: this.particles,
      alpha: 1,
      duration: 300,
      ease: 'Power2'
    });
  }
  
  update(delta: number): void {
    if (this.phase === 'idle' || this.phase === 'done') return;
    
    const deltaSeconds = delta / 1000;
    
    if (this.phase === 'gathering') {
      this.updateGathering(deltaSeconds);
    } else if (this.phase === 'bursting') {
      this.updateBursting(deltaSeconds);
    }
    
    this.drawParticles();
  }
  
  private updateGathering(delta: number): void {
    const center = { x: this.config.x, y: this.config.y };
    
    this.particles.forEach(particle => {
      const dx = center.x - particle.x;
      const dy = center.y - particle.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance > 5) {
        const speed = 100 + Math.random() * 50;
        particle.vx = (dx / distance) * speed * delta;
        particle.vy = (dy / distance) * speed * delta;
        
        particle.x += particle.vx;
        particle.y += particle.vy;
        
        particle.trailPositions.unshift({ x: particle.x, y: particle.y });
        if (particle.trailPositions.length > 10) {
          particle.trailPositions.pop();
        }
      } else {
        const angle = Math.random() * Math.PI * 2;
        const orbitRadius = 20 + Math.random() * 30;
        particle.x = center.x + Math.cos(angle) * orbitRadius;
        particle.y = center.y + Math.sin(angle) * orbitRadius;
      }
    });
  }
  
  private updateBursting(delta: number): void {
    let allDone = true;
    
    this.particles.forEach(particle => {
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      
      particle.vx *= 0.98;
      particle.vy *= 0.98;
      
      particle.alpha -= 0.02;
      
      if (particle.alpha > 0) {
        allDone = false;
      }
      
      particle.trailPositions.unshift({ x: particle.x, y: particle.y });
      if (particle.trailPositions.length > 8) {
        particle.trailPositions.pop();
      }
    });
    
    if (allDone) {
      this.phase = 'done';
    }
  }
  
  private drawParticles(): void {
    this.particles.forEach(particle => {
      particle.graphics.clear();
      particle.trail.clear();
      
      if (particle.alpha <= 0) return;
      
      if (particle.trailPositions.length > 1) {
        particle.trail.lineStyle(2, particle.color, particle.alpha * 0.3);
        particle.trail.beginPath();
        particle.trail.moveTo(particle.trailPositions[0].x, particle.trailPositions[0].y);
        
        for (let i = 1; i < particle.trailPositions.length; i++) {
          const pos = particle.trailPositions[i];
          particle.trail.lineTo(pos.x, pos.y);
        }
        
        particle.trail.strokePath();
      }
      
      particle.graphics.fillStyle(particle.color, particle.alpha);
      particle.graphics.fillCircle(particle.x, particle.y, 4 * particle.scale);
      
      particle.graphics.fillStyle(0xffffff, particle.alpha * 0.8);
      particle.graphics.fillCircle(particle.x, particle.y, 2 * particle.scale);
    });
  }
  
  async burst(): Promise<void> {
    this.phase = 'bursting';
    
    this.particles.forEach(particle => {
      const dx = particle.x - this.config.x;
      const dy = particle.y - this.config.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 1;
      
      const burstSpeed = 300 + Math.random() * 200;
      particle.vx = (dx / distance) * burstSpeed;
      particle.vy = (dy / distance) * burstSpeed;
      
      particle.alpha = 1;
    });
    
    await new Promise(resolve => {
      this.scene.time.delayedCall(500, resolve);
    });
  }
  
  destroy(): void {
    this.phase = 'done';
    this.particles.forEach(particle => {
      particle.graphics.destroy();
      particle.trail.destroy();
    });
    this.particles = [];
    this.container.destroy();
  }
}
