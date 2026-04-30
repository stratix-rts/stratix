/**
 * BuildingTextureGenerator - 建筑程序化纹理生成器
 * 为 5 种建筑类型生成独特的外墙/屋顶/地基纹理
 * 支持亮灯(lit)/暗灯(dim)两套变体
 */

import Phaser from 'phaser';

import { SeededRandom } from '../utils/SeededRandom';
import { BuildingType } from './types/BuildingType';

export type BuildingFace = 'wall' | 'roof' | 'foundation';
export type LightState = 'lit' | 'dim';

/** 纹理尺寸 */
export const TEXTURE_SIZE = 128;

/**
 * 生成纹理 key
 */
export function getBuildingTextureKey(
  buildingType: BuildingType,
  face: BuildingFace,
  state: LightState
): string {
  return `building-${buildingType}-${face}-${state}`;
}

/**
 * 颜色变体：亮灯状态整体提亮，暗灯状态整体压暗
 */
function adjustBrightness(hexColor: string, factor: number): string {
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);

  const nr = Math.min(255, Math.max(0, Math.round(r * factor)));
  const ng = Math.min(255, Math.max(0, Math.round(g * factor)));
  const nb = Math.min(255, Math.max(0, Math.round(b * factor)));

  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

/**
 * 在画布上绘制均匀分布的噪点
 */
function drawNoise(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  density: number,
  colorBase: string,
  colorVar: string,
  alpha = 1
): void {
  const count = Math.floor(size * size * density);
  for (let i = 0; i < count; i++) {
    const x = random.between(0, size);
    const y = random.between(0, size);
    const w = random.between(1, 3);
    const h = random.between(1, 3);
    ctx.fillStyle = random.next() > 0.5 ? colorBase : colorVar;
    ctx.globalAlpha = alpha * (0.3 + random.next() * 0.7);
    ctx.fillRect(x, y, w, h);
  }
  ctx.globalAlpha = 1;
}

// =============================================================================
// DataCenter（数据机房）— 冷色调、金属感、服务器机架纹理
// =============================================================================

function drawDataCenterWall(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const baseColor = lit ? '#4a5568' : '#2d3748';
  const lineColor = lit ? '#718096' : '#4a5568';
  const ledColor = lit ? '#63b3ed' : '#2c5282';
  const ledBright = lit ? '#bee3f8' : '#63b3ed';

  // 背景
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  // 水平机架线条
  const rackCount = 8;
  const rackH = size / rackCount;
  for (let i = 0; i < rackCount; i++) {
    const y = i * rackH;
    ctx.fillStyle = lineColor;
    ctx.fillRect(0, y + rackH - 2, size, 2);

    // 服务器指示灯
    const ledCount = random.between(3, 6);
    for (let j = 0; j < ledCount; j++) {
      const lx = random.between(4, size - 8);
      const ly = y + random.between(2, Math.max(3, Math.floor(rackH) - 4));
      const isBright = random.next() > 0.6;
      ctx.fillStyle = isBright ? ledBright : ledColor;
      ctx.fillRect(lx, ly, 3, 2);
    }
  }

  // 细微噪点增加金属质感
  drawNoise(ctx, size, random, 0.05, '#1a202c', '#2d3748', 0.3);
}

function drawDataCenterRoof(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const baseColor = lit ? '#4a5568' : '#1a202c';
  const gridColor = lit ? '#718096' : '#2d3748';

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  // 散热格栅（网格线）
  const gridSize = 16;
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  for (let x = 0; x <= size; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }
  for (let y = 0; y <= size; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }

  // 格栅交叉点加粗
  ctx.fillStyle = lit ? '#2d3748' : '#1a202c';
  for (let x = 0; x < size; x += gridSize) {
    for (let y = 0; y < size; y += gridSize) {
      ctx.fillRect(x - 1, y - 1, 3, 3);
    }
  }
}

function drawDataCenterFoundation(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const baseColor = lit ? '#374151' : '#1f2937';

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  // 混凝土噪点纹理
  drawNoise(ctx, size, random, 0.15, '#4b5563', '#111827', 0.4);

  // 接缝线
  ctx.strokeStyle = lit ? '#1f2937' : '#111827';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(size / 2, 0);
  ctx.lineTo(size / 2, size);
  ctx.moveTo(0, size / 2);
  ctx.lineTo(size, size / 2);
  ctx.stroke();
}

