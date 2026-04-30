/**
 * BuildingTextureGenerator - 建筑程序化纹理生成器
 * 为 5 种建筑类型生成独特的外墙/屋顶/地基纹理
 * 支持亮灯(lit)/暗灯(dim)两套变体
 *
 * 美术方向：赛博朋克×奇幻混搭
 * - 暗色基调 + 霓虹/魔法光效点缀
 * - 每栋建筑一种主色霓虹/魔法光
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
 * 颜色变体：整体提亮或压暗
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

/**
 * dim 版本末尾叠加深色压暗层
 */
function applyDimOverlay(
  ctx: CanvasRenderingContext2D,
  size: number,
  lit: boolean,
  opacity = 0.1
): void {
  if (!lit) {
    ctx.fillStyle = '#000000';
    ctx.globalAlpha = opacity;
    ctx.fillRect(0, 0, size, size);
    ctx.globalAlpha = 1;
  }
}

// =============================================================================
// DataCenter（赛博服务器 + 魔法数据流）— 青色霓虹 #00f5d4
// =============================================================================

function drawDataCenterWall(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const baseColor = '#1a1f2e';
  const panelColor1 = '#1e2433';
  const panelColor2 = '#232a3d';
  const lineColor = '#2d354a';
  const ledColor = lit ? '#00f5d4' : '#004d42';
  const ledBright = lit ? '#80ffea' : '#006b5b';
  const ledAlpha = lit ? 1 : 0.35;

  // 背景
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  // 金属面板水平条纹（机架），每行高度 16，共 8 行
  const rackH = 16;
  const rackCount = size / rackH;
  for (let row = 0; row < rackCount; row++) {
    const y = row * rackH;

    // 面板底色微变，增加金属质感
    ctx.fillStyle = row % 2 === 0 ? panelColor1 : panelColor2;
    ctx.fillRect(0, y, size, rackH - 1);

    // 分隔线
    ctx.fillStyle = lineColor;
    ctx.fillRect(0, y + rackH - 1, size, 1);

    // 每行 2-4 个青色霓虹 LED
    const ledCount = lit ? random.between(2, 4) : random.between(1, 3);
    for (let j = 0; j < ledCount; j++) {
      const lx = random.between(4, size - 8);
      const ly = y + random.between(4, rackH - 6);
      const isBright = random.next() > 0.5;

      ctx.globalAlpha = ledAlpha;
      ctx.fillStyle = isBright ? ledBright : ledColor;
      ctx.fillRect(lx, ly, 3, 2);
      ctx.globalAlpha = 1;

      // lit 状态发光效果
      if (lit && isBright) {
        ctx.save();
        ctx.shadowColor = '#00f5d4';
        ctx.shadowBlur = 6;
        ctx.fillStyle = ledBright;
        ctx.fillRect(lx, ly, 3, 2);
        ctx.restore();
      }
    }
  }

  // 底部阴影带（模拟地面接触阴影）
  ctx.fillStyle = '#0a0c12';
  ctx.globalAlpha = 0.6;
  ctx.fillRect(0, size - 4, size, 4);
  ctx.globalAlpha = 1;

  applyDimOverlay(ctx, size, lit, 0.08);
}

function drawDataCenterRoof(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const baseColor = '#141926';
  const gridColor = '#1e2636';
  const dotColor = lit ? '#00f5d4' : '#004d42';
  const dotAlpha = lit ? 0.9 : 0.3;

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  // 细网格线，每 16px 一条
  const gridSize = 16;
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  for (let x = gridSize; x < size; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }
  for (let y = gridSize; y < size; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }

  // 交叉点微弱青色发光点（模拟魔法数据节点）
  for (let x = gridSize; x < size; x += gridSize) {
    for (let y = gridSize; y < size; y += gridSize) {
      if (random.next() > 0.6) {
        ctx.globalAlpha = dotAlpha;
        ctx.fillStyle = dotColor;
        ctx.fillRect(x - 1, y - 1, 3, 3);
        ctx.globalAlpha = 1;

        if (lit) {
          ctx.save();
          ctx.shadowColor = '#00f5d4';
          ctx.shadowBlur = 4;
          ctx.fillStyle = dotColor;
          ctx.fillRect(x - 1, y - 1, 3, 3);
          ctx.restore();
        }
      }
    }
  }

  applyDimOverlay(ctx, size, lit, 0.05);
}

