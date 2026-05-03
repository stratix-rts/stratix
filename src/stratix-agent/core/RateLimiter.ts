import { RateLimitConfig } from '../types';

export class RateLimiter {
  private requestCounts: Map<string, number[]> = new Map();
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  private getActiveTimestamps(identifier: string, now: number): number[] {
    const windowStart = now - this.config.windowMs;
    const timestamps = (this.requestCounts.get(identifier) || [])
      .filter(t => t > windowStart);
    if (timestamps.length === 0) {
      this.requestCounts.delete(identifier);
    }
    return timestamps;
  }

  check(identifier: string = 'default'): boolean {
    const now = Date.now();
    const timestamps = this.getActiveTimestamps(identifier, now);

    if (timestamps.length >= this.config.maxRequests) {
      return false;
    }

    timestamps.push(now);
    this.requestCounts.set(identifier, timestamps);
    return true;
  }

  getRemainingRequests(identifier: string = 'default'): number {
    const now = Date.now();
    const timestamps = this.getActiveTimestamps(identifier, now);
    return Math.max(0, this.config.maxRequests - timestamps.length);
  }

  reset(identifier: string = 'default'): void {
    this.requestCounts.delete(identifier);
  }

  resetAll(): void {
    this.requestCounts.clear();
  }
}