// =============================================================================
// Workshop（开发工坊）— 暖色调、木质/砖墙纹理
// =============================================================================

function drawWorkshopWall(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const brickBase = lit ? '#c05621' : '#7c2d12';
  const mortarColor = lit ? '#d69e2e' : '#975a16';

  ctx.fillStyle = mortarColor;
  ctx.fillRect(0, 0, size, size);

  const brickH = 14;
  const brickW = 28;
  const rows = Math.ceil(size / brickH);

  for (let row = 0; row < rows; row++) {
    const y = row * brickH;
    const offset = (row % 2) * (brickW / 2);
    const cols = Math.ceil(size / brickW) + 1;

    for (let col = -1; col < cols; col++) {
      const x = col * brickW + offset;
      // 随机砖色变化
      const variation = random.floatBetween(0.85, 1.15);
      ctx.fillStyle = adjustBrightness(brickBase, variation);
      ctx.fillRect(x + 1, y + 1, brickW - 2, brickH - 2);
    }
  }
}

function drawWorkshopRoof(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const woodColor = lit ? '#b7791f' : '#744210';
  const tileColor = lit ? '#4a5568' : '#2d3748';
  const tileDark = lit ? '#2d3748' : '#1a202c';

  // 木质横梁背景
  ctx.fillStyle = woodColor;
  ctx.fillRect(0, 0, size, size);

  // 横向木梁
  const beamCount = 4;
  const beamH = size / beamCount;
  for (let i = 0; i < beamCount; i++) {
    const y = i * beamH;
    ctx.fillStyle = adjustBrightness(woodColor, 0.8);
    ctx.fillRect(0, y, size, 3);
  }

  // 瓦片（在木梁之间的小方块）
  const tileSize = 10;
  for (let y = 0; y < size; y += tileSize) {
    for (let x = 0; x < size; x += tileSize) {
      const isDark = random.next() > 0.5;
      ctx.fillStyle = isDark ? tileDark : tileColor;
      ctx.fillRect(x + 1, y + 4, tileSize - 2, tileSize - 4);
    }
  }
}

