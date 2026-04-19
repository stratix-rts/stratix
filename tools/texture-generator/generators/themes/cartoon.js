/**
 * Cartoon Theme Generator
 * Bright, bouncy, low-poly feel
 */

function drawCartoon(p, type) {
  const size = p.width;
  const palette = PALETTES.cartoon;
  const noise = createNoise(p.random(10000));

  switch(type) {
    case 'ground_base':
      drawCartoonGround(p, palette, size);
      break;
    case 'ground_dark':
      drawCartoonGroundDark(p, palette, size);
      break;
    case 'ground_light':
      drawCartoonGroundLight(p, palette, size);
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
      drawCartoonTree(p, palette, size);
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

function drawCartoonGround(p, palette, size) {
  // Solid base color (cartoon style)
  p.background(palette.ground.base);

  // Add some variation dots
  p.noStroke();
  for (let i = 0; i < 40; i++) {
    const x = p.random(size);
    const y = p.random(size);
    const s = p.random(2, 5);
    const col = p.random() > 0.5 ? palette.ground.light : palette.ground.dark;
    p.fill(col[0], col[1], col[2], 150);
    p.ellipse(x, y, s, s);
  }

  // Border for tile effect
  p.noFill();
  p.stroke(palette.ground.dark[0], palette.ground.dark[1], palette.ground.dark[2], 80);
  p.strokeWeight(1);
  p.rect(0, 0, size, size);
}

function drawCartoonGroundDark(p, palette, size) {
  p.background(palette.ground.dark);

  // Darker dots
  p.noStroke();
  for (let i = 0; i < 30; i++) {
    const x = p.random(size);
    const y = p.random(size);
    const s = p.random(2, 4);
    p.fill(0, 0, 0, 50);
    p.ellipse(x, y, s, s);
  }

  p.noFill();
  p.stroke(0, 0, 0, 50);
  p.strokeWeight(1);
  p.rect(0, 0, size, size);
}

function drawCartoonGroundLight(p, palette, size) {
  p.background(palette.ground.light);

  // Light dots
  p.noStroke();
  for (let i = 0; i < 30; i++) {
    const x = p.random(size);
    const y = p.random(size);
    const s = p.random(2, 4);
    p.fill(255, 255, 255, 80);
    p.ellipse(x, y, s, s);
  }

  p.noFill();
  p.stroke(255, 255, 255, 50);
  p.strokeWeight(1);
  p.rect(0, 0, size, size);
}

function drawCartoonTree(p, palette, size) {
  const cx = size / 2;
  const cy = size / 2;

  // Rounded trunk
  p.fill(palette.tree.trunk[0], palette.tree.trunk[1], palette.tree.trunk[2]);
  p.noStroke();
  p.rect(cx - 8, cy, 16, 28, 4);

  // Rounded foliage (circles)
  p.fill(palette.tree.foliage[0], palette.tree.foliage[1], palette.tree.foliage[2]);
  p.circle(cx - 12, cy - 8, 28);
  p.circle(cx + 12, cy - 6, 26);
  p.circle(cx, cy - 18, 30);
  p.circle(cx - 5, cy - 28, 20);
  p.circle(cx + 8, cy - 24, 18);

  // Highlights
  p.fill(palette.tree.highlight[0], palette.tree.highlight[1], palette.tree.highlight[2], 180);
  p.circle(cx - 14, cy - 14, 10);
  p.circle(cx + 6, cy - 22, 8);
}
