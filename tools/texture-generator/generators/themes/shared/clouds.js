/**
 * Shared cloud drawing function
 */

function drawCloudShape(p, palette, size, cx, cy, scale) {
  // Shadow
  p.fill(palette.shadow[0], palette.shadow[1], palette.shadow[2], 100);
  p.noStroke();
  const shadowOffset = scale * 3;
  const puffs = [
    { x: cx - scale * 0.3 + shadowOffset, y: cy + scale * 0.1 + shadowOffset, r: scale * 0.4 },
    { x: cx + scale * 0.25 + shadowOffset, y: cy + scale * 0.05 + shadowOffset, r: scale * 0.35 },
    { x: cx + shadowOffset, y: cy - scale * 0.15 + shadowOffset, r: scale * 0.3 }
  ];
  for (const puff of puffs) {
    p.ellipse(puff.x, puff.y, puff.r * 2, puff.r * 1.4);
  }

  // Main cloud
  p.fill(palette.fill[0], palette.fill[1], palette.fill[2]);
  p.ellipse(cx - scale * 0.3, cy + scale * 0.1, scale * 0.5, scale * 0.35);
  p.ellipse(cx + scale * 0.25, cy + scale * 0.05, scale * 0.4, scale * 0.3);
  p.ellipse(cx, cy - scale * 0.1, scale * 0.35, scale * 0.25);
  p.ellipse(cx - scale * 0.1, cy + scale * 0.15, scale * 0.3, scale * 0.2);
  p.ellipse(cx + scale * 0.1, cy + scale * 0.12, scale * 0.25, scale * 0.18);

  // Highlight
  p.fill(palette.highlight[0], palette.highlight[1], palette.highlight[2], 200);
  p.ellipse(cx - scale * 0.25, cy - scale * 0.05, scale * 0.2, scale * 0.12);
}