function drawDataCenterFoundation(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const baseColor = '#0f1218';
  const lineColor = '#1a1f2a';

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  // 混凝土板分割线（每 64px）
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(size / 2, 0);
  ctx.lineTo(size / 2, size);
  ctx.moveTo(0, size / 2);
  ctx.lineTo(size, size / 2);
  ctx.stroke();

  // 细微噪点
  drawNoise(ctx, size, random, 0.08, '#1a1f2a', '#0a0c12', 0.4);

  // 散热格栅/电缆槽（细横线）
  const grilleSpacing = 16;
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1;
  for (let gy = grilleSpacing; gy < size; gy += grilleSpacing) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(size, gy);
    ctx.stroke();
  }

  // 接地阴影带（底部 4px 加深）
  ctx.fillStyle = '#050505';
  ctx.globalAlpha = 0.5;
  ctx.fillRect(0, size - 4, size, 4);
  ctx.globalAlpha = 1;

  // 底边微弱青色光带（模拟地下数据线）
  const glowAlpha = lit ? 0.35 : 0.1;
  ctx.fillStyle = '#00f5d4';
  ctx.globalAlpha = glowAlpha;
  ctx.fillRect(0, size - 2, size, 2);
  ctx.globalAlpha = 1;

  applyDimOverlay(ctx, size, lit, 0.05);
}

// =============================================================================
// Workshop（锻造工坊 + 魔法熔炉）— 琥珀/橙色火焰 #ff6b35
// =============================================================================

function drawWorkshopWall(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const mortarColor = '#323232';
  const brickBase = '#6b2020';
  const glowColor = lit ? '#ff6b35' : '#8b3010';
  const glowAlpha = lit ? 0.6 : 0.2;

  ctx.fillStyle = mortarColor;
  ctx.fillRect(0, 0, size, size);

  const brickH = 16;
  const brickW = 32;
  const rows = Math.ceil(size / brickH);

  for (let row = 0; row < rows; row++) {
    const y = row * brickH;
    const offset = (row % 2) * (brickW / 2);
    const cols = Math.ceil(size / brickW) + 1;

    for (let col = -1; col < cols; col++) {
      const x = col * brickW + offset;
      // 随机砖色变化（低饱和暗红）
      const variation = random.floatBetween(0.9, 1.1);
      ctx.fillStyle = adjustBrightness(brickBase, variation);
      ctx.fillRect(x + 1, y + 1, brickW - 2, brickH - 2);
    }

    // 某些水平砖缝中有微弱橙色发光（像余烬）
    if (random.next() > 0.65) {
      const glowX = random.between(0, size - 16);
      const glowLen = random.between(6, 14);
      ctx.globalAlpha = glowAlpha;
      ctx.fillStyle = glowColor;
      ctx.fillRect(glowX, y + brickH - 1, glowLen, 1);
      ctx.globalAlpha = 1;

      if (lit) {
        ctx.save();
        ctx.shadowColor = '#ff6b35';
        ctx.shadowBlur = 4;
        ctx.fillRect(glowX, y + brickH - 1, glowLen, 1);
        ctx.restore();
      }
    }
  }

  // 底部阴影带
  ctx.fillStyle = '#0a0808';
  ctx.globalAlpha = 0.55;
  ctx.fillRect(0, size - 4, size, 4);
  ctx.globalAlpha = 1;

  applyDimOverlay(ctx, size, lit, 0.08);
}

