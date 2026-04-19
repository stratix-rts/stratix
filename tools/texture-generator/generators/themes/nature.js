/**
 * Nature Theme Generator
 * Realistic, warm, earthy tones
 */

function drawNature(p, type) {
  const size = p.width;
  const palette = PALETTES.nature;
  const noise = createNoise(p.random(10000));

  switch(type) {
    case 'ground_base':
      drawNatureGround(p, palette, noise, size);
      break;
    case 'ground_dark':
      drawNatureGroundDark(p, palette, noise, size);
      break;
    case 'ground_light':
      drawNatureGroundLight(p, palette, noise, size);
      break;
    case 'grass_tuft':
      p.background(0, 0, 0, 0);
      drawGrassTuft(p, palette.grass, size);
      break;
    case 'rock_small':
      p.background(0, 0, 0, 0);
      drawRockSmall(p, palette.rock, size);
      break;
    case 'rock_large':
      p.background(0, 0, 0, 0);
      drawRockLarge(p, palette.rock, size);
      break;
    case 'flower':
      p.background(0, 0, 0, 0);
      drawFlower(p, palette.flower, size);
      break;
    case 'tree':
      p.background(0, 0, 0, 0);
      drawNatureTree(p, palette, size);
      break;
    case 'water':
      p.background(0, 0, 0, 0);
      drawWater(p, palette.water, size);
      break;
    case 'cloud':
      p.background(0, 0, 0, 0);
      drawCloudShape(p, palette.cloud, size, size/2, size/2, size * 0.35);
      break;
  }
}

function drawNatureGround(p, palette, noise, size) {
  p.loadPixels();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = noise(x * 0.12, y * 0.12, 0) * 0.5 + 0.5;
      const n2 = noise(x * 0.25, y * 0.25, 1) * 0.5 + 0.5;
      const combined = n * 0.6 + n2 * 0.4;

      // Earthy brown-green
      let col;
      if (combined < 0.5) {
        col = lerpColor(palette.ground.dark, palette.ground.base, combined * 2);
      } else {
        col = lerpColor(palette.ground.base, palette.ground.light, (combined - 0.5) * 2);
      }

      // Subtle texture
      if (noise(x * 0.4, y * 0.4, 2) > 0.7) {
        col[0] = Math.min(255, col[0] + 8);
        col[1] = Math.min(255, col[1] + 6);
        col[2] = Math.min(255, col[2] + 4);
      }

      const idx = (y * size + x) * 4;
      p.pixels[idx] = col[0];
      p.pixels[idx + 1] = col[1];
      p.pixels[idx + 2] = col[2];
      p.pixels[idx + 3] = 255;
    }
  }
  p.updatePixels();
}

function drawNatureGroundDark(p, palette, noise, size) {
  p.loadPixels();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = noise(x * 0.15, y * 0.15, 3) * 0.5 + 0.5;

      let col = lerpColor([40, 35, 30], palette.ground.dark, n);

      // Add some darker patches
      if (noise(x * 0.3, y * 0.3, 4) > 0.6) {
        col[0] = Math.max(0, col[0] - 15);
        col[1] = Math.max(0, col[1] - 12);
        col[2] = Math.max(0, col[2] - 10);
      }

      const idx = (y * size + x) * 4;
      p.pixels[idx] = col[0];
      p.pixels[idx + 1] = col[1];
      p.pixels[idx + 2] = col[2];
      p.pixels[idx + 3] = 255;
    }
  }
  p.updatePixels();
}

function drawNatureGroundLight(p, palette, noise, size) {
  p.loadPixels();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = noise(x * 0.1, y * 0.1, 5) * 0.5 + 0.5;

      let col = lerpColor(palette.ground.light, [180, 160, 130], n * 0.4);

      // Sandy/light patches
      if (noise(x * 0.35, y * 0.35, 6) > 0.65) {
        col[0] = Math.min(255, col[0] + 12);
        col[1] = Math.min(255, col[1] + 10);
        col[2] = Math.min(255, col[2] + 8);
      }

      const idx = (y * size + x) * 4;
      p.pixels[idx] = col[0];
      p.pixels[idx + 1] = col[1];
      p.pixels[idx + 2] = col[2];
      p.pixels[idx + 3] = 255;
    }
  }
  p.updatePixels();
}

function drawNatureTree(p, palette, size) {
  const cx = size / 2;
  const cy = size / 2;

  // Natural trunk (tapered)
  p.fill(palette.tree.trunk[0], palette.tree.trunk[1], palette.tree.trunk[2]);
  p.noStroke();
  p.beginShape();
  p.vertex(cx - 8, cy + 28);
  p.vertex(cx - 6, cy);
  p.vertex(cx + 6, cy);
  p.vertex(cx + 8, cy + 28);
  p.endShape(p.CLOSE);

  // Organic foliage (blob-like)
  const blobPositions = [
    { x: -8, y: -5, s: 22 },
    { x: 8, y: -3, s: 20 },
    { x: 0, y: -18, s: 24 },
    { x: -4, y: -28, s: 16 },
    { x: 10, y: -20, s: 14 }
  ];

  // Dark underlayer
  p.fill(palette.tree.foliage[0] * 0.7, palette.tree.foliage[1] * 0.7, palette.tree.foliage[2] * 0.7);
  for (const blob of blobPositions) {
    p.ellipse(cx + blob.x + 2, cy + blob.y + 3, blob.s, blob.s * 0.85);
  }

  // Main foliage
  p.fill(palette.tree.foliage[0], palette.tree.foliage[1], palette.tree.foliage[2]);
  for (const blob of blobPositions) {
    p.ellipse(cx + blob.x, cy + blob.y, blob.s, blob.s * 0.85);
  }

  // Highlights
  p.fill(palette.tree.highlight[0], palette.tree.highlight[1], palette.tree.highlight[2], 160);
  p.ellipse(cx - 6, cy - 20, 8, 6);
  p.ellipse(cx + 5, cy - 10, 6, 5);
}
