import { RateLimitConfig } from '../types';

export class RateLimiter {
  private requestCounts: Map<string, number[]> = new Map();
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  check(identifier: string = 'default'): boolean {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    
    let timestamps = this.requestCounts.get(identifier) || [];
    timestamps = timestamps.filter(t => t > windowStart);
    
    if (timestamps.length >= this.config.maxRequests) {
      return false;
    }

    timestamps.push(now);
    this.requestCounts.set(identifier, timestamps);
    return true;
  }

  getRemainingRequests(identifier: string = 'default'): number {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    
    const timestamps = (this.requestCounts.get(identifier) || [])
      .filter(t => t > windowStart);
    
    return Math.max(0, this.config.maxRequests - timestamps.length);
  }

  reset(identifier: string = 'default'): void {
    this.requestCounts.delete(identifier);
  }

  resetAll(): void {
    this.requestCounts.clear();
  }
}
