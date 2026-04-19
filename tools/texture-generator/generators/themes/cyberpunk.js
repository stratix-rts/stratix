/**
 * Cyberpunk Theme Generator
 * Neon, dark, futuristic
 */

function drawCyberpunk(p, type) {
  const size = p.width;
  const palette = PALETTES.cyberpunk;
  const noise = createNoise(p.random(10000));

  switch(type) {
    case 'ground_base':
      drawCyberpunkGround(p, palette, noise, size);
      break;
    case 'ground_dark':
      drawCyberpunkGroundDark(p, palette, noise, size);
      break;
    case 'ground_light':
      drawCyberpunkGroundLight(p, palette, noise, size);
      break;
    case 'grass_tuft':
      p.background(0, 0, 0, 0);
      drawCyberpunkGrass(p, palette, size);
      break;
    case 'rock_small':
      p.background(0, 0, 0, 0);
      drawCyberpunkRock(p, palette, size);
      break;
    case 'rock_large':
      p.background(0, 0, 0, 0);
      drawCyberpunkRockLarge(p, palette, size);
      break;
    case 'flower':
      p.background(0, 0, 0, 0);
      drawCyberpunkFlower(p, palette, size);
      break;
    case 'tree':
      p.background(0, 0, 0, 0);
      drawCyberpunkTree(p, palette, size);
      break;
    case 'water':
      p.background(0, 0, 0, 0);
      drawCyberpunkWater(p, palette, size);
      break;
    case 'cloud':
      p.background(0, 0, 0, 0);
      drawCyberpunkCloud(p, palette, size);
      break;
  }
}

function drawCyberpunkGround(p, palette, noise, size) {
  p.loadPixels();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = noise(x * 0.15, y * 0.15, 0) * 0.5 + 0.5;

      // Dark base with subtle color
      let r = palette.ground.base[0];
      let g = palette.ground.base[1];
      let b = palette.ground.base[2];

      // Add grid lines
      if (x % 16 < 1 || y % 16 < 1) {
        r = Math.min(255, r + 20);
        g = Math.min(255, g + 15);
        b = Math.min(255, b + 30);
      }

      // Neon glitch
      if (noise(x * 0.3, y * 0.3, 1) > 0.85) {
        r = 0; g = 200; b = 220;
      }

      const idx = (y * size + x) * 4;
      p.pixels[idx] = r;
      p.pixels[idx + 1] = g;
      p.pixels[idx + 2] = b;
      p.pixels[idx + 3] = 255;
    }
  }
  p.updatePixels();
}

function drawCyberpunkGroundDark(p, palette, noise, size) {
  p.loadPixels();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = noise(x * 0.2, y * 0.2, 2) * 0.5 + 0.5;

      let r = palette.ground.dark[0];
      let g = palette.ground.dark[1];
      let b = palette.ground.dark[2];

      // Darker grid
      if (x % 16 < 1 || y % 16 < 1) {
        r = 80; g = 70; b = 120;
      }

      const idx = (y * size + x) * 4;
      p.pixels[idx] = r;
      p.pixels[idx + 1] = g;
      p.pixels[idx + 2] = b;
      p.pixels[idx + 3] = 255;
    }
  }
  p.updatePixels();
}

function drawCyberpunkGroundLight(p, palette, noise, size) {
  p.loadPixels();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = noise(x * 0.1, y * 0.1, 3) * 0.5 + 0.5;

      let r = palette.ground.light[0];
      let g = palette.ground.light[1];
      let b = palette.ground.light[2];

      // Light grid with glow
      if (x % 16 < 1 || y % 16 < 1) {
        r = 100; g = 80; b = 160;
      }

      const idx = (y * size + x) * 4;
      p.pixels[idx] = r;
      p.pixels[idx + 1] = g;
      p.pixels[idx + 2] = b;
      p.pixels[idx + 3] = 255;
    }
  }
  p.updatePixels();
}

function drawCyberpunkGrass(p, palette, size) {
  const cx = size / 2;
  const cy = size / 2;

  // Glowing lines instead of organic
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const len = size * 0.35;

    // Glow effect
    p.stroke(palette.grass.tip[0], palette.grass.tip[1], palette.grass.tip[2], 50);
    p.strokeWeight(6);
    p.line(cx, cy, cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);

    p.stroke(palette.grass.tip[0], palette.grass.tip[1], palette.grass.tip[2]);
    p.strokeWeight(2);
    p.line(cx, cy, cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
  }
}

function drawCyberpunkRock(p, palette, size) {
  const cx = size / 2;
  const cy = size / 2;

  // Hexagonal shape
  p.fill(palette.rock.base[0], palette.rock.base[1], palette.rock.base[2]);
  p.noStroke();
  p.beginShape();
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 - Math.PI / 6;
    const x = cx + Math.cos(angle) * size * 0.35;
    const y = cy + Math.sin(angle) * size * 0.3;
    p.vertex(x, y);
  }
  p.endShape(p.CLOSE);

  // Neon edge
  p.noFill();
  p.stroke(0, 255, 255, 200);
  p.strokeWeight(1);
  p.beginShape();
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 - Math.PI / 6;
    const x = cx + Math.cos(angle) * size * 0.36;
    const y = cy + Math.sin(angle) * size * 0.31;
    p.vertex(x, y);
  }
  p.endShape(p.CLOSE);
}

