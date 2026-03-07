import { FRAME_SIZE, SHEET_WIDTH, SHEET_HEIGHT, ANIMATION_OFFSETS, LPC_DIRECTION_ROWS, ANIMATION_CONFIGS } from '@/stratix-character-creator/constants';
import type { BodyType } from '@/stratix-core/stratix-protocol';

const BODY_COLORS: Record<BodyType, { primary: string; secondary: string; outline: string }> = {
  male: { primary: '#4a7c7c', secondary: '#3d6666', outline: '#2d4f4f' },
  female: { primary: '#7c4a7c', secondary: '#663d66', outline: '#4f2d4f' },
  teen: { primary: '#7c7c4a', secondary: '#66663d', outline: '#4f4f2d' },
  muscular: { primary: '#7c4a4a', secondary: '#663d3d', outline: '#4f2d2d' },
  pregnant: { primary: '#4a7c4a', secondary: '#3d663d', outline: '#2d4f2d' },
  child: { primary: '#7c9c7c', secondary: '#668066', outline: '#4f604f' }
};

function drawBaseBodyFrame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  colors: { primary: string; secondary: string; outline: string },
  animation: string,
  frame: number,
  direction: number
): void {
  ctx.save();
  ctx.translate(x, y);

  const centerX = FRAME_SIZE / 2;
  const baseY = FRAME_SIZE - 8;
  
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.beginPath();
  ctx.ellipse(centerX, baseY, 12, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = colors.primary;
  ctx.strokeStyle = colors.outline;
  ctx.lineWidth = 1;
  
  let bodyOffset = 0;
  
  if (animation === 'walk' || animation === 'run') {
    const cycleSpeed = animation === 'run' ? 0.5 : 0.8;
    bodyOffset = Math.sin(frame * cycleSpeed) * 2;
  } else if (animation === 'idle') {
    bodyOffset = Math.sin(frame * 0.5) * 1;
  }

  ctx.beginPath();
  ctx.ellipse(centerX, 28 + bodyOffset, 10, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = colors.secondary;
  ctx.beginPath();
  ctx.ellipse(centerX, 16 + bodyOffset, 8, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f5deb3';
  ctx.beginPath();
  ctx.arc(centerX, 6 + bodyOffset, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#c4a882';
  ctx.stroke();

  ctx.fillStyle = '#2a2a2a';
  const eyeDirOffset = direction === LPC_DIRECTION_ROWS.LEFT ? 2 : direction === LPC_DIRECTION_ROWS.RIGHT ? -2 : 0;
  ctx.beginPath();
  ctx.arc(centerX - 3 + eyeDirOffset, 4 + bodyOffset, 1.5, 0, Math.PI * 2);
  ctx.arc(centerX + 3 + eyeDirOffset, 4 + bodyOffset, 1.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = colors.primary;
  ctx.strokeStyle = colors.outline;
  
  if (animation === 'walk' || animation === 'run') {
    const leftArmSwing = Math.sin(frame * 0.8) * 15;
    const rightArmSwing = -Math.sin(frame * 0.8) * 15;
    
    ctx.save();
    ctx.translate(centerX - 10, 22 + bodyOffset);
    ctx.rotate((leftArmSwing * Math.PI) / 180);
    ctx.fillRect(-2, 0, 4, 16);
    ctx.strokeRect(-2, 0, 4, 16);
    ctx.restore();

    ctx.save();
    ctx.translate(centerX + 10, 22 + bodyOffset);
    ctx.rotate((rightArmSwing * Math.PI) / 180);
    ctx.fillRect(-2, 0, 4, 16);
    ctx.strokeRect(-2, 0, 4, 16);
    ctx.restore();

    const leftLegSwing = Math.sin(frame * 0.8) * 8;
    const rightLegSwing = -Math.sin(frame * 0.8) * 8;
    
    ctx.fillRect(centerX - 6 + leftLegSwing, 40 + bodyOffset, 5, 16);
    ctx.strokeRect(centerX - 6 + leftLegSwing, 40 + bodyOffset, 5, 16);
    ctx.fillRect(centerX + 1 + rightLegSwing, 40 + bodyOffset, 5, 16);
    ctx.strokeRect(centerX + 1 + rightLegSwing, 40 + bodyOffset, 5, 16);
  } else {
    ctx.fillRect(centerX - 12, 22 + bodyOffset, 4, 14);
    ctx.strokeRect(centerX - 12, 22 + bodyOffset, 4, 14);
    ctx.fillRect(centerX + 8, 22 + bodyOffset, 4, 14);
    ctx.strokeRect(centerX + 8, 22 + bodyOffset, 4, 14);

    ctx.fillRect(centerX - 5, 40 + bodyOffset, 5, 16);
    ctx.strokeRect(centerX - 5, 40 + bodyOffset, 5, 16);
    ctx.fillRect(centerX, 40 + bodyOffset, 5, 16);
    ctx.strokeRect(centerX, 40 + bodyOffset, 5, 16);
  }

  ctx.restore();
}

function generateBaseBodyTexture(bodyType: BodyType): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SHEET_WIDTH;
  canvas.height = SHEET_HEIGHT;
  const ctx = canvas.getContext('2d')!;

  const colors = BODY_COLORS[bodyType] ?? BODY_COLORS.male;

  const animationKeys = ['idle', 'walk', 'run'] as const;

  for (const animKey of animationKeys) {
    const animConfig = ANIMATION_CONFIGS[animKey];
    const yPos = ANIMATION_OFFSETS[animKey];
    if (yPos === undefined || !animConfig) continue;

    const maxFrame = Math.max(...animConfig.cycle);

    for (let direction = 0; direction < 4; direction++) {
      for (let frame = 0; frame <= maxFrame; frame++) {
        const x = frame * FRAME_SIZE;
        const y = yPos + direction * FRAME_SIZE;
        
        drawBaseBodyFrame(ctx, x, y, colors, animKey, frame, direction);
      }
    }
  }

  return canvas;
}

export function generateBaseTextureInBrowser(bodyType: BodyType): HTMLCanvasElement {
  return generateBaseBodyTexture(bodyType);
}

export function downloadAllBaseTextures(): void {
  const bodyTypes: BodyType[] = ['male', 'female', 'teen', 'muscular', 'pregnant', 'child'];
  
  bodyTypes.forEach(bodyType => {
    const canvas = generateBaseBodyTexture(bodyType);
    const dataUrl = canvas.toDataURL('image/png');
    
    const link = document.createElement('a');
    link.download = `base-${bodyType}.png`;
    link.href = dataUrl;
    link.click();
  });
  
  console.log(`[BaseTextureGenerator] Downloaded ${bodyTypes.length} base textures`);
}

(window as any).downloadAllBaseTextures = downloadAllBaseTextures;
