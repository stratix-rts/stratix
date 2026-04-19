/**
 * Shared flower/mushroom drawing function
 */

function drawFlower(p, palette, size) {
  const cx = size / 2;
  const cy = size / 2;

  // Stem
  p.stroke(palette.stem[0], palette.stem[1], palette.stem[2]);
  p.strokeWeight(2);
  p.line(cx, cy + size * 0.1, cx, cy + size * 0.35);

  // Petals
  p.noStroke();
  const numPetals = 5;
  const petalSize = size * 0.15;

  for (let i = 0; i < numPetals; i++) {
    const angle = (i / numPetals) * Math.PI * 2 - Math.PI / 2;
    const px = cx + Math.cos(angle) * petalSize;
    const py = cy + Math.sin(angle) * petalSize * 0.7;
    p.fill(palette.petal[0], palette.petal[1], palette.petal[2]);
    p.ellipse(px, py, petalSize * 1.2, petalSize);
  }

  // Center
  p.fill(palette.center[0], palette.center[1], palette.center[2]);
  p.ellipse(cx, cy, petalSize * 0.8, petalSize * 0.8);

  // Highlight on center
  p.fill(255, 255, 200, 150);
  p.ellipse(cx - petalSize * 0.1, cy - petalSize * 0.1, petalSize * 0.3, petalSize * 0.3);
}
