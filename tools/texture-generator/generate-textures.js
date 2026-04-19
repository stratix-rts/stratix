#!/usr/bin/env node

/**
 * Stratix Texture Generator - Node.js CLI
 * Generates all 4 theme textures without browser
 *
 * Usage: node generate-textures.js [theme] [type]
 *   node generate-textures.js        # Generate all
 *   node generate-textures.js fantasy # Generate fantasy only
 *   node generate-textures.js fantasy ground_base # Single texture
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// ============ Simplex Noise ============

function createNoise(seed) {
  const p = new Uint8Array(256);
  const perm = new Uint8Array(512);
  const grad3 = [
    1,1,0, -1,1,0, 1,-1,0, -1,-1,0,
    1,0,1, -1,0,1, 1,0,-1, -1,0,-1,
    0,1,1, 0,-1,1, 0,1,-1, 0,-1,-1
  ];

  const random = seedRandom(seed);

  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  function seedRandom(seed) {
    return function() {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  }

  function dot3(g, x, y, z) {
    return g[0] * x + g[1] * y + g[2] * z;
  }

  return function(xin, yin, zin) {
    const F3 = 1.0 / 3.0;
    const G3 = 1.0 / 6.0;
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const X0 = i - t;
    const Y0 = j - t;
    const Z0 = k - t;
    const x0 = xin - X0;
    const y0 = yin - Y0;
    const z0 = yin - Z0;

    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1=1; j1=0; k1=0; i2=1; j2=1; k2=0; }
      else if (x0 >= z0) { i1=1; j1=0; k1=0; i2=1; j2=0; k2=1; }
      else { i1=0; j1=0; k1=1; i2=1; j2=0; k2=1; }
    } else {
      if (y0 < z0) { i1=0; j1=0; k1=1; i2=0; j2=1; k2=1; }
      else if (x0 < z0) { i1=0; j1=1; k1=0; i2=0; j2=1; k2=1; }
      else { i1=0; j1=1; k1=0; i2=1; j2=1; k2=0; }
    }

    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2.0 * G3;
    const y2 = y0 - j2 + 2.0 * G3;
    const z2 = z0 - k2 + 2.0 * G3;
    const x3 = x0 - 1.0 + 3.0 * G3;
    const y3 = y0 - 1.0 + 3.0 * G3;
    const z3 = z0 - 1.0 + 3.0 * G3;

    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;

    let n0 = 0, n1 = 0, n2 = 0, n3 = 0;
    let t0 = 0.6 - x0*x0 - y0*y0 - z0*z0;
    if (t0 >= 0) {
      t0 *= t0;
      const gi0 = perm[ii + perm[jj + perm[kk]]] % 12;
      n0 = t0 * t0 * dot3(grad3, gi0 * 3, x0, y0, z0);
    }

    let t1 = 0.6 - x1*x1 - y1*y1 - z1*z1;
    if (t1 >= 0) {
      t1 *= t1;
      const gi1 = perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]] % 12;
      n1 = t1 * t1 * dot3(grad3, gi1 * 3, x1, y1, z1);
    }

    let t2 = 0.6 - x2*x2 - y2*y2 - z2*z2;
    if (t2 >= 0) {
      t2 *= t2;
      const gi2 = perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]] % 12;
      n2 = t2 * t2 * dot3(grad3, gi2 * 3, x2, y2, z2);
    }

    let t3 = 0.6 - x3*x3 - y3*y3 - z3*z3;
    if (t3 >= 0) {
      t3 *= t3;
      const gi3 = perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]] % 12;
      n3 = t3 * t3 * dot3(grad3, gi3 * 3, x3, y3, z3);
    }

    return 32.0 * (n0 + n1 + n2 + n3);
  };
}

// ============ Color Palettes ============

const PALETTES = {
  fantasy: {
    name: 'Fantasy',
    ground: { base: [60, 90, 50], dark: [40, 60, 35], light: [80, 120, 70] },
    grass: { base: [50, 100, 40], tip: [90, 160, 60], dark: [35, 70, 30] },
    rock: { base: [100, 90, 80], shadow: [70, 60, 55], highlight: [130, 120, 110] },
    flower: { petal: [220, 180, 100], center: [250, 200, 50], stem: [60, 100, 40] },
    tree: { trunk: [80, 50, 30], foliage: [40, 100, 50], highlight: [60, 140, 70] },
    water: { deep: [30, 60, 90], surface: [60, 100, 130], foam: [150, 180, 200] },
    cloud: { fill: [240, 240, 255], shadow: [200, 200, 220], highlight: [255, 255, 255] }
  },
  cartoon: {
    name: 'Cartoon',
    ground: { base: [100, 160, 80], dark: [70, 120, 50], light: [140, 200, 120] },
    grass: { base: [80, 180, 60], tip: [150, 230, 100], dark: [50, 140, 40] },
    rock: { base: [160, 160, 160], shadow: [120, 120, 120], highlight: [200, 200, 200] },
    flower: { petal: [255, 120, 120], center: [255, 220, 50], stem: [80, 160, 60] },
    tree: { trunk: [139, 90, 43], foliage: [34, 139, 34], highlight: [60, 180, 60] },
    water: { deep: [65, 105, 225], surface: [100, 150, 255], foam: [200, 220, 255] },
    cloud: { fill: [255, 255, 255], shadow: [200, 200, 200], highlight: [255, 255, 255] }
  },
  cyberpunk: {
    name: 'Cyberpunk',
    ground: { base: [30, 20, 40], dark: [20, 15, 30], light: [50, 35, 70] },
    grass: { base: [0, 150, 136], tip: [0, 200, 180], dark: [0, 100, 90] },
    rock: { base: [80, 70, 100], shadow: [50, 45, 70], highlight: [120, 110, 150] },
    flower: { petal: [255, 0, 255], center: [0, 255, 255], stem: [0, 150, 136] },
    tree: { trunk: [50, 50, 70], foliage: [0, 200, 180], highlight: [138, 43, 226] },
    water: { deep: [20, 10, 40], surface: [75, 0, 130], foam: [138, 43, 226] },
    cloud: { fill: [100, 0, 150], shadow: [60, 0, 100], highlight: [180, 50, 255] }
  },
  nature: {
    name: 'Nature',
    ground: { base: [120, 100, 80], dark: [90, 75, 60], light: [150, 130, 105] },
    grass: { base: [85, 120, 60], tip: [120, 160, 90], dark: [60, 90, 45] },
    rock: { base: [115, 110, 105], shadow: [85, 80, 75], highlight: [145, 140, 135] },
    flower: { petal: [255, 200, 180], center: [255, 220, 100], stem: [85, 120, 60] },
    tree: { trunk: [90, 60, 40], foliage: [60, 100, 50], highlight: [90, 130, 70] },
    water: { deep: [40, 80, 100], surface: [70, 120, 140], foam: [180, 200, 210] },
    cloud: { fill: [220, 225, 230], shadow: [180, 185, 195], highlight: [250, 252, 255] }
  }
};

// ============ Texture Generators ============

function lerpColor(c1, c2, t) {
  return [
    Math.round(c1[0] + (c2[0] - c1[0]) * t),
    Math.round(c1[1] + (c2[1] - c1[1]) * t),
    Math.round(c1[2] + (c2[2] - c1[2]) * t)
  ];
}

function generateGroundBase(size, palette, seed) {
  const png = new PNG({ width: size, height: size });
  const noise = createNoise(seed);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = noise(x * 0.1, y * 0.1, 0) * 0.5 + 0.5;
      const n2 = noise(x * 0.2, y * 0.2, 1) * 0.5 + 0.5;
      const combined = n * 0.7 + n2 * 0.3;

      let col;
      if (combined < 0.4) {
        col = lerpColor(palette.ground.dark, palette.ground.base, combined / 0.4);
      } else {
        col = lerpColor(palette.ground.base, palette.ground.light, (combined - 0.4) / 0.6);
      }

      // Add sparkle for fantasy
      if (seed > 50000 && noise(x * 0.5, y * 0.5, 2) > 0.7) {
        col[0] = Math.min(255, col[0] + 20);
        col[1] = Math.min(255, col[1] + 25);
        col[2] = Math.min(255, col[2] + 15);
      }

      const idx = (y * size + x) * 4;
      png.data[idx] = col[0];
      png.data[idx + 1] = col[1];
      png.data[idx + 2] = col[2];
      png.data[idx + 3] = 255;
    }
  }
  return png;
}

function generateGroundDark(size, palette, seed) {
  const png = new PNG({ width: size, height: size });
  const noise = createNoise(seed);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = noise(x * 0.15, y * 0.15, 3) * 0.5 + 0.5;
      const col = lerpColor(palette.ground.dark, [20, 30, 18], n * 0.5);

      const idx = (y * size + x) * 4;
      png.data[idx] = col[0];
      png.data[idx + 1] = col[1];
      png.data[idx + 2] = col[2];
      png.data[idx + 3] = 255;
    }
  }
  return png;
}

function generateGroundLight(size, palette, seed) {
  const png = new PNG({ width: size, height: size });
  const noise = createNoise(seed);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = noise(x * 0.12, y * 0.12, 4) * 0.5 + 0.5;
      const col = lerpColor(palette.ground.light, [140, 180, 120], n * 0.4);

      const idx = (y * size + x) * 4;
      png.data[idx] = col[0];
      png.data[idx + 1] = col[1];
      png.data[idx + 2] = col[2];
      png.data[idx + 3] = 255;
    }
  }
  return png;
}

function generateGrass(size, palette, seed) {
  const png = new PNG({ width: size, height: size });
  const cx = size / 2;
  const cy = size / 2;

  // Transparent background
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 0;
    png.data[i + 1] = 0;
    png.data[i + 2] = 0;
    png.data[i + 3] = 0;
  }

  // Draw grass blades
  const numBlades = 12;
  for (let i = 0; i < numBlades; i++) {
    const angle = (i / numBlades) * Math.PI * 2 + (seed % 100) * 0.01;
    const len = size * 0.35 + (seed % 30) * 0.3;
    const lean = ((seed + i) % 60 - 30) * 0.01;

    const x1 = cx + Math.cos(angle) * size * 0.15;
    const y1 = cy + Math.sin(angle) * size * 0.15;
    const x2 = x1 + Math.cos(angle + lean) * len;
    const y2 = y1 - len;

    // Draw line
    const steps = 10;
    for (let t = 0; t < steps; t++) {
      const tx = Math.round(x1 + (x2 - x1) * (t / steps));
      const ty = Math.round(y1 + (y2 - y1) * (t / steps));
      if (tx >= 0 && tx < size && ty >= 0 && ty < size) {
        const col = lerpColor(palette.grass.base, palette.grass.tip, t / steps);
        const idx = (ty * size + tx) * 4;
        png.data[idx] = col[0];
        png.data[idx + 1] = col[1];
        png.data[idx + 2] = col[2];
        png.data[idx + 3] = 255;
      }
    }
  }

  // Center cluster
  for (let i = 0; i < 8; i++) {
    const bx = cx + ((seed + i * 17) % 20 - 10);
    const by = cy + ((seed + i * 23) % 20 - 10);
    const s = 3 + (seed % 3);

    for (let dy = -s; dy <= s; dy++) {
      for (let dx = -s; dx <= s; dx++) {
        if (dx * dx + dy * dy <= s * s) {
          const tx = Math.round(bx + dx);
          const ty = Math.round(by + dy);
          if (tx >= 0 && tx < size && ty >= 0 && ty < size) {
            const idx = (ty * size + tx) * 4;
            png.data[idx] = palette.grass.base[0];
            png.data[idx + 1] = palette.grass.base[1];
            png.data[idx + 2] = palette.grass.base[2];
            png.data[idx + 3] = 255;
          }
        }
      }
    }
  }

  return png;
}

function generateRock(size, palette, seed, large = false) {
  const png = new PNG({ width: size, height: size });

  // Transparent background
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 0;
    png.data[i + 1] = 0;
    png.data[i + 2] = 0;
    png.data[i + 3] = 0;
  }

  const cx = size / 2;
  const cy = size / 2;
  const noise = createNoise(seed);

  function drawEllipse(x, y, rx, ry, color, alpha = 255) {
    for (let dy = -ry; dy <= ry; dy++) {
      for (let dx = -rx; dx <= rx; dx++) {
        if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) {
          const tx = Math.round(x + dx);
          const ty = Math.round(y + dy);
          if (tx >= 0 && tx < size && ty >= 0 && ty < size) {
            const idx = (ty * size + tx) * 4;
            png.data[idx] = color[0];
            png.data[idx + 1] = color[1];
            png.data[idx + 2] = color[2];
            png.data[idx + 3] = alpha;
          }
        }
      }
    }
  }

  if (large) {
    // Shadow
    drawEllipse(cx + 3, cy + 4, size * 0.32, size * 0.25, palette.rock.shadow, 150);
    drawEllipse(cx - size * 0.17 + 3, cy + size * 0.14 + 4, size * 0.22, size * 0.17, palette.rock.shadow, 150);
    drawEllipse(cx + size * 0.16 + 3, cy + size * 0.08 + 4, size * 0.2, size * 0.15, palette.rock.shadow, 150);

    // Main rocks
    const baseColor = palette.rock.base;
    drawEllipse(cx, cy, size * 0.32, size * 0.25, baseColor);
    drawEllipse(cx - size * 0.17, cy + size * 0.14, size * 0.22, size * 0.17, baseColor);
    drawEllipse(cx + size * 0.16, cy + size * 0.08, size * 0.2, size * 0.15, baseColor);

    // Highlights
    drawEllipse(cx - size * 0.08, cy - size * 0.08, size * 0.12, size * 0.1, palette.rock.highlight, 180);
    drawEllipse(cx + size * 0.1, cy - size * 0.02, size * 0.08, size * 0.06, palette.rock.highlight, 180);
  } else {
    // Shadow
    drawEllipse(cx + 2, cy + 3, size * 0.28, size * 0.22, palette.rock.shadow, 150);

    // Main rock
    drawEllipse(cx, cy, size * 0.28, size * 0.22, palette.rock.base);

    // Highlight
    drawEllipse(cx - size * 0.1, cy - size * 0.08, size * 0.1, size * 0.08, palette.rock.highlight, 180);
  }

  return png;
}

function generateFlower(size, palette, seed) {
  const png = new PNG({ width: size, height: size });

  // Transparent background
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 0;
    png.data[i + 1] = 0;
    png.data[i + 2] = 0;
    png.data[i + 3] = 0;
  }

  const cx = size / 2;
  const cy = size / 2;

  function drawPixel(x, y, color, alpha = 255) {
    if (x >= 0 && x < size && y >= 0 && y < size) {
      const idx = (Math.round(y) * size + Math.round(x)) * 4;
      png.data[idx] = color[0];
      png.data[idx + 1] = color[1];
      png.data[idx + 2] = color[2];
      png.data[idx + 3] = alpha;
    }
  }

  // Stem
  for (let y = cy + 5; y < cy + size * 0.4; y++) {
    drawPixel(cx, y, palette.flower.stem);
  }

  // Petals
  const numPetals = 5;
  for (let i = 0; i < numPetals; i++) {
    const angle = (i / numPetals) * Math.PI * 2 - Math.PI / 2;
    const px = cx + Math.cos(angle) * size * 0.18;
    const py = cy + Math.sin(angle) * size * 0.13;
    const petalSize = size * 0.1;

    for (let dy = -petalSize; dy <= petalSize; dy++) {
      for (let dx = -petalSize; dx <= petalSize; dx++) {
        if (dx * dx + dy * dy <= petalSize * petalSize) {
          drawPixel(px + dx, py + dy, palette.flower.petal);
        }
      }
    }
  }

  // Center
  const centerSize = size * 0.08;
  for (let dy = -centerSize; dy <= centerSize; dy++) {
    for (let dx = -centerSize; dx <= centerSize; dx++) {
      if (dx * dx + dy * dy <= centerSize * centerSize) {
        drawPixel(cx + dx, cy + dy, palette.flower.center);
      }
    }
  }

  return png;
}

function generateTree(size, palette, seed) {
  const png = new PNG({ width: size, height: size });

  // Transparent background
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 0;
    png.data[i + 1] = 0;
    png.data[i + 2] = 0;
    png.data[i + 3] = 0;
  }

  const cx = size / 2;
  const cy = size / 2;

  function drawPixel(x, y, color, alpha = 255) {
    if (x >= 0 && x < size && y >= 0 && y < size) {
      const idx = (Math.round(y) * size + Math.round(x)) * 4;
      png.data[idx] = color[0];
      png.data[idx + 1] = color[1];
      png.data[idx + 2] = color[2];
      png.data[idx + 3] = alpha;
    }
  }

  // Trunk
  for (let y = cy; y < cy + size * 0.45; y++) {
    const width = 6 + (y - cy) * 0.1;
    for (let dx = -width; dx <= width; dx++) {
      drawPixel(cx + dx, y, palette.tree.trunk);
    }
  }

  // Foliage layers (triangular for fantasy, circular for cartoon)
  const theme = getThemeFromPalette(palette);

  if (theme === 'fantasy' || theme === 'cyberpunk') {
    // Triangular layers
    const layers = [
      { y: cy - size * 0.08, w: size * 0.38, h: size * 0.28 },
      { y: cy - size * 0.28, w: size * 0.30, h: size * 0.25 },
      { y: cy - size * 0.47, w: size * 0.20, h: size * 0.22 }
    ];

    for (const layer of layers) {
      // Draw filled triangle
      for (let dy = 0; dy < layer.h; dy++) {
        const halfWidth = layer.w * (1 - dy / layer.h) / 2;
        for (let dx = -halfWidth; dx <= halfWidth; dx++) {
          drawPixel(cx + dx, layer.y + dy, palette.tree.foliage);
        }
      }
    }

    // Golden highlights for fantasy
    if (theme === 'fantasy') {
      for (let i = 0; i < 8; i++) {
        const x = cx + ((seed + i * 31) % 30 - 15);
        const y = cy - ((seed + i * 47) % 40);
        drawPixel(x, y, [255, 215, 0], 150);
      }
    }

    // Neon nodes for cyberpunk
    if (theme === 'cyberpunk') {
      const nodes = [[cx, cy - size * 0.45], [cx - size * 0.15, cy - size * 0.2], [cx + size * 0.12, cy - size * 0.3]];
      for (const [x, y] of nodes) {
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            if (dx * dx + dy * dy <= 9) {
              drawPixel(x + dx, y + dy, [0, 255, 255], 200);
            }
          }
        }
      }
    }
  } else {
    // Circular blobs for cartoon/nature
    const blobs = [
      { x: -12, y: -8, s: 20 },
      { x: 12, y: -6, s: 18 },
      { x: 0, y: -18, s: 22 },
      { x: -5, y: -28, s: 14 },
      { x: 8, y: -24, s: 12 }
    ];

    for (const blob of blobs) {
      for (let dy = -blob.s; dy <= blob.s; dy++) {
        for (let dx = -blob.s; dx <= blob.s; dx++) {
          if (dx * dx + dy * dy <= blob.s * blob.s) {
            drawPixel(cx + blob.x + dx, cy + blob.y + dy, palette.tree.foliage);
          }
        }
      }
    }

    // Highlights
    for (let dy = -5; dy <= 5; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        if (dx * dx + dy * dy <= 25) {
          drawPixel(cx - 10 + dx, cy - 18 + dy, palette.tree.highlight, 150);
        }
      }
    }
  }

  return png;
}

function generateWater(size, palette, seed) {
  const png = new PNG({ width: size, height: size });
  const cx = size / 2;
  const cy = size / 2;
  const noise = createNoise(seed);

  function drawEllipse(x, y, rx, ry, color, alpha = 255) {
    for (let dy = -ry; dy <= ry; dy++) {
      for (let dx = -rx; dx <= rx; dx++) {
        if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) {
          const tx = Math.round(x + dx);
          const ty = Math.round(y + dy);
          if (tx >= 0 && tx < size && ty >= 0 && ty < size) {
            const idx = (ty * size + tx) * 4;
            png.data[idx] = color[0];
            png.data[idx + 1] = color[1];
            png.data[idx + 2] = color[2];
            png.data[idx + 3] = alpha;
          }
        }
      }
    }
  }

  // Main water body
  drawEllipse(cx, cy, size * 0.4, size * 0.32, palette.water.deep);

  // Surface layer
  drawEllipse(cx, cy, size * 0.3, size * 0.22, palette.water.surface, 180);

  // Foam ripples
  for (let i = 1; i <= 3; i++) {
    const rx = size * 0.15 * i;
    const ry = size * 0.12 * i;
    drawEllipse(cx - i * 2, cy - i * 1.5, rx, ry, palette.water.foam, 80);
  }

  // Sparkles
  const sparkles = [[cx - 8, cy - 3], [cx + 10, cy + 4], [cx - 2, cy + 8]];
  for (const [sx, sy] of sparkles) {
    drawEllipse(sx, sy, 2, 2, [255, 255, 255], 200);
  }

  return png;
}

function generateCloud(size, palette, seed) {
  const png = new PNG({ width: size, height: size });

  // Transparent background
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 0;
    png.data[i + 1] = 0;
    png.data[i + 2] = 0;
    png.data[i + 3] = 0;
  }

  const cx = size / 2;
  const cy = size / 2;

  function drawEllipse(x, y, rx, ry, color, alpha = 255) {
    for (let dy = -ry; dy <= ry; dy++) {
      for (let dx = -rx; dx <= rx; dx++) {
        if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) {
          const tx = Math.round(x + dx);
          const ty = Math.round(y + dy);
          if (tx >= 0 && tx < size && ty >= 0 && ty < size) {
            const idx = (ty * size + tx) * 4;
            png.data[idx] = color[0];
            png.data[idx + 1] = color[1];
            png.data[idx + 2] = color[2];
            png.data[idx + 3] = alpha;
          }
        }
      }
    }
  }

  // Shadow
  drawEllipse(cx - 10 + 3, cy + 3, 20, 14, palette.cloud.shadow, 100);
  drawEllipse(cx + 12 + 3, cy + 2 + 3, 18, 12, palette.cloud.shadow, 100);

  // Main cloud puffs
  drawEllipse(cx - 10, cy, 20, 14, palette.cloud.fill);
  drawEllipse(cx + 12, cy + 2, 18, 12, palette.cloud.fill);
  drawEllipse(cx, cy - 5, 16, 12, palette.cloud.fill);
  drawEllipse(cx - 5, cy + 6, 14, 10, palette.cloud.fill);
  drawEllipse(cx + 6, cy + 5, 12, 9, palette.cloud.fill);

  // Highlight
  drawEllipse(cx - 12, cy - 4, 8, 5, palette.cloud.highlight, 200);

  return png;
}

function getThemeFromPalette(palette) {
  for (const [theme, p] of Object.entries(PALETTES)) {
    if (p === palette) return theme;
  }
  return 'fantasy';
}

// ============ Main ============

const SIZE = 64;
const OUTPUT_DIR = path.join(__dirname, 'output');

const textureTypes = [
  'ground_base',
  'ground_dark',
  'ground_light',
  'grass_tuft',
  'rock_small',
  'rock_large',
  'flower',
  'tree',
  'water',
  'cloud'
];

const generators = {
  ground_base: (size, palette, seed) => generateGroundBase(size, palette, seed),
  ground_dark: (size, palette, seed) => generateGroundDark(size, palette, seed),
  ground_light: (size, palette, seed) => generateGroundLight(size, palette, seed),
  grass_tuft: (size, palette, seed) => generateGrass(size, palette, seed),
  rock_small: (size, palette, seed) => generateRock(size, palette, seed, false),
  rock_large: (size, palette, seed) => generateRock(size, palette, seed, true),
  flower: (size, palette, seed) => generateFlower(size, palette, seed),
  tree: (size, palette, seed) => generateTree(size, palette, seed),
  water: (size, palette, seed) => generateWater(size, palette, seed),
  cloud: (size, palette, seed) => generateCloud(size, palette, seed)
};

function generateTexture(theme, type, seed) {
  const palette = PALETTES[theme];
  if (!palette) {
    console.error(`Unknown theme: ${theme}`);
    process.exit(1);
  }

  const generator = generators[type];
  if (!generator) {
    console.error(`Unknown texture type: ${type}`);
    process.exit(1);
  }

  const png = generator(SIZE, palette, seed);

  // Ensure output directory exists
  const themeDir = path.join(OUTPUT_DIR, theme);
  if (!fs.existsSync(themeDir)) {
    fs.mkdirSync(themeDir, { recursive: true });
  }

  // 文件名不带 theme 前缀（主题由文件夹区分）
  // 路径: output/{theme}/{type}.png
  const filename = `${type}.png`;
  const filepath = path.join(themeDir, filename);

  png.pack().pipe(fs.createWriteStream(filepath));
  console.log(`Generated: ${theme}/${filename}`);

  return filepath;
}

function generateTheme(theme) {
  console.log(`\n=== Generating ${theme} theme ===`);
  const palette = PALETTES[theme];
  let count = 0;

  for (const type of textureTypes) {
    const seed = Math.floor(Math.random() * 100000);
    generateTexture(theme, type, seed);
    count++;
  }

  console.log(`Generated ${count} textures for ${palette.name}`);
}

function generateAll() {
  console.log('=== Generating all 4 themes (40 textures) ===\n');

  for (const theme of Object.keys(PALETTES)) {
    generateTheme(theme);
  }

  console.log('\n=== All done! ===');
  console.log(`Output directory: ${OUTPUT_DIR}`);
}

// CLI
const args = process.argv.slice(2);
if (args.length === 0) {
  generateAll();
} else if (args.length === 1) {
  generateTheme(args[0]);
} else if (args.length === 2) {
  generateTexture(args[0], args[1], Math.floor(Math.random() * 100000));
} else {
  console.log('Usage: node generate-textures.js [theme] [type]');
  console.log('  node generate-textures.js        # Generate all');
  console.log('  node generate-textures.js fantasy # Generate fantasy only');
  console.log('  node generate-textures.js fantasy ground_base # Single texture');
}