function drawWorkshopRoof(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const baseColor = '#2a1a0a';
  const tileColor = '#3a2612';
  const tileDark = '#2a1a08';
  const flameColor = lit ? '#ff6b35' : '#8b3010';
  const flameAlpha = lit ? 0.7 : 0.25;

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  // 瓦片纹理（tileSize 整除 128）
  const tileSize = 16;
  for (let y = 0; y < size; y += tileSize) {
    for (let x = 0; x < size; x += tileSize) {
      const isDark = random.next() > 0.5;
      ctx.fillStyle = isDark ? tileDark : tileColor;
      ctx.fillRect(x + 1, y + 1, tileSize - 2, tileSize - 2);

      // 某些瓦片边缘有橙色火焰光
      if (random.next() > 0.75) {
        const edge = random.between(0, 3); // 0=top, 1=right, 2=bottom, 3=left
        ctx.globalAlpha = flameAlpha;
        ctx.fillStyle = flameColor;
        if (edge === 0) ctx.fillRect(x + 2, y + 1, tileSize - 4, 2);
        else if (edge === 1) ctx.fillRect(x + tileSize - 3, y + 2, 2, tileSize - 4);
        else if (edge === 2) ctx.fillRect(x + 2, y + tileSize - 3, tileSize - 4, 2);
        else ctx.fillRect(x + 1, y + 2, 2, tileSize - 4);
        ctx.globalAlpha = 1;

        if (lit) {
          ctx.save();
          ctx.shadowColor = '#ff6b35';
          ctx.shadowBlur = 5;
          if (edge === 0) ctx.fillRect(x + 2, y + 1, tileSize - 4, 2);
          else if (edge === 1) ctx.fillRect(x + tileSize - 3, y + 2, 2, tileSize - 4);
          else if (edge === 2) ctx.fillRect(x + 2, y + tileSize - 3, tileSize - 4, 2);
          else ctx.fillRect(x + 1, y + 2, 2, tileSize - 4);
          ctx.restore();
        }
      }
    }
  }

  applyDimOverlay(ctx, size, lit, 0.05);
}

function drawWorkshopFoundation(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const baseColor = '#1a1510';

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  // 碎石/夯土质感的噪点
  drawNoise(ctx, size, random, 0.15, '#2a2018', '#120e0a', 0.4);

  // 小石子 — 规则 4x4 网格内随机偏移，确保平铺连续
  const gridCols = 4;
  const gridRows = 4;
  const cellW = size / gridCols;
  const cellH = size / gridRows;
  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      const cx = col * cellW + random.between(4, Math.floor(cellW) - 8);
      const cy = row * cellH + random.between(4, Math.floor(cellH) - 8);
      const radius = random.between(2, 4);
      ctx.fillStyle = random.next() > 0.5 ? '#3a3028' : '#252018';
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 接地阴影带（底部 4px 加深）
  ctx.fillStyle = '#050505';
  ctx.globalAlpha = 0.5;
  ctx.fillRect(0, size - 4, size, 4);
  ctx.globalAlpha = 1;

  // 底边橙色光晕（熔炉余热倒映地面）
  const glowAlpha = lit ? 0.3 : 0.1;
  ctx.fillStyle = '#ff6b35';
  ctx.globalAlpha = glowAlpha;
  ctx.fillRect(0, size - 2, size, 2);
  ctx.globalAlpha = 1;

  applyDimOverlay(ctx, size, lit, 0.05);
}

// =============================================================================
// Studio（全息演播 + 魔法幻象）— 紫色全息 #b24bf3
// =============================================================================

function drawStudioWall(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const wallColor = '#1a1a2e';
  const frameColor = '#2d2d42';
  const glassColor = '#b24bf3';
  const glassAlpha = lit ? 0.6 : 0;

  // 整体墙面
  ctx.fillStyle = wallColor;
  ctx.fillRect(0, 0, size, size);

  // 大玻璃窗格（4x2 布局）
  const cols = 4;
  const rows = 2;
  const frameW = 2;
  const frameH = 2;
  const windowW = 30;
  const windowH = 62;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = frameW + c * (windowW + frameW);
      const y = frameH + r * (windowH + frameH);

      // 窗框
      ctx.fillStyle = frameColor;
      ctx.fillRect(x - frameW, y - frameH, windowW + frameW * 2, windowH + frameH * 2);

      if (lit) {
        // 紫色半透明全息光
        ctx.save();
        ctx.shadowColor = glassColor;
        ctx.shadowBlur = 8;
        ctx.fillStyle = glassColor;
        ctx.globalAlpha = glassAlpha;
        ctx.fillRect(x, y, windowW, windowH);
        ctx.restore();
        ctx.globalAlpha = 1;
      } else {
        // dim 状态：深色空洞，保留窗框结构
        ctx.fillStyle = '#0a0a14';
        ctx.fillRect(x, y, windowW, windowH);
      }
    }
  }

  // 底部阴影带
  ctx.fillStyle = '#0a0a12';
  ctx.globalAlpha = 0.5;
  ctx.fillRect(0, size - 4, size, 4);
  ctx.globalAlpha = 1;

  applyDimOverlay(ctx, size, lit, 0.08);
}

