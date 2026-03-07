export enum ErrorSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

export enum ErrorCategory {
  NETWORK = 'network',
  VALIDATION = 'validation',
  PERMISSION = 'permission',
  BUSINESS = 'business',
  SYSTEM = 'system',
}

export interface ErrorContext {
  method?: string;
  args?: any[];
  timestamp?: number;
  userId?: string;
  sessionId?: string;
  component?: string;
  action?: string;
  metadata?: Record<string, unknown>;
}

export interface ClassifiedError {
  originalError: Error;
  severity: ErrorSeverity;
  category: ErrorCategory;
  userFacing: boolean;
  recoverable: boolean;
  title: string;
  message: string;
  duration?: number;
  actions?: Array<{
    label: string;
    action: () => void | Promise<void>;
  }>;
  metadata?: Record<string, unknown>;
}

export interface UserError extends Error {
  severity: ErrorSeverity;
  title: string;
  message: string;
  userFacing: boolean;
  recoverable: boolean;
  duration?: number;
  actions?: Array<{
    label: string;
    action: () => void | Promise<void>;
  }>;
}

export interface RecoverableError extends Error {
  recoveryStrategy: () => Promise<void>;
}

export class AppError extends Error implements UserError {
  severity: ErrorSeverity;
  title: string;
  userFacing: boolean;
  recoverable: boolean;
  duration?: number;
  actions?: Array<{
    label: string;
    action: () => void | Promise<void>;
  }>;

  constructor(config: {
    title: string;
    message: string;
    severity?: ErrorSeverity;
    userFacing?: boolean;
    recoverable?: boolean;
    duration?: number;
    actions?: Array<{
      label: string;
      action: () => void | Promise<void>;
    }>;
  }) {
    super(config.message);
    this.name = 'AppError';
    this.title = config.title;
    this.severity = config.severity || ErrorSeverity.ERROR;
    this.userFacing = config.userFacing ?? true;
    this.recoverable = config.recoverable ?? false;
    this.duration = config.duration;
    this.actions = config.actions;
  }
}