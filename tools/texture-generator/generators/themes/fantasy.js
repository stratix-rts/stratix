/**
 * Fantasy Theme Generator
 * Magical, lush, with golden accents
 */

function drawFantasy(p, type) {
  const size = p.width;
  const palette = PALETTES.fantasy;
  const noise = createNoise(p.random(10000));

  switch(type) {
    case 'ground_base':
      drawFantasyGround(p, palette, noise, size);
      break;
    case 'ground_dark':
      drawFantasyGroundDark(p, palette, noise, size);
      break;
    case 'ground_light':
      drawFantasyGroundLight(p, palette, noise, size);
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
      drawFantasyTree(p, palette, size);
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

function drawFantasyGround(p, palette, noise, size) {
  p.loadPixels();
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

      // Add subtle sparkle
      if (noise(x * 0.5, y * 0.5, 2) > 0.7) {
        col[0] = Math.min(255, col[0] + 20);
        col[1] = Math.min(255, col[1] + 25);
        col[2] = Math.min(255, col[2] + 15);
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

function drawFantasyGroundDark(p, palette, noise, size) {
  p.loadPixels();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = noise(x * 0.15, y * 0.15, 3) * 0.5 + 0.5;
      const col = lerpColor(palette.ground.dark, [20, 30, 18], n * 0.5);

      const idx = (y * size + x) * 4;
      p.pixels[idx] = col[0];
      p.pixels[idx + 1] = col[1];
      p.pixels[idx + 2] = col[2];
      p.pixels[idx + 3] = 255;
    }
  }
  p.updatePixels();
}

function drawFantasyGroundLight(p, palette, noise, size) {
  p.loadPixels();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = noise(x * 0.12, y * 0.12, 4) * 0.5 + 0.5;
      const col = lerpColor(palette.ground.light, [140, 180, 120], n * 0.4);

      const idx = (y * size + x) * 4;
      p.pixels[idx] = col[0];
      p.pixels[idx + 1] = col[1];
      p.pixels[idx + 2] = col[2];
      p.pixels[idx + 3] = 255;
    }
  }
  p.updatePixels();
}

function drawFantasyTree(p, palette, size) {
  const cx = size / 2;
  const cy = size / 2;

  // Trunk
  p.fill(palette.tree.trunk[0], palette.tree.trunk[1], palette.tree.trunk[2]);
  p.noStroke();
  p.rect(cx - 6, cy + 5, 12, 25, 2);

  // Foliage layers (triangular pine-like)
  const layers = [
    { y: cy - 5, w: 50, h: 18 },
    { y: cy - 18, w: 40, h: 16 },
    { y: cy - 30, w: 28, h: 14 }
  ];

  for (const layer of layers) {
    // Shadow layer
    p.fill(palette.tree.foliage[0] * 0.7, palette.tree.foliage[1] * 0.7, palette.tree.foliage[2] * 0.7);
    p.triangle(cx, layer.y + 3, cx - layer.w/2, layer.y + layer.h + 3, cx + layer.w/2, layer.y + layer.h + 3);

    // Main layer
    p.fill(palette.tree.foliage[0], palette.tree.foliage[1], palette.tree.foliage[2]);
    p.triangle(cx, layer.y, cx - layer.w/2, layer.y + layer.h, cx + layer.w/2, layer.y + layer.h);
  }

  // Golden highlights (magical)
  p.fill(255, 215, 0, 100);
  for (let i = 0; i < 5; i++) {
    const x = cx + p.random(-15, 15);
    const y = cy + p.random(-30, 0);
    p.ellipse(x, y, 3, 3);
  }
}
