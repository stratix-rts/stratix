/**
 * Shared rock drawing functions
 */

function drawRockSmall(p, palette, size) {
  const cx = size / 2;
  const cy = size / 2;
  const rx = size * 0.3;
  const ry = size * 0.25;

  // Shadow
  p.fill(palette.shadow[0], palette.shadow[1], palette.shadow[2], 150);
  p.noStroke();
  p.ellipse(cx + 2, cy + 3, rx * 2, ry * 1.3);

  // Main rock body (irregular shape)
  p.fill(palette.base[0], palette.base[1], palette.base[2]);
  p.beginShape();
  for (let a = 0; a < Math.PI * 2; a += 0.3) {
    const r = 1 + p.noise(a * 2, 0) * 0.15;
    const x = cx + Math.cos(a) * rx * r;
    const y = cy + Math.sin(a) * ry * r;
    p.vertex(x, y);
  }
  p.endShape(p.CLOSE);

  // Highlight
  p.fill(palette.highlight[0], palette.highlight[1], palette.highlight[2], 180);
  p.ellipse(cx - rx * 0.25, cy - ry * 0.25, rx * 0.6, ry * 0.5);
}

function drawRockLarge(p, palette, size) {
  const cx = size / 2;
  const cy = size / 2;

  // Multiple rocks cluster
  const rocks = [
    { x: 0, y: 0, rx: size * 0.35, ry: size * 0.28 },
    { x: -size * 0.2, y: size * 0.1, rx: size * 0.25, ry: size * 0.2 },
    { x: size * 0.18, y: size * 0.08, rx: size * 0.22, ry: size * 0.18 }
  ];

  // Shadows
  p.fill(palette.shadow[0], palette.shadow[1], palette.shadow[2], 120);
  p.noStroke();
  for (const rock of rocks) {
    p.ellipse(cx + rock.x + 3, cy + rock.y + 4, rock.rx * 2, rock.ry * 1.5);
  }

  // Main rocks
  for (const rock of rocks) {
    p.fill(palette.base[0], palette.base[1], palette.base[2]);
    p.beginShape();
    for (let a = 0; a < Math.PI * 2; a += 0.25) {
      const r = 1 + p.noise(a * 3 + rock.x, rock.y) * 0.2;
      const x = cx + rock.x + Math.cos(a) * rock.rx * r;
      const y = cy + rock.y + Math.sin(a) * rock.ry * r;
      p.vertex(x, y);
    }
    p.endShape(p.CLOSE);
  }

  // Highlights
  p.fill(palette.highlight[0], palette.highlight[1], palette.highlight[2], 160);
  p.ellipse(cx - size * 0.1, cy - size * 0.1, size * 0.2, size * 0.15);
  p.ellipse(cx + size * 0.12, cy - size * 0.05, size * 0.12, size * 0.1);
}
