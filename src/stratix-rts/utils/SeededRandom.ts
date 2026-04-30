/**
 * SeededRandom - 确定性伪随机数生成器
 * 使用字符串种子生成可复现的随机序列
 */

export class SeededRandom {
  private seed: number;

  constructor(seed: string) {
    this.seed = this.hashString(seed);
  }

  /** 将字符串哈希为数字种子 */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash) || 1;
  }

  /** 返回 0-1 的伪随机数 */
  public next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  /** 返回 min-max 范围内的伪随机整数 */
  public between(min: number, max: number): number {
    return Math.floor(min + this.next() * (max - min + 1));
  }

  /** 返回 min-max 范围内的伪随机浮点数 */
  public floatBetween(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
}
