import { MetricsData } from '../types';

const MAX_LATENCY_SAMPLES = 1000;

export class MetricsCollector {
  private requestCount: number = 0;
  private errorCount: number = 0;
  private totalLatency: number = 0;
  private tokenUsage: number = 0;
  private latencies: number[] = [];

  recordRequest(latency: number, tokens: number = 0, success: boolean = true): void {
    this.requestCount++;
    this.totalLatency += latency;
    this.latencies.push(latency);
    this.tokenUsage += tokens;

    if (!success) {
      this.errorCount++;
    }

    if (this.latencies.length > MAX_LATENCY_SAMPLES) {
      this.latencies = this.latencies.slice(-MAX_LATENCY_SAMPLES);
    }
  }

  getMetrics(): MetricsData {
    const avgLatency = this.requestCount > 0 
      ? this.totalLatency / this.requestCount 
      : 0;

    return {
      requests: this.requestCount,
      errors: this.errorCount,
      latency: avgLatency,
      tokenUsage: this.tokenUsage,
    };
  }

  getErrorRate(): number {
    return this.requestCount > 0 ? this.errorCount / this.requestCount : 0;
  }

  getPercentile(p: number): number {
    if (this.latencies.length === 0 || p <= 0) return 0;
    if (p >= 100) return this.latencies[this.latencies.length - 1];
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)] ?? 0;
  }

  reset(): void {
    this.requestCount = 0;
    this.errorCount = 0;
    this.totalLatency = 0;
    this.tokenUsage = 0;
    this.latencies = [];
  }
}
