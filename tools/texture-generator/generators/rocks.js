/**
 * Rock texture generator
 * Creates varied rocky surfaces
 */

function drawRock(p) {
  const SIZE = p.width;

  // Base stone color
  p.background(80, 75, 70);

  const noise = createNoise(p.random(10000));

  // Draw multiple rock blobs
  const numRocks = p.random(3, 6);
  for (let i = 0; i < numRocks; i++) {
    const cx = p.random(SIZE * 0.2, SIZE * 0.8);
    const cy = p.random(SIZE * 0.2, SIZE * 0.8);
    const rx = p.random(15, 35);
    const ry = p.random(10, 25);
    const rotation = p.random(-0.3, 0.3);

    // Shadow
    p.fill(50, 48, 45);
    p.noStroke();
    p.ellipse(cx + 3, cy + 5, rx * 2, ry * 1.5);

    // Main rock body
    const rockGray = p.random(90, 130);
    p.fill(rockGray, rockGray - 5, rockGray - 10);
    p.ellipse(cx, cy, rx * 2, ry * 2);

    // Highlight
    p.fill(rockGray + 20, rockGray + 15, rockGray + 10, 150);
    p.ellipse(cx - rx * 0.3, cy - ry * 0.3, rx * 0.8, ry * 0.6);

    // Texture details
    for (let j = 0; j < 8; j++) {
      const detailX = cx + p.random(-rx, rx) * 0.7;
      const detailY = cy + p.random(-ry, ry) * 0.7;
      const detailSize = p.random(2, 5);
      p.fill(rockGray - 20, rockGray - 25, rockGray - 30);
      p.ellipse(detailX, detailY, detailSize, detailSize * 0.7);
    }
  }

  // Add crack lines
  p.stroke(55, 52, 50);
  p.strokeWeight(1);
  for (let i = 0; i < 5; i++) {
    const x1 = p.random(SIZE);
    const y1 = p.random(SIZE);
    const angle = p.random(p.PI);
    const len = p.random(10, 30);

    p.line(x1, y1, x1 + Math.cos(angle) * len, y1 + Math.sin(angle) * len);
  }

  // Pebbles
  p.noStroke();
  for (let i = 0; i < 20; i++) {
    const x = p.random(SIZE);
    const y = p.random(SIZE);
    const s = p.random(2, 6);
    const g = p.random(85, 105);
    p.fill(g, g - 5, g - 10);
    p.ellipse(x, y, s, s * 0.7);
  }
}
