import type { ErrorContext, ClassifiedError, ErrorSeverity, ErrorCategory } from './types';
import { ErrorSeverity as ES, ErrorCategory as EC, AppError } from './types';

export class ErrorClassifier {
  private readonly errorPatterns = new Map<RegExp, { severity: ErrorSeverity; category: ErrorCategory }>([
    [/network|fetch|timeout|ECONNREFUSED/i, { severity: ES.ERROR, category: EC.NETWORK }],
    [/validation|required|invalid|format/i, { severity: ES.WARNING, category: EC.VALIDATION }],
    [/permission|unauthorized|forbidden/i, { severity: ES.ERROR, category: EC.PERMISSION }],
    [/memory|OOM|heap/i, { severity: ES.CRITICAL, category: EC.SYSTEM }],
  ]);

  classify(error: Error, context?: ErrorContext): ClassifiedError {
    const severity = this.determineSeverity(error, context);
    const category = this.determineCategory(error, context);
    const userFacing = this.isUserFacing(error);
    const recoverable = this.isRecoverable(error, category);

    const { title, message } = this.formatUserMessage(error, category, severity);

    return {
      originalError: error,
      severity,
      category,
      userFacing,
      recoverable,
      title,
      message,
      duration: this.getDefaultDuration(severity),
      actions: this.getSuggestedActions(error, category, recoverable),
      metadata: {
        ...context?.metadata,
        timestamp: context?.timestamp || Date.now(),
      },
    };
  }

  private determineSeverity(error: Error, context?: ErrorContext): ErrorSeverity {
    if (error instanceof AppError) {
      return error.severity;
    }

    for (const [pattern, config] of this.errorPatterns) {
      if (pattern.test(error.message) || pattern.test(error.name)) {
        return config.severity;
      }
    }

    if (context?.action === 'critical') {
      return ES.CRITICAL;
    }

    return ES.ERROR;
  }

  private determineCategory(error: Error, context?: ErrorContext): ErrorCategory {
    if (error instanceof AppError) {
      return error.name === 'ValidationError' ? EC.VALIDATION : EC.BUSINESS;
    }

    for (const [pattern, config] of this.errorPatterns) {
      if (pattern.test(error.message) || pattern.test(error.name)) {
        return config.category;
      }
    }

    return EC.SYSTEM;
  }

  private isUserFacing(error: Error): boolean {
    if (error instanceof AppError) {
      return error.userFacing;
    }

    const systemPatterns = [
      /internal/i,
      /system/i,
      /infrastructure/i,
    ];

    return !systemPatterns.some(pattern => 
      pattern.test(error.message) || pattern.test(error.name)
    );
  }

  private isRecoverable(error: Error, category: ErrorCategory): boolean {
    if (error instanceof AppError) {
      return error.recoverable;
    }

    const recoverableCategories = [
      EC.NETWORK,
      EC.VALIDATION,
    ];

    return recoverableCategories.includes(category);
  }

  private formatUserMessage(
    error: Error,
    category: ErrorCategory,
    severity: ErrorSeverity
  ): { title: string; message: string } {
    if (error instanceof AppError) {
      return {
        title: error.title,
        message: error.message,
      };
    }

    const categoryMessages = new Map<ErrorCategory, { title: string; message: string }>([
      [EC.NETWORK, {
        title: '网络连接问题',
        message: '无法连接到服务器，请检查网络连接后重试',
      }],
      [EC.VALIDATION, {
        title: '输入验证失败',
        message: error.message || '输入数据不符合要求',
      }],
      [EC.PERMISSION, {
        title: '权限不足',
        message: '您没有执行此操作的权限',
      }],
      [EC.BUSINESS, {
        title: '操作失败',
        message: error.message || '无法完成此操作',
      }],
      [EC.SYSTEM, {
        title: '系统错误',
        message: severity === ES.CRITICAL 
          ? '系统发生严重错误，请联系管理员'
          : '系统暂时无法处理您的请求，请稍后重试',
      }],
    ]);

    return categoryMessages.get(category) || {
      title: '未知错误',
      message: '发生了未预期的错误',
    };
  }

  private getDefaultDuration(severity: ErrorSeverity): number {
    const durations = new Map<ErrorSeverity, number>([
      [ES.INFO, 3000],
      [ES.WARNING, 5000],
      [ES.ERROR, 7000],
      [ES.CRITICAL, 0],
    ]);

    return durations.get(severity) || 5000;
  }

  private getSuggestedActions(
    error: Error,
    category: ErrorCategory,
    recoverable: boolean
  ): Array<{ label: string; action: () => void }> {
    if (error instanceof AppError && error.actions) {
      return error.actions;
    }

    const actions: Array<{ label: string; action: () => void }> = [];

    if (recoverable) {
      actions.push({
        label: '重试',
        action: () => {
          console.log('[ErrorClassifier] Retry action triggered');
        },
      });
    }

    if (category === EC.NETWORK) {
      actions.push({
        label: '检查网络',
        action: () => {
          console.log('[ErrorClassifier] Check network action triggered');
        },
      });
    }

    if (category === EC.SYSTEM && error.message.includes('memory')) {
      actions.push({
        label: '刷新页面',
        action: () => {
          window.location.reload();
        },
      });
    }

    return actions;
  }
}