function drawStudioRoof(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const baseColor = '#161625';
  const skylightFrame = '#2d2d42';
  const skylightGlass = '#b24bf3';
  const glassAlpha = lit ? 0.5 : 0.12;

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  // 2×2 天窗
  const cols = 2;
  const rows = 2;
  const cellW = size / cols;
  const cellH = size / rows;
  const margin = 4;
  const glassW = cellW - margin * 2;
  const glassH = cellH - margin * 2;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cellW + margin;
      const y = r * cellH + margin;

      // 窗框
      ctx.fillStyle = skylightFrame;
      ctx.fillRect(x - 2, y - 2, glassW + 4, glassH + 4);

      if (lit) {
        // 天窗内填充紫色微弱全息光
        ctx.save();
        ctx.shadowColor = skylightGlass;
        ctx.shadowBlur = 6;
        ctx.fillStyle = skylightGlass;
        ctx.globalAlpha = glassAlpha;
        ctx.fillRect(x, y, glassW, glassH);
        ctx.restore();
        ctx.globalAlpha = 1;
      } else {
        // dim 状态：天窗暗淡但窗框可见
        ctx.fillStyle = '#0a0a14';
        ctx.fillRect(x, y, glassW, glassH);
      }
    }
  }

  applyDimOverlay(ctx, size, lit, 0.05);
}

function drawStudioFoundation(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const baseColor = '#12121e';
  const gridColor = '#1e1e2e';

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  // 细线条网格（模拟地板）
  const gridSize = 8;
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  for (let x = gridSize; x < size; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }
  for (let y = gridSize; y < size; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }

  // 接地阴影带（底部 4px 加深）
  ctx.fillStyle = '#050505';
  ctx.globalAlpha = 0.5;
  ctx.fillRect(0, size - 4, size, 4);
  ctx.globalAlpha = 1;

  // 底边微弱紫色光带
  const glowAlpha = lit ? 0.3 : 0.1;
  ctx.fillStyle = '#b24bf3';
  ctx.globalAlpha = glowAlpha;
  ctx.fillRect(0, size - 2, size, 2);
  ctx.globalAlpha = 1;

  applyDimOverlay(ctx, size, lit, 0.05);
}

// =============================================================================
// Library（古典书架 + 魔法典籍）— 金色符文 #ffd700
// =============================================================================

function drawLibraryWall(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const woodBase = '#2a1a0a';
  const shelfColor = '#3a2412';
  const bookColors = ['#6b3030', '#2a4a2a', '#2a3a5a', '#5a4a20'];
  const runeColor = lit ? '#ffd700' : '#8b6914';
  const runeAlpha = lit ? 1 : 0.3;

  ctx.fillStyle = woodBase;
  ctx.fillRect(0, 0, size, size);

  // 垂直木柱分隔 — 4 列
  const colCount = 4;
  const colW = size / colCount;
  for (let i = 1; i < colCount; i++) {
    ctx.fillStyle = '#3a2412';
    ctx.fillRect(i * colW - 2, 0, 4, size);
  }

  // 水平书架层 — 4 层
  const shelfCount = 4;
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

        // 某些书脊有金色符文发光
        if (random.next() > 0.75) {
          ctx.globalAlpha = runeAlpha;
          ctx.fillStyle = runeColor;
          ctx.fillRect(bx + 1, by + 2, 1, bh - 4);
          ctx.globalAlpha = 1;

          if (lit) {
            ctx.save();
            ctx.shadowColor = '#ffd700';
            ctx.shadowBlur = 4;
            ctx.fillStyle = runeColor;
            ctx.fillRect(bx + 1, by + 2, 1, bh - 4);
            ctx.restore();
          }
        }

        bx += bw + 1;
      }
    }
  }

  // 底部阴影带
  ctx.fillStyle = '#0a0806';
  ctx.globalAlpha = 0.5;
  ctx.fillRect(0, size - 4, size, 4);
  ctx.globalAlpha = 1;

  applyDimOverlay(ctx, size, lit, 0.08);
}

