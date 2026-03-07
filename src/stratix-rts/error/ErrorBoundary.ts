import { rtsEventBus } from '../events/core/RTSEventBus';
import { ErrorClassifier } from './ErrorClassifier';
import type { ErrorContext, ClassifiedError } from './types';
import { ErrorSeverity } from './types';

export interface ErrorHandler {
  handleError(error: Error, context?: ErrorContext): void;
  showUserFeedback(error: ClassifiedError): void;
  recoverFromError(error: ClassifiedError): Promise<void>;
}

export class RTSErrorBoundary implements ErrorHandler {
  private errorClassifier: ErrorClassifier;
  private errorHistory: Array<{
    error: Error;
    context?: ErrorContext;
    timestamp: number;
  }> = [];
  private readonly maxHistorySize = 50;

  constructor() {
    this.errorClassifier = new ErrorClassifier();
    this.setupGlobalHandlers();
  }

  private setupGlobalHandlers(): void {
    if (typeof window !== 'undefined') {
      window.onerror = (message, source, lineno, colno, error) => {
        if (error) {
          this.handleError(error, {
            component: 'global',
            action: 'unhandled_error',
            metadata: { source, lineno, colno },
          });
        }
        return false;
      };

      window.onunhandledrejection = (event) => {
        const error = event.reason instanceof Error 
          ? event.reason 
          : new Error(String(event.reason));
        
        this.handleError(error, {
          component: 'global',
          action: 'unhandled_promise_rejection',
        });
      };
    }
  }

  handleError(error: Error, context?: ErrorContext): void {
    const classifiedError = this.errorClassifier.classify(error, context);

    this.recordError(error, context);

    this.logError(classifiedError, context);

    if (classifiedError.userFacing) {
      this.showUserFeedback(classifiedError);
    }

    if (classifiedError.recoverable) {
      this.recoverFromError(classifiedError);
    }

    this.emitErrorEvent(classifiedError, context);
  }

  showUserFeedback(error: ClassifiedError): void {
    rtsEventBus.emit('scene:ui:notification' as any, {
      message: error.message,
      type: this.mapSeverityToNotificationType(error.severity),
    });
  }

  async recoverFromError(error: ClassifiedError): Promise<void> {
    if (error.actions && error.actions.length > 0) {
      console.log('[RTSErrorBoundary] Recovery actions available:', error.actions.map(a => a.label));
    } else {
      console.log('[RTSErrorBoundary] No recovery actions available for this error');
    }
  }

  private recordError(error: Error, context?: ErrorContext): void {
    this.errorHistory.push({
      error,
      context,
      timestamp: Date.now(),
    });

    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory.shift();
    }
  }

  private logError(error: ClassifiedError, context?: ErrorContext): void {
    const logLevel = error.severity === ErrorSeverity.CRITICAL 
      ? 'error' 
      : error.severity === ErrorSeverity.ERROR 
        ? 'error' 
        : 'warn';

    console[logLevel]('[RTSErrorBoundary]', {
      title: error.title,
      message: error.message,
      category: error.category,
      severity: error.severity,
      context,
      stack: error.originalError.stack,
    });
  }

  private emitErrorEvent(error: ClassifiedError, context?: ErrorContext): void {
    rtsEventBus.emit('error:occurred' as any, {
      error: error.originalError,
      classified: error,
      context,
    });
  }

  private mapSeverityToNotificationType(severity: ErrorSeverity): 'info' | 'success' | 'warning' | 'error' {
    const mapping: Record<ErrorSeverity, 'info' | 'success' | 'warning' | 'error'> = {
      [ErrorSeverity.INFO]: 'info',
      [ErrorSeverity.WARNING]: 'warning',
      [ErrorSeverity.ERROR]: 'error',
      [ErrorSeverity.CRITICAL]: 'error',
    };
    return mapping[severity];
  }

  getErrorHistory(): Array<{
    error: Error;
    context?: ErrorContext;
    timestamp: number;
  }> {
    return [...this.errorHistory];
  }

  clearErrorHistory(): void {
    this.errorHistory = [];
  }

  destroy(): void {
    if (typeof window !== 'undefined') {
      window.onerror = null;
      window.onunhandledrejection = null;
    }
    this.clearErrorHistory();
  }
}

export const globalErrorHandler = new RTSErrorBoundary();

export function withErrorBoundary<T>(
  target: any,
  propertyKey: string,
  descriptor: TypedPropertyDescriptor<(...args: any[]) => Promise<T>>
): TypedPropertyDescriptor<(...args: any[]) => Promise<T>> {
  const originalMethod = descriptor.value!;

  descriptor.value = async function(...args: any[]): Promise<T> {
    try {
      return await originalMethod.apply(this, args);
    } catch (error) {
      globalErrorHandler.handleError(error instanceof Error ? error : new Error(String(error)), {
        method: propertyKey,
        args,
        timestamp: Date.now(),
      });
      throw error;
    }
  };

  return descriptor;
}