function drawWorkshopFoundation(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const baseColor = lit ? '#d69e2e' : '#975a16';

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  // 沙石噪点
  drawNoise(ctx, size, random, 0.12, '#f6e05e', '#744210', 0.3);

  // 小石子
  const stoneCount = 20;
  for (let i = 0; i < stoneCount; i++) {
    const x = random.between(2, size - 6);
    const y = random.between(2, size - 6);
    const r = random.between(2, 4);
    ctx.fillStyle = random.next() > 0.5 ? '#a0aec0' : '#718096';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// =============================================================================
// Studio（创意画室）— 活泼色调、玻璃/彩色纹理
// =============================================================================

function drawStudioWall(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const wallColor = lit ? '#e2e8f0' : '#a0aec0';
  const glassColor = lit ? '#90cdf4' : '#4299e1';
  const glassReflect = lit ? '#ebf8ff' : '#bee3f8';
  const frameColor = lit ? '#4a5568' : '#2d3748';

  // 整体墙面
  ctx.fillStyle = wallColor;
  ctx.fillRect(0, 0, size, size);

  // 大玻璃窗格（3x2 布局）
  const cols = 3;
  const rows = 2;
  const pad = 8;
  const cellW = (size - pad * (cols + 1)) / cols;
  const cellH = (size - pad * (rows + 1)) / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = pad + c * (cellW + pad);
      const y = pad + r * (cellH + pad);

      // 窗框
      ctx.fillStyle = frameColor;
      ctx.fillRect(x - 2, y - 2, cellW + 4, cellH + 4);

      // 玻璃
      ctx.fillStyle = glassColor;
      ctx.fillRect(x, y, cellW, cellH);

      // 反光条
      ctx.fillStyle = glassReflect;
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.moveTo(x, y + cellH);
      ctx.lineTo(x + cellW * 0.4, y);
      ctx.lineTo(x + cellW * 0.6, y);
      ctx.lineTo(x, y + cellH);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}

function drawStudioRoof(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const baseColor = lit ? '#e2e8f0' : '#cbd5e0';
  const skylightFrame = lit ? '#4a5568' : '#2d3748';
  const skylightGlass = lit ? '#63b3ed' : '#3182ce';

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  // 天窗（中间大矩形 + 小矩形）
  const skylights = [
    { x: size * 0.25, y: size * 0.2, w: size * 0.5, h: size * 0.25 },
    { x: size * 0.1, y: size * 0.6, w: size * 0.3, h: size * 0.15 },
    { x: size * 0.6, y: size * 0.6, w: size * 0.3, h: size * 0.15 },
  ];

  for (const s of skylights) {
    // 窗框
    ctx.fillStyle = skylightFrame;
    ctx.fillRect(s.x - 3, s.y - 3, s.w + 6, s.h + 6);
    // 玻璃
    ctx.fillStyle = skylightGlass;
    ctx.fillRect(s.x, s.y, s.w, s.h);
    // 反光
    ctx.fillStyle = lit ? '#bee3f8' : '#90cdf4';
    ctx.globalAlpha = 0.3;
    ctx.fillRect(s.x, s.y, s.w * 0.5, s.h * 0.5);
    ctx.globalAlpha = 1;
  }
}

function drawStudioFoundation(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const tileColor1 = lit ? '#e2e8f0' : '#a0aec0';
  const tileColor2 = lit ? '#cbd5e0' : '#718096';
  const groutColor = lit ? '#718096' : '#4a5568';

  // 填缝背景
  ctx.fillStyle = groutColor;
  ctx.fillRect(0, 0, size, size);

  // 瓷砖（棋盘格）
  const tileSize = 16;
  for (let y = 0; y < size; y += tileSize) {
    for (let x = 0; x < size; x += tileSize) {
      const isEven = ((x / tileSize) + (y / tileSize)) % 2 === 0;
      ctx.fillStyle = isEven ? tileColor1 : tileColor2;
      ctx.fillRect(x + 1, y + 1, tileSize - 2, tileSize - 2);
    }
  }
}

// =============================================================================
// Library（编辑书房）— 沉稳色调、书架/木纹纹理
// =============================================================================

function drawLibraryWall(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const woodBase = lit ? '#8b5a2b' : '#5c3a1e';
  const shelfColor = lit ? '#6b4226' : '#4a2c17';
  const bookColors = lit
    ? ['#c53030', '#2b6cb0', '#276749', '#744210', '#6b46c1']
    : ['#742a2a', '#1a365d', '#1c4532', '#453311', '#44337a'];

  ctx.fillStyle = woodBase;
  ctx.fillRect(0, 0, size, size);

  // 垂直木柱分隔
  const colCount = 3;
  const colW = size / colCount;
  for (let i = 1; i < colCount; i++) {
    ctx.fillStyle = adjustBrightness(woodBase, 0.7);
    ctx.fillRect(i * colW - 2, 0, 4, size);
  }

  // 水平书架层
  const shelfCount = 5;
  const shelfH = size / shelfCount;
  for (let i = 0; i < shelfCount; i++) {
    const y = (i + 1) * shelfH - 3;
    ctx.fillStyle = shelfColor;
    ctx.fillRect(0, y, size, 3);

    // 每层放书
    for (let c = 0; c < colCount; c++) {
      const cx = c * colW + 4;
      const cw = colW - 8;
      let bx = cx;
      while (bx < cx + cw - 6) {
        const bw = random.between(4, 10);
        const bh = random.between(shelfH * 0.4, shelfH * 0.75);
        const by = y - bh;
        const color = bookColors[random.between(0, bookColors.length - 1)];
        ctx.fillStyle = color;
        ctx.fillRect(bx, by, bw, bh);
        bx += bw + 1;
      }
    }
  }
}

function drawLibraryRoof(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const baseColor = lit ? '#5c3a1e' : '#3d2614';
  const tileColor = lit ? '#744210' : '#4a2c17';
  const tileDark = lit ? '#55300d' : '#331d0a';

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  // 传统斜屋顶瓦片（交错半圆/圆弧）
  const tileW = 16;
  const tileH = 12;
  const rows = Math.ceil(size / tileH) + 1;
  const cols = Math.ceil(size / tileW) + 1;

  for (let row = 0; row < rows; row++) {
    const y = row * tileH;
    const offset = (row % 2) * (tileW / 2);
    for (let col = -1; col < cols; col++) {
      const x = col * tileW + offset;
      const isDark = random.next() > 0.5;
      ctx.fillStyle = isDark ? tileDark : tileColor;
      ctx.beginPath();
      ctx.arc(x + tileW / 2, y, tileW / 2 + 1, 0, Math.PI);
      ctx.fill();
    }
  }
}

function drawLibraryFoundation(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const woodBase = lit ? '#8b5a2b' : '#5c3a1e';

  ctx.fillStyle = woodBase;
  ctx.fillRect(0, 0, size, size);

  // 平行木纹线条
  const grainCount = 12;
  ctx.strokeStyle = lit ? '#6b4226' : '#4a2c17';
  ctx.lineWidth = 1;
  for (let i = 0; i < grainCount; i++) {
    const y = random.between(0, size);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }

  // 木板接缝
  ctx.strokeStyle = lit ? '#4a2c17' : '#2d1a0d';
  ctx.lineWidth = 2;
  const plankCount = 4;
  const plankW = size / plankCount;
  for (let i = 1; i < plankCount; i++) {
    const x = i * plankW;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }
}

// =============================================================================
// Command（指挥中心）— 醒目色调、混凝土/科技纹理
// =============================================================================

function drawCommandWall(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const concreteBase = lit ? '#718096' : '#4a5568';
  const metalColor = lit ? '#e2e8f0' : '#a0aec0';
  const metalDark = lit ? '#cbd5e0' : '#718096';

  ctx.fillStyle = concreteBase;
  ctx.fillRect(0, 0, size, size);

  // 混凝土纹理（斜向线条）
  ctx.strokeStyle = lit ? '#4a5568' : '#2d3748';
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.4;
  for (let i = -size; i < size * 2; i += 8) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + size, size);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 金属装饰条（横向 + 纵向）
  ctx.fillStyle = metalColor;
  ctx.fillRect(0, size * 0.3, size, 4);
  ctx.fillRect(0, size * 0.7, size, 4);
  ctx.fillRect(size * 0.3, 0, 4, size);
  ctx.fillRect(size * 0.7, 0, 4, size);

  // 金属铆钉
  const rivetPositions = [
    { x: size * 0.3, y: size * 0.3 },
    { x: size * 0.7, y: size * 0.3 },
    { x: size * 0.3, y: size * 0.7 },
    { x: size * 0.7, y: size * 0.7 },
  ];
  for (const rp of rivetPositions) {
    ctx.fillStyle = metalDark;
    ctx.beginPath();
    ctx.arc(rp.x + 2, rp.y + 2, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = lit ? '#ffffff' : '#cbd5e0';
    ctx.beginPath();
    ctx.arc(rp.x + 1, rp.y + 1, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCommandRoof(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const baseColor = lit ? '#4a5568' : '#1a202c';
  const antennaColor = lit ? '#a0aec0' : '#4a5568';
  const antennaHighlight = lit ? '#e2e8f0' : '#a0aec0';

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  // 军事风格天线基座（十字形 + 圆点）
  const cx = size / 2;
  const cy = size / 2;

  // 基座
  ctx.fillStyle = antennaColor;
  ctx.fillRect(cx - 8, cy - 8, 16, 16);

  // 十字
  ctx.fillStyle = antennaHighlight;
  ctx.fillRect(cx - 2, cy - 14, 4, 28);
  ctx.fillRect(cx - 14, cy - 2, 28, 4);

  // 中心圆
  ctx.fillStyle = lit ? '#ef4444' : '#991b1b';
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();

  // 外围小圆点（雷达感）
  ctx.fillStyle = lit ? '#fbbf24' : '#b45309';
  const orbitRadius = size * 0.35;
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2 + (lit ? 0.2 : 0);
    const ox = cx + Math.cos(angle) * orbitRadius;
    const oy = cy + Math.sin(angle) * orbitRadius;
    ctx.beginPath();
    ctx.arc(ox, oy, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCommandFoundation(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const baseColor = lit ? '#374151' : '#1f2937';

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  // 粗噪点
  drawNoise(ctx, size, random, 0.2, '#4b5563', '#111827', 0.5);

  // 接缝线（大块混凝土板）
  ctx.strokeStyle = lit ? '#1f2937' : '#000000';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(size / 3, 0);
  ctx.lineTo(size / 3, size);
  ctx.moveTo((size * 2) / 3, 0);
  ctx.lineTo((size * 2) / 3, size);
  ctx.moveTo(0, size / 2);
  ctx.lineTo(size, size / 2);
  ctx.stroke();
}

// =============================================================================
// 绘制调度表
// =============================================================================

type DrawFunction = (
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
) => void;

const DRAWERS: Record<BuildingType, Record<BuildingFace, DrawFunction>> = {
  [BuildingType.DataCenter]: {
    wall: drawDataCenterWall,
    roof: drawDataCenterRoof,
    foundation: drawDataCenterFoundation,
  },
  [BuildingType.Workshop]: {
    wall: drawWorkshopWall,
    roof: drawWorkshopRoof,
    foundation: drawWorkshopFoundation,
  },
  [BuildingType.Studio]: {
    wall: drawStudioWall,
    roof: drawStudioRoof,
    foundation: drawStudioFoundation,
  },
  [BuildingType.Library]: {
    wall: drawLibraryWall,
    roof: drawLibraryRoof,
    foundation: drawLibraryFoundation,
  },
  [BuildingType.Command]: {
    wall: drawCommandWall,
    roof: drawCommandRoof,
    foundation: drawCommandFoundation,
  },
};

// =============================================================================
// 公开 API
// =============================================================================

/**
 * 生成单张建筑纹理 Canvas
 * @param buildingType 建筑类型
 * @param face 纹理面（wall/roof/foundation）
 * @param state 灯光状态（lit/dim）
 * @param seed 种子字符串（建议用建筑唯一 ID）
 * @param size 纹理尺寸，默认 128
 */
export function generateBuildingTextureCanvas(
  buildingType: BuildingType,
  face: BuildingFace,
  state: LightState,
  seed: string,
  size = TEXTURE_SIZE
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('[BuildingTextureGenerator] Failed to get 2D context');
  }

  // 确定性种子：建筑 ID + 类型 + 面 + 状态
  const fullSeed = `${seed}-${buildingType}-${face}-${state}`;
  const random = new SeededRandom(fullSeed);
  const lit = state === 'lit';

  const drawer = DRAWERS[buildingType]?.[face];
  if (!drawer) {
    throw new Error(
      `[BuildingTextureGenerator] No drawer for ${buildingType}/${face}`
    );
  }

  drawer(ctx, size, random, lit);
  return canvas;
}

/**
 * 将建筑的全部 6 张纹理注册到 Phaser TextureManager
 * @param scene Phaser 场景
 * @param buildingType 建筑类型
 * @param seed 种子字符串
 * @param size 纹理尺寸，默认 128
 * @returns 已注册的纹理 key 列表
 */
export function registerBuildingTextures(
  scene: Phaser.Scene,
  buildingType: BuildingType,
  seed: string,
  size = TEXTURE_SIZE
): string[] {
  const faces: BuildingFace[] = ['wall', 'roof', 'foundation'];
  const states: LightState[] = ['lit', 'dim'];
  const keys: string[] = [];

  for (const face of faces) {
    for (const state of states) {
      const key = getBuildingTextureKey(buildingType, face, state);

      if (scene.textures.exists(key)) {
        keys.push(key);
        continue;
      }

      const canvas = generateBuildingTextureCanvas(
        buildingType,
        face,
        state,
        seed,
        size
      );
      scene.textures.addCanvas(key, canvas);
      keys.push(key);
    }
  }

  return keys;
}

/**
 * 注册所有 5 种建筑类型的全部纹理
 * @param scene Phaser 场景
 * @param seed 种子字符串（通常用游戏/地图 ID）
 * @param size 纹理尺寸，默认 128
 * @returns 已注册的纹理 key 列表
 */
export function registerAllBuildingTextures(
  scene: Phaser.Scene,
  seed: string,
  size = TEXTURE_SIZE
): string[] {
  const allTypes = Object.values(BuildingType);
  const allKeys: string[] = [];

  for (const type of allTypes) {
    const keys = registerBuildingTextures(scene, type, seed, size);
    allKeys.push(...keys);
  }

  return allKeys;
}