function drawCyberpunkRockLarge(p, palette, size) {
  const cx = size / 2;
  const cy = size / 2;

  // Multiple hexagons
  const shapes = [
    { x: 0, y: 0, s: 0.35 },
    { x: -12, y: 8, s: 0.25 },
    { x: 14, y: 6, s: 0.22 }
  ];

  for (const shape of shapes) {
    p.fill(palette.rock.base[0], palette.rock.base[1], palette.rock.base[2]);
    p.noStroke();
    p.beginShape();
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 - Math.PI / 6;
      const x = cx + shape.x + Math.cos(angle) * size * shape.s;
      const y = cy + shape.y + Math.sin(angle) * size * shape.s * 0.85;
      p.vertex(x, y);
    }
    p.endShape(p.CLOSE);
  }

  // Neon outlines
  p.noFill();
  p.stroke(0, 255, 255, 150);
  p.strokeWeight(1);
  for (const shape of shapes) {
    p.beginShape();
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 - Math.PI / 6;
      const x = cx + shape.x + Math.cos(angle) * size * (shape.s + 0.02);
      const y = cy + shape.y + Math.sin(angle) * size * (shape.s + 0.02) * 0.85;
      p.vertex(x, y);
    }
    p.endShape(p.CLOSE);
  }
}

function drawCyberpunkFlower(p, palette, size) {
  const cx = size / 2;
  const cy = size / 2;

  // Glowing stem
  p.stroke(palette.flower.stem[0], palette.flower.stem[1], palette.flower.stem[2]);
  p.strokeWeight(2);
  p.line(cx, cy + 10, cx, cy + 25);

  // Neon petals
  p.noStroke();
  const numPetals = 4;
  for (let i = 0; i < numPetals; i++) {
    const angle = (i / numPetals) * Math.PI * 2;
    const px = cx + Math.cos(angle) * 12;
    const py = cy + Math.sin(angle) * 12;

    // Glow
    p.fill(palette.flower.petal[0], palette.flower.petal[1], palette.flower.petal[2], 50);
    p.ellipse(px, py, 18, 18);

    p.fill(palette.flower.petal[0], palette.flower.petal[1], palette.flower.petal[2]);
    p.ellipse(px, py, 12, 12);
  }

  // Center
  p.fill(palette.flower.center[0], palette.flower.center[1], palette.flower.center[2]);
  p.circle(cx, cy, 10);

  // Bright center dot
  p.fill(255, 255, 255);
  p.circle(cx, cy, 4);
}

function drawCyberpunkTree(p, palette, size) {
  const cx = size / 2;
  const cy = size / 2;

  // Glowing trunk
  p.fill(palette.tree.trunk[0], palette.tree.trunk[1], palette.tree.trunk[2]);
  p.noStroke();
  p.rect(cx - 5, cy, 10, 28, 2);

  // Neon wireframe foliage
  p.noFill();
  p.stroke(palette.tree.foliage[0], palette.tree.foliage[1], palette.tree.foliage[2], 200);
  p.strokeWeight(2);

  // Triangular layers
  p.beginShape();
  p.vertex(cx, cy - 35);
  p.vertex(cx - 20, cy + 5);
  p.vertex(cx + 20, cy + 5);
  p.endShape(p.CLOSE);

  p.beginShape();
  p.vertex(cx, cy - 25);
  p.vertex(cx - 15, cy);
  p.vertex(cx + 15, cy);
  p.endShape(p.CLOSE);

  // Glowing nodes
  p.noStroke();
  p.fill(palette.tree.highlight[0], palette.tree.highlight[1], palette.tree.highlight[2]);
  const nodes = [[cx, cy - 30], [cx - 12, cy - 5], [cx + 10, cy - 10], [cx, cy - 15]];
  for (const [x, y] of nodes) {
    p.circle(x, y, 4);
  }
}

function drawCyberpunkWater(p, palette, size) {
  const cx = size / 2;
  const cy = size / 2;

  // Dark base
  p.fill(palette.water.deep[0], palette.water.deep[1], palette.water.deep[2]);
  p.noStroke();
  p.ellipse(cx, cy, size * 0.85, size * 0.7);

  // Circuit-like surface pattern
  p.stroke(palette.water.surface[0], palette.water.surface[1], palette.water.surface[2], 200);
  p.strokeWeight(1);
  p.noFill();
  p.ellipse(cx, cy, size * 0.6, size * 0.45);

  // Data streams
  p.stroke(138, 43, 226, 150);
  for (let i = 0; i < 4; i++) {
    const y = cy - 10 + i * 8;
    p.line(cx - 20, y, cx + 20, y);
  }

  // Sparkles
  p.noStroke();
  p.fill(0, 255, 255);
  p.circle(cx - 8, cy - 3, 3);
  p.circle(cx + 10, cy + 5, 2);
}

function drawCyberpunkCloud(p, palette, size) {
  const cx = size / 2;
  const cy = size / 2;

  // Dark cloud mass
  p.fill(palette.cloud.fill[0], palette.cloud.fill[1], palette.cloud.fill[2], 200);
  p.noStroke();
  p.ellipse(cx - 12, cy, 24, 18);
  p.ellipse(cx + 10, cy - 2, 22, 16);
  p.ellipse(cx, cy - 8, 18, 14);

  // Neon edges
  p.noFill();
  p.stroke(138, 43, 226, 200);
  p.strokeWeight(1);
  p.ellipse(cx - 12, cy, 24, 18);
  p.ellipse(cx + 10, cy - 2, 22, 16);

  // Highlight dots
  p.fill(0, 255, 255, 200);
  p.noStroke();
  p.circle(cx - 14, cy - 5, 3);
  p.circle(cx + 8, cy - 6, 2);
}
