import { HealthStatus } from '../types';

export class HealthChecker {
  private lastCheck: number = 0;
  private status: HealthStatus = { healthy: true, lastCheck: 0 };
  private checks: Map<string, () => Promise<boolean>> = new Map();

  registerCheck(name: string, checkFn: () => Promise<boolean>): void {
    this.checks.set(name, checkFn);
  }

  async check(): Promise<HealthStatus> {
    this.lastCheck = Date.now();
    const results: Record<string, boolean> = {};

    const entries = Array.from(this.checks.entries());
    for (const [name, checkFn] of entries) {
      try {
        results[name] = await checkFn();
      } catch {
        results[name] = false;
      }
    }

    const allHealthy = Object.values(results).every(r => r === true);
    this.status = {
      healthy: allHealthy,
      lastCheck: this.lastCheck,
      details: results,
    };

    return this.status;
  }

  getStatus(): HealthStatus {
    return this.status;
  }

  isHealthy(): boolean {
    return this.status.healthy;
  }
}
