export class StratixError extends Error {
  constructor(
    message: string,
    public code: string,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'StratixError';
  }
}

export type Result<T, E = StratixError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = <E extends StratixError>(error: E): Result<never, E> => ({ ok: false, error });