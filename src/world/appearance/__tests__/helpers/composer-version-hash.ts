/**
 * 测试辅助：**合成器源码哈希**的离线计算（node 侧专用）。
 *
 * why 需要它：版本号（composer-version.ts）要进渲染层 bundle，不能在运行时算哈希；
 *   而「改了合成器必须让缓存失效」这条纪律需要一个**能自动发现漏改**的机制 ——
 *   本文件算出当前源码的哈希，单测拿它跟 COMPOSER_VERSION 对账：
 *   对不上 = 单测红 = 开发者照抄期望值更新版本号 = 旧缓存自动失效。
 *
 * 边界：只被单测 import（不进生产 bundle）；node 内置模块（fs / crypto / path）零依赖。
 */

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

import { COMPOSER_VERSION_SOURCE_FILES } from '../../composer-version';

/**
 * 算合成器源码哈希（sha256 前 8 位十六进制）。
 *
 * @param dir 合成器源码目录（缺省 = 本文件上两级 = src/world/appearance）。
 */
export function computeComposerSourceHash(dir: string = join(__dirname, '../..')): string {
  const hash = createHash('sha256');
  for (const file of COMPOSER_VERSION_SOURCE_FILES) {
    hash.update(readFileSync(join(dir, file)));
  }
  return hash.digest('hex').slice(0, 8);
}