function drawLibraryRoof(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const baseColor = '#1e140a';
  const tileColor = '#2a1c0e';
  const tileDark = '#1e1408';
  const goldColor = lit ? '#ffd700' : '#8b6914';
  const goldAlpha = lit ? 0.6 : 0.2;

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  // 传统斜屋顶瓦片 — tileH=16 整除 128，arc 半径改为 tileW/2 使瓦片完全在周期内
  const tileW = 16;
  const tileH = 16;
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
      ctx.arc(x + tileW / 2, y, tileW / 2, 0, Math.PI);
      ctx.fill();

      // 偶尔有金色微光（模拟魔法防护结界）
      if (random.next() > 0.85) {
        ctx.globalAlpha = goldAlpha;
        ctx.fillStyle = goldColor;
        ctx.beginPath();
        ctx.arc(x + tileW / 2, y + 2, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        if (lit) {
          ctx.save();
          ctx.shadowColor = '#ffd700';
          ctx.shadowBlur = 4;
          ctx.beginPath();
          ctx.arc(x + tileW / 2, y + 2, 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }
  }

  applyDimOverlay(ctx, size, lit, 0.05);
}

function drawLibraryFoundation(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const woodBase = '#16100a';

  ctx.fillStyle = woodBase;
  ctx.fillRect(0, 0, size, size);

  // 木板纹理（4 块木板）
  const plankCount = 4;

  // 木纹线条
  ctx.strokeStyle = '#2a1c10';
  ctx.lineWidth = 1;
  for (let p = 0; p < plankCount; p++) {
    for (let l = 0; l < 3; l++) {
      const baseY = (p * 3 + l + 1) * (size / (plankCount * 3));
      const y = Math.floor(baseY + random.between(-2, 2));
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }
  }

  // 木板接缝
  ctx.strokeStyle = '#0f0a06';
  ctx.lineWidth = 2;
  const plankW = size / plankCount;
  for (let i = 1; i < plankCount; i++) {
    const x = i * plankW;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }

  // 接地阴影带（底部 4px 加深）
  ctx.fillStyle = '#050505';
  ctx.globalAlpha = 0.5;
  ctx.fillRect(0, size - 4, size, 4);
  ctx.globalAlpha = 1;

  // 底边微弱金色光带（魔法结界底部）
  const glowAlpha = lit ? 0.3 : 0.1;
  ctx.fillStyle = '#ffd700';
  ctx.globalAlpha = glowAlpha;
  ctx.fillRect(0, size - 2, size, 2);
  ctx.globalAlpha = 1;

  applyDimOverlay(ctx, size, lit, 0.05);
}

// =============================================================================
// Command（军事指挥 + 战争魔法）— 红色战术 #ff2e63
// =============================================================================

function drawCommandWall(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const baseColor = '#1a1e22';
  const metalColor = '#2a3038';
  const metalDark = '#1e242c';
  const lightColor = lit ? '#ff2e63' : '#661020';
  const lightBright = lit ? '#ff5c8a' : '#802030';
  const lightAlpha = lit ? 1 : 0.35;

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  // 斜线纹理（金属拉丝感）
  ctx.strokeStyle = '#22282e';
  ctx.lineWidth = 1;
  ctx.globalAlpha = lit ? 0.3 : 0.5;
  for (let i = -size; i < size * 2; i += 8) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + size, size);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 金属装饰条
  const strip1 = 32;
  const strip2 = 96;
  ctx.fillStyle = metalColor;
  ctx.fillRect(0, strip1, size, 4);
  ctx.fillRect(0, strip2, size, 4);
  ctx.fillRect(strip1, 0, 4, size);
  ctx.fillRect(strip2, 0, 4, size);

  // 金属条交叉点红色战术灯
  const lightPositions = [
    { x: strip1, y: strip1 },
    { x: strip2, y: strip1 },
    { x: strip1, y: strip2 },
    { x: strip2, y: strip2 },
  ];
  for (const lp of lightPositions) {
    // 灯座
    ctx.fillStyle = metalDark;
    ctx.fillRect(lp.x, lp.y, 4, 4);

    // 红灯
    ctx.globalAlpha = lightAlpha;
    ctx.fillStyle = random.next() > 0.5 ? lightBright : lightColor;
    ctx.beginPath();
    ctx.arc(lp.x + 2, lp.y + 2, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (lit) {
      ctx.save();
      ctx.shadowColor = '#ff2e63';
      ctx.shadowBlur = 6;
      ctx.fillStyle = lightBright;
      ctx.beginPath();
      ctx.arc(lp.x + 2, lp.y + 2, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // 底部阴影带
  ctx.fillStyle = '#0a0c0e';
  ctx.globalAlpha = 0.5;
  ctx.fillRect(0, size - 4, size, 4);
  ctx.globalAlpha = 1;

  applyDimOverlay(ctx, size, lit, 0.08);
}

function drawCommandRoof(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const baseColor = '#12161a';
  const antennaColor = '#1e242c';
  const antennaHighlight = '#2a3038';

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  // 2×2 天线阵列
  const cells = 2;
  const cellSize = size / cells;

  for (let ry = 0; ry < cells; ry++) {
    for (let rx = 0; rx < cells; rx++) {
      const cx = rx * cellSize + cellSize / 2;
      const cy = ry * cellSize + cellSize / 2;

      // 基座
      ctx.fillStyle = antennaColor;
      ctx.fillRect(cx - 4, cy - 4, 8, 8);

      // 十字
      ctx.fillStyle = antennaHighlight;
      ctx.fillRect(cx - 1, cy - 7, 2, 14);
      ctx.fillRect(cx - 7, cy - 1, 14, 2);

      // 中心红色发光点
      if (lit) {
        ctx.save();
        ctx.shadowColor = '#ff2e63';
        ctx.shadowBlur = 6;
      }
      ctx.fillStyle = lit ? '#ff2e63' : '#661020';
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
      ctx.fill();
      if (lit) {
        ctx.restore();
      }

      // 外围黄色小圆点（雷达感）
      ctx.fillStyle = lit ? '#fbbf24' : '#8b6914';
      const orbitRadius = cellSize * 0.3;
      for (let i = 0; i < 4; i++) {
        const angle = (i * Math.PI) / 2 + (lit ? 0.2 : 0);
        const ox = cx + Math.cos(angle) * orbitRadius;
        const oy = cy + Math.sin(angle) * orbitRadius;
        ctx.beginPath();
        ctx.arc(ox, oy, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  applyDimOverlay(ctx, size, lit, 0.05);
}

function drawCommandFoundation(
  ctx: CanvasRenderingContext2D,
  size: number,
  random: SeededRandom,
  lit: boolean
): void {
  const baseColor = '#0e1214';
  const lineColor = '#1a2024';

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  // 粗噪点
  drawNoise(ctx, size, random, 0.15, '#1a2024', '#080a0c', 0.5);

  // 接缝线
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(size / 4, 0);
  ctx.lineTo(size / 4, size);
  ctx.moveTo(size / 2, 0);
  ctx.lineTo(size / 2, size);
  ctx.moveTo((size * 3) / 4, 0);
  ctx.lineTo((size * 3) / 4, size);
  ctx.moveTo(0, size / 2);
  ctx.lineTo(size, size / 2);
  ctx.stroke();

  // 接地阴影带（底部 4px 加深）
  ctx.fillStyle = '#050505';
  ctx.globalAlpha = 0.5;
  ctx.fillRect(0, size - 4, size, 4);
  ctx.globalAlpha = 1;

  // 底边红色微弱光带（战争魔法阵）
  const glowAlpha = lit ? 0.3 : 0.1;
  ctx.fillStyle = '#ff2e63';
  ctx.globalAlpha = glowAlpha;
  ctx.fillRect(0, size - 2, size, 2);
  ctx.globalAlpha = 1;

  applyDimOverlay(ctx, size, lit, 0.05);
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
