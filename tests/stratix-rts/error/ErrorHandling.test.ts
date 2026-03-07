import { RTSErrorBoundary, globalErrorHandler } from '@/stratix-rts/error/ErrorBoundary';
import { ErrorClassifier } from '@/stratix-rts/error/ErrorClassifier';
import { AppError, ErrorSeverity, ErrorCategory } from '@/stratix-rts/error/types';
import { rtsEventBus } from '@/stratix-rts/events/core/RTSEventBus';

describe('Error Handling System', () => {
  let errorHandler: RTSErrorBoundary;
  let classifier: ErrorClassifier;

  beforeEach(() => {
    errorHandler = new RTSErrorBoundary();
    classifier = new ErrorClassifier();
  });

  afterEach(() => {
    errorHandler.destroy();
  });

  describe('ErrorClassifier', () => {
    it('should classify network errors', () => {
      const error = new Error('Network timeout');
      const classified = classifier.classify(error);

      expect(classified.category).toBe(ErrorCategory.NETWORK);
      expect(classified.severity).toBe(ErrorSeverity.ERROR);
      expect(classified.recoverable).toBe(true);
    });

    it('should classify validation errors', () => {
      const error = new Error('Invalid input: required field missing');
      const classified = classifier.classify(error);

      expect(classified.category).toBe(ErrorCategory.VALIDATION);
      expect(classified.severity).toBe(ErrorSeverity.WARNING);
      expect(classified.recoverable).toBe(true);
    });

    it('should classify permission errors', () => {
      const error = new Error('Unauthorized access');
      const classified = classifier.classify(error);

      expect(classified.category).toBe(ErrorCategory.PERMISSION);
      expect(classified.severity).toBe(ErrorSeverity.ERROR);
      expect(classified.recoverable).toBe(false);
    });

    it('should classify system errors as critical', () => {
      const error = new Error('Out of memory');
      const classified = classifier.classify(error);

      expect(classified.category).toBe(ErrorCategory.SYSTEM);
      expect(classified.severity).toBe(ErrorSeverity.CRITICAL);
    });

    it('should preserve AppError properties', () => {
      const appError = new AppError({
        title: 'Custom Error',
        message: 'This is a custom error',
        severity: ErrorSeverity.WARNING,
        userFacing: true,
        recoverable: true,
      });

      const classified = classifier.classify(appError);

      expect(classified.title).toBe('Custom Error');
      expect(classified.message).toBe('This is a custom error');
      expect(classified.severity).toBe(ErrorSeverity.WARNING);
      expect(classified.userFacing).toBe(true);
      expect(classified.recoverable).toBe(true);
    });

    it('should format user-friendly messages', () => {
      const error = new Error('Network error');
      const classified = classifier.classify(error);

      expect(classified.title).toBeDefined();
      expect(classified.message).toBeDefined();
      expect(classified.userFacing).toBe(true);
    });

    it('should provide recovery actions for recoverable errors', () => {
      const error = new Error('Network timeout');
      const classified = classifier.classify(error);

      expect(classified.actions).toBeDefined();
      expect(classified.actions!.length).toBeGreaterThan(0);
      expect(classified.actions!.some(a => a.label === '重试')).toBe(true);
    });
  });

  describe('RTSErrorBoundary', () => {
    it('should handle and classify errors', () => {
      const error = new Error('Test error');
      
      errorHandler.handleError(error, {
        method: 'testMethod',
        timestamp: Date.now(),
      });

      const history = errorHandler.getErrorHistory();
      expect(history.length).toBe(1);
      expect(history[0].error).toBe(error);
    });

    it('should maintain error history', () => {
      for (let i = 0; i < 10; i++) {
        errorHandler.handleError(new Error(`Error ${i}`));
      }

      const history = errorHandler.getErrorHistory();
      expect(history.length).toBe(10);
    });

    it('should limit error history size', () => {
      for (let i = 0; i < 60; i++) {
        errorHandler.handleError(new Error(`Error ${i}`));
      }

      const history = errorHandler.getErrorHistory();
      expect(history.length).toBeLessThanOrEqual(50);
    });

    it('should clear error history', () => {
      errorHandler.handleError(new Error('Test error'));
      errorHandler.clearErrorHistory();

      const history = errorHandler.getErrorHistory();
      expect(history.length).toBe(0);
    });

    it('should emit notification event for user-facing errors', () => {
      const eventSpy = jest.fn();
      rtsEventBus.on('scene:ui:notification' as any, eventSpy);

      const error = new Error('Test user error');
      errorHandler.handleError(error);

      expect(eventSpy).toHaveBeenCalled();

      rtsEventBus.off('scene:ui:notification' as any, eventSpy);
    });
  });

  describe('AppError', () => {
    it('should create custom error with all properties', () => {
      const action = jest.fn();
      
      const error = new AppError({
        title: 'Test Error',
        message: 'This is a test error',
        severity: ErrorSeverity.ERROR,
        userFacing: true,
        recoverable: true,
        duration: 5000,
        actions: [
          { label: 'Retry', action },
        ],
      });

      expect(error.title).toBe('Test Error');
      expect(error.message).toBe('This is a test error');
      expect(error.severity).toBe(ErrorSeverity.ERROR);
      expect(error.userFacing).toBe(true);
      expect(error.recoverable).toBe(true);
      expect(error.duration).toBe(5000);
      expect(error.actions).toHaveLength(1);
      expect(error.actions![0].label).toBe('Retry');
    });

    it('should use default values', () => {
      const error = new AppError({
        title: 'Test',
        message: 'Test message',
      });

      expect(error.severity).toBe(ErrorSeverity.ERROR);
      expect(error.userFacing).toBe(true);
      expect(error.recoverable).toBe(false);
    });
  });
});