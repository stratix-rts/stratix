export function hexToNumber(hex: string): number {
  if (!hex || typeof hex !== 'string') return 0xffffff;
  return parseInt(hex.slice(1), 16);
}

export function hexToRgba(hex: string, alpha: number): string {
  const num = hexToNumber(hex);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}

export function createGradientTexture(
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
  colorStops: { offset: number; color: string; alpha?: number }[]
): void {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  colorStops.forEach(s => {
    gradient.addColorStop(s.offset, hexToRgba(s.color, s.alpha ?? 1));
  });
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  scene.textures.addCanvas(key, canvas);
}

export class GradientHelper {
  progressGradKey: string | null = null;
  emptyGradKey: string | null = null;

  constructor(private scene: Phaser.Scene, private id: string) {}

  init(accentColor: string, successColor: string, backgroundColor: string): void {
    this.cleanup();
    this.progressGradKey = `${this.id}_progGrad`;
    this.emptyGradKey = `${this.id}_emptyGrad`;
    createGradientTexture(this.scene, this.progressGradKey, 256, 8, [
      { offset: 0, color: accentColor },
      { offset: 1, color: successColor },
    ]);
    createGradientTexture(this.scene, this.emptyGradKey, 512, 128, [
      { offset: 0, color: accentColor, alpha: 0.15 },
      { offset: 0.5, color: backgroundColor, alpha: 0.05 },
      { offset: 1, color: successColor, alpha: 0.15 },
    ]);
  }

  cleanup(): void {
    if (this.progressGradKey) {
      this.scene.textures.remove(this.progressGradKey);
      this.progressGradKey = null;
    }
    if (this.emptyGradKey) {
      this.scene.textures.remove(this.emptyGradKey);
      this.emptyGradKey = null;
    }
  }
}
