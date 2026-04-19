/**
 * Shared grass tuft drawing function
 */

function drawGrassTuft(p, palette, size) {
  const cx = size / 2;
  const cy = size / 2;

  // Draw multiple blades
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + p.random(-0.2, 0.2);
    const len = size * 0.3 + p.random(size * 0.1);
    const lean = p.random(-0.3, 0.3);

    const x1 = cx + Math.cos(angle) * size * 0.15;
    const y1 = cy + Math.sin(angle) * size * 0.15;
    const x2 = x1 + Math.cos(angle + lean) * len;
    const y2 = y1 - len;

    // Blade gradient (base to tip)
    const baseColor = palette.base;
    const tipColor = palette.tip;

    for (let t = 0; t < 1; t += 0.1) {
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;
      const col = lerpColor(baseColor, tipColor, t);
      p.stroke(col[0], col[1], col[2]);
      p.strokeWeight(2 - t * 1);
      p.point(x, y);
    }
  }

  // Center cluster
  p.noStroke();
  for (let i = 0; i < 5; i++) {
    const x = cx + p.random(-size * 0.1, size * 0.1);
    const y = cy + p.random(-size * 0.1, size * 0.1);
    const s = p.random(3, 6);
    p.fill(...palette.base);
    p.ellipse(x, y, s, s * 1.5);
  }
}
