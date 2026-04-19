/**
 * Shared color palettes for all themes
 */

const PALETTES = {
  fantasy: {
    name: 'Fantasy',
    ground: { base: [60, 90, 50], dark: [40, 60, 35], light: [80, 120, 70] },
    grass: { base: [50, 100, 40], tip: [90, 160, 60], dark: [35, 70, 30] },
    rock: { base: [100, 90, 80], shadow: [70, 60, 55], highlight: [130, 120, 110] },
    flower: { petal: [220, 180, 100], center: [250, 200, 50], stem: [60, 100, 40] },
    tree: { trunk: [80, 50, 30], foliage: [40, 100, 50], highlight: [60, 140, 70] },
    water: { deep: [30, 60, 90], surface: [60, 100, 130], foam: [150, 180, 200] },
    cloud: { fill: [240, 240, 255], shadow: [200, 200, 220], highlight: [255, 255, 255] }
  },
  cartoon: {
    name: 'Cartoon',
    ground: { base: [100, 160, 80], dark: [70, 120, 50], light: [140, 200, 120] },
    grass: { base: [80, 180, 60], tip: [150, 230, 100], dark: [50, 140, 40] },
    rock: { base: [160, 160, 160], shadow: [120, 120, 120], highlight: [200, 200, 200] },
    flower: { petal: [255, 120, 120], center: [255, 220, 50], stem: [80, 160, 60] },
    tree: { trunk: [139, 90, 43], foliage: [34, 139, 34], highlight: [60, 180, 60] },
    water: { deep: [65, 105, 225], surface: [100, 150, 255], foam: [200, 220, 255] },
    cloud: { fill: [255, 255, 255], shadow: [200, 200, 200], highlight: [255, 255, 255] }
  },
  cyberpunk: {
    name: 'Cyberpunk',
    ground: { base: [30, 20, 40], dark: [20, 15, 30], light: [50, 35, 70] },
    grass: { base: [0, 150, 136], tip: [0, 200, 180], dark: [0, 100, 90] },
    rock: { base: [80, 70, 100], shadow: [50, 45, 70], highlight: [120, 110, 150] },
    flower: { petal: [255, 0, 255], center: [0, 255, 255], stem: [0, 150, 136] },
    tree: { trunk: [50, 50, 70], foliage: [0, 200, 180], highlight: [138, 43, 226] },
    water: { deep: [20, 10, 40], surface: [75, 0, 130], foam: [138, 43, 226] },
    cloud: { fill: [100, 0, 150], shadow: [60, 0, 100], highlight: [180, 50, 255] }
  },
  nature: {
    name: 'Nature',
    ground: { base: [120, 100, 80], dark: [90, 75, 60], light: [150, 130, 105] },
    grass: { base: [85, 120, 60], tip: [120, 160, 90], dark: [60, 90, 45] },
    rock: { base: [115, 110, 105], shadow: [85, 80, 75], highlight: [145, 140, 135] },
    flower: { petal: [255, 200, 180], center: [255, 220, 100], stem: [85, 120, 60] },
    tree: { trunk: [90, 60, 40], foliage: [60, 100, 50], highlight: [90, 130, 70] },
    water: { deep: [40, 80, 100], surface: [70, 120, 140], foam: [180, 200, 210] },
    cloud: { fill: [220, 225, 230], shadow: [180, 185, 195], highlight: [250, 252, 255] }
  }
};

function getPalette(theme, category) {
  return PALETTES[theme][category];
}

function lerpColor(c1, c2, t) {
  return [
    Math.round(c1[0] + (c2[0] - c1[0]) * t),
    Math.round(c1[1] + (c2[1] - c1[1]) * t),
    Math.round(c1[2] + (c2[2] - c1[2]) * t)
  ];
}
