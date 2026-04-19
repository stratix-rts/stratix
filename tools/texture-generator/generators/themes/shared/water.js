/**
 * Shared water/puddle drawing function
 */

function drawWater(p, palette, size) {
  // Background fill
  p.fill(palette.deep[0], palette.deep[1], palette.deep[2]);
  p.noStroke();

  // Organic water shape
  const cx = size / 2;
  const cy = size / 2;
  const baseRx = size * 0.4;
  const baseRy = size * 0.3;

  p.beginShape();
  for (let a = 0; a < Math.PI * 2; a += 0.2) {
    const noiseVal = p.noise(Math.cos(a) * 2 + 1, Math.sin(a) * 2 + 1);
    const r = 1 + (noiseVal - 0.5) * 0.4;
    const x = cx + Math.cos(a) * baseRx * r;
    const y = cy + Math.sin(a) * baseRy * r;
    p.vertex(x, y);
  }
  p.endShape(p.CLOSE);

  // Surface highlights
  p.fill(palette.surface[0], palette.surface[1], palette.surface[2], 180);
  p.beginShape();
  for (let a = 0; a < Math.PI * 2; a += 0.2) {
    const noiseVal = p.noise(Math.cos(a) * 3 + 2, Math.sin(a) * 3 + 2);
    const r = 0.6 + (noiseVal - 0.5) * 0.2;
    const x = cx + Math.cos(a) * baseRx * r;
    const y = cy + Math.sin(a) * baseRy * r;
    p.vertex(x, y);
  }
  p.endShape(p.CLOSE);

  // Foam/highlight ripples
  p.noFill();
  p.stroke(palette.foam[0], palette.foam[1], palette.foam[2], 100);
  p.strokeWeight(1);
  for (let i = 0; i < 3; i++) {
    const rx = baseRx * (0.3 + i * 0.2);
    const ry = baseRy * (0.3 + i * 0.2);
    const offset = i * 0.1;
    p.ellipse(cx - offset * 5, cy - offset * 3, rx * 2, ry * 2);
  }

  // Sparkle points
  p.noStroke();
  p.fill(255, 255, 255, 200);
  const sparkles = [[cx - 5, cy - 3], [cx + 8, cy + 2], [cx - 2, cy + 6]];
  for (const [sx, sy] of sparkles) {
    p.ellipse(sx, sy, 3, 3);
  }
}
