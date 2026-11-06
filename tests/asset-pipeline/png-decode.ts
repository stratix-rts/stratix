/**
 * 文件职责：**最小 PNG 解码器**（RGBA8 / 非隔行）—— 给「双路由像素一致性测试」用。
 *
 * why 需要它：烘焙产物是 PNG（vendor/pixelfx 的 encodePNG 写出的 RGBA8），
 *   要逐像素对比就得把 PNG 读回像素缓冲。仓内只有编码器（上游没给解码器），
 *   又不许引入 npm 依赖 —— 于是用 node:zlib 手写一个最小解码器（约 60 行，无依赖）。
 *
 * why 只认这一种格式：编码器是自家 vendor 里的 encodePNG（固定 RGBA8、无隔行），
 *   解码器只需认得它产出的东西。遇到别的格式（隔行 / 调色板 / 16bit）**直接报错** ——
 *   静默按错的格式解出来的图，比报错难查得多（而且会让一致性测试假绿）。
 *
 * 禁止事项：
 *   1. 引入 npm 依赖（pngjs 之类）—— 本仓的测试零新增依赖是硬约束；
 *   2. 顺手扩成通用 PNG 解码器 —— 上游编码器口径不变就不需要更多。
 */

import { inflateSync } from 'node:zlib';

/** 解出来的 PNG 像素。 */
export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  /** RGBA8 像素（长度 = width × height × 4，行优先）。 */
  readonly data: Uint8Array;
}

/** PNG 文件头（8 字节签名）。 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** 每像素字节数（RGBA8）。 */
const BYTES_PER_PIXEL = 4;

/**
 * 解一张 PNG（只支持 RGBA8 / 非隔行 —— 够用且不会静默解错）。
 *
 * @param buffer PNG 文件字节。
 * @returns 像素缓冲。
 */
export function decodePng(buffer: Buffer): DecodedPng {
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (buffer[i] !== PNG_SIGNATURE[i]) {
      throw new Error('[png] 不是 PNG 文件（签名不匹配）');
    }
  }

  let offset = 8;
  let header: { width: number; height: number; depth: number; color: number; interlace: number } | null = null;
  const idat: Buffer[] = [];

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8] ?? 0,
        color: data[9] ?? 0,
        interlace: data[12] ?? 0,
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  if (!header) throw new Error('[png] 缺 IHDR 段');
  if (header.depth !== 8 || header.color !== 6) {
    throw new Error(`[png] 只支持 RGBA8（当前 depth=${header.depth} color=${header.color}）`);
  }
  if (header.interlace !== 0) throw new Error('[png] 不支持隔行（interlace≠0）');
  if (idat.length === 0) throw new Error('[png] 缺 IDAT 段');

  const raw = inflateSync(Buffer.concat(idat));
  const stride = header.width * BYTES_PER_PIXEL;
  const out = new Uint8Array(stride * header.height);

  let position = 0;
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[position] ?? 0;
    position += 1;
    const line = raw.subarray(position, position + stride);
    position += stride;
    for (let x = 0; x < stride; x += 1) {
      // 反滤波：左 / 上 / 左上三个邻居（PNG 的五种过滤器）。
      const left = x >= BYTES_PER_PIXEL ? out[y * stride + x - BYTES_PER_PIXEL] ?? 0 : 0;
      const up = y > 0 ? out[(y - 1) * stride + x] ?? 0 : 0;
      const upLeft = x >= BYTES_PER_PIXEL && y > 0 ? out[(y - 1) * stride + x - BYTES_PER_PIXEL] ?? 0 : 0;
      const value = line[x] ?? 0;
      let restored: number;
      if (filter === 0) restored = value;
      else if (filter === 1) restored = value + left;
      else if (filter === 2) restored = value + up;
      else if (filter === 3) restored = value + ((left + up) >> 1);
      else if (filter === 4) restored = value + paeth(left, up, upLeft);
      else throw new Error(`[png] 未知过滤器 ${filter}`);
      out[y * stride + x] = restored & 255;
    }
  }

  return { width: header.width, height: header.height, data: out };
}

/** PNG 的 Paeth 预测器（过滤器 4）。 */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
