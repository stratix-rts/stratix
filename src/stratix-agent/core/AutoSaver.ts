function log(level: 'info' | 'warn' | 'error', message: string, ctx?: Record<string, unknown>): void {
  console[level](`[AutoSaver] ${message}`, ctx || '');
}

export class AutoSaver {
  private saveTimer: NodeJS.Timeout | null = null;
  private readonly debounceMs: number;

  constructor(
    private onSave: () => Promise<void>,
    debounceMs: number = 5000
  ) {
    this.debounceMs = debounceMs;
  }

  trigger(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setTimeout(async () => {
      try {
        await this.onSave();
        log('info', 'Auto-save completed');
      } catch (error) {
        log('error', 'Auto-save failed', { error: String(error) });
      }
    }, this.debounceMs);
  }

  async saveNow(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.onSave();
  }

  dispose(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }
}
