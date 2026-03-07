export { RTSErrorBoundary, globalErrorHandler, withErrorBoundary } from './ErrorBoundary';
export type { ErrorContext, ClassifiedError } from './types';
export { ErrorClassifier } from './ErrorClassifier';
export { 
  AppError, 
  ErrorSeverity, 
  ErrorCategory,
  type UserError,
  type RecoverableError,
} from './types';