import {
  generateId,
  deepClone,
  debounce,
  throttle,
  validatePriority,
  validateProjectStatus,
  validateTaskStatus,
  validateProgress,
  validateRequired,
  validatePath,
  formatDuration,
  clamp,
  formatDate,
  parseDate,
  now,
  PROJECT_STATUS_VALUES,
  TASK_STATUS_VALUES,
} from '@/stratix-project/utils/helpers';

describe('helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('generateId', () => {
    test('returns string with given prefix', () => {
      const id = generateId('proj');
      expect(id.startsWith('proj_')).toBe(true);
    });

    test('includes timestamp in base36', () => {
      const before = Date.now();
      const id = generateId('test');
      const after = Date.now();
      const parts = id.split('_');
      const timestamp = parseInt(parts[1], 36);
      expect(timestamp).toBeGreaterThanOrEqual(before - 1);
      expect(timestamp).toBeLessThanOrEqual(after + 1);
    });

    test('includes random suffix', () => {
      const id1 = generateId('proj');
      const id2 = generateId('proj');
      expect(id1).not.toBe(id2);
    });

    test('handles different prefixes', () => {
      expect(generateId('a')).toMatch(/^a_/);
      expect(generateId('user')).toMatch(/^user_/);
    });
  });

  describe('deepClone', () => {
    test('clones primitive values', () => {
      expect(deepClone(42)).toBe(42);
      expect(deepClone('hello')).toBe('hello');
      expect(deepClone(null)).toBe(null);
    });

    test('clones plain objects', () => {
      const obj = { a: 1, b: 'two' };
      const cloned = deepClone(obj);
      expect(cloned).toEqual(obj);
      expect(cloned).not.toBe(obj);
    });

    test('clones nested objects', () => {
      const obj = { a: { b: { c: 3 } } };
      const cloned = deepClone(obj);
      expect(cloned).toEqual(obj);
      expect(cloned.a).not.toBe(obj.a);
    });

    test('clones arrays', () => {
      const arr = [1, 2, { x: 3 }];
      const cloned = deepClone(arr);
      expect(cloned).toEqual(arr);
      expect(cloned).not.toBe(arr);
    });

    test('clones Date objects', () => {
      const date = new Date('2024-01-01');
      const cloned = deepClone({ date });
      expect(cloned.date).toEqual(date);
      expect(cloned.date).not.toBe(date);
    });
  });

  describe('debounce', () => {
    test('delays function execution', () => {
      jest.useFakeTimers();
      const fn = jest.fn();
      const debounced = debounce(fn, 100);

      debounced();
      expect(fn).not.toHaveBeenCalled();

      jest.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('resets timer on subsequent calls', () => {
      jest.useFakeTimers();
      const fn = jest.fn();
      const debounced = debounce(fn, 100);

      debounced();
      jest.advanceTimersByTime(50);
      debounced();
      jest.advanceTimersByTime(50);
      expect(fn).not.toHaveBeenCalled();

      jest.advanceTimersByTime(50);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('passes arguments to debounced function', () => {
      jest.useFakeTimers();
      const fn = jest.fn();
      const debounced = debounce(fn, 100);

      debounced('arg1', 42);
      jest.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledWith('arg1', 42);
    });

    test('preserves this context', () => {
      jest.useFakeTimers();
      const fn = jest.fn(function (this: { value: number }) {
        return this.value;
      });
      const debounced = debounce(fn, 100);
      const context = { value: 123, debounced };

      context.debounced();
      jest.advanceTimersByTime(100);
      expect(fn.mock.instances[0]).toBe(context);
    });
  });

  describe('throttle', () => {
    test('executes function immediately on first call', () => {
      jest.useFakeTimers();
      const fn = jest.fn();
      const throttled = throttle(fn, 100);

      throttled();
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('ignores calls within throttle limit', () => {
      jest.useFakeTimers();
      const fn = jest.fn();
      const throttled = throttle(fn, 100);

      throttled();
      throttled();
      throttled();
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('allows call after throttle limit expires', () => {
      jest.useFakeTimers();
      const fn = jest.fn();
      const throttled = throttle(fn, 100);

      throttled();
      jest.advanceTimersByTime(100);
      throttled();
      expect(fn).toHaveBeenCalledTimes(2);
    });

    test('passes arguments to throttled function', () => {
      jest.useFakeTimers();
      const fn = jest.fn();
      const throttled = throttle(fn, 100);

      throttled('a', true);
      expect(fn).toHaveBeenCalledWith('a', true);
    });
  });

  describe('validatePriority', () => {
    test('returns true for valid priorities 1-5', () => {
      expect(validatePriority(1)).toBe(true);
      expect(validatePriority(3)).toBe(true);
      expect(validatePriority(5)).toBe(true);
    });

    test('returns false for out of range priorities', () => {
      expect(validatePriority(0)).toBe(false);
      expect(validatePriority(6)).toBe(false);
      expect(validatePriority(-1)).toBe(false);
    });

    test('returns false for non-integers', () => {
      expect(validatePriority(2.5)).toBe(false);
      expect(validatePriority(NaN)).toBe(false);
    });
  });

  describe('validateProjectStatus', () => {
    test('returns true for valid statuses', () => {
      PROJECT_STATUS_VALUES.forEach((status) => {
        expect(validateProjectStatus(status)).toBe(true);
      });
    });

    test('returns false for invalid status', () => {
      expect(validateProjectStatus('unknown')).toBe(false);
      expect(validateProjectStatus('')).toBe(false);
    });

    test('acts as type guard', () => {
      const status: string = 'active';
      if (validateProjectStatus(status)) {
        expect(status).toBe('active');
      }
    });
  });

  describe('validateTaskStatus', () => {
    test('returns true for valid task statuses', () => {
      TASK_STATUS_VALUES.forEach((status) => {
        expect(validateTaskStatus(status)).toBe(true);
      });
    });

    test('returns false for invalid task status', () => {
      expect(validateTaskStatus('deleted')).toBe(false);
    });
  });

  describe('validateProgress', () => {
    test('returns true for valid progress 0-100', () => {
      expect(validateProgress(0)).toBe(true);
      expect(validateProgress(50)).toBe(true);
      expect(validateProgress(100)).toBe(true);
    });

    test('returns false for out of range progress', () => {
      expect(validateProgress(-1)).toBe(false);
      expect(validateProgress(101)).toBe(false);
    });

    test('returns false for non-finite values', () => {
      expect(validateProgress(NaN)).toBe(false);
      expect(validateProgress(Infinity)).toBe(false);
    });
  });

  describe('validateRequired', () => {
    test('throws for undefined value', () => {
      expect(() => validateRequired(undefined, 'name')).toThrow('name is required');
    });

    test('throws for null value', () => {
      expect(() => validateRequired(null, 'email')).toThrow('email is required');
    });

    test('throws for empty string', () => {
      expect(() => validateRequired('', 'title')).toThrow('title is required');
    });

    test('does not throw for valid values', () => {
      expect(() => validateRequired(0, 'count')).not.toThrow();
      expect(() => validateRequired(false, 'flag')).not.toThrow();
      expect(() => validateRequired('hello', 'name')).not.toThrow();
    });
  });

  describe('validatePath', () => {
    test('returns true for non-empty string', () => {
      expect(validatePath('/tmp/test')).toBe(true);
      expect(validatePath('a')).toBe(true);
    });

    test('returns false for empty string', () => {
      expect(validatePath('')).toBe(false);
    });

    test('returns false for non-string values', () => {
      expect(validatePath(null as any)).toBe(false);
      expect(validatePath(undefined as any)).toBe(false);
      expect(validatePath(123 as any)).toBe(false);
    });
  });

  describe('formatDuration', () => {
    test('formats seconds only', () => {
      expect(formatDuration(45000)).toBe('45s');
    });

    test('formats minutes and seconds', () => {
      expect(formatDuration(125000)).toBe('2m 5s');
    });

    test('formats hours and minutes', () => {
      expect(formatDuration(3661000)).toBe('1h 1m');
    });

    test('formats zero milliseconds', () => {
      expect(formatDuration(0)).toBe('0s');
    });
  });

  describe('clamp', () => {
    test('returns value when within range', () => {
      expect(clamp(5, 0, 10)).toBe(5);
    });

    test('returns min when below range', () => {
      expect(clamp(-5, 0, 10)).toBe(0);
    });

    test('returns max when above range', () => {
      expect(clamp(15, 0, 10)).toBe(10);
    });

    test('handles equal min and max', () => {
      expect(clamp(5, 3, 3)).toBe(3);
    });
  });

  describe('formatDate', () => {
    test('returns ISO string', () => {
      const date = new Date('2024-06-15T12:00:00.000Z');
      expect(formatDate(date)).toBe('2024-06-15T12:00:00.000Z');
    });
  });

  describe('parseDate', () => {
    test('parses ISO string to Date', () => {
      const result = parseDate('2024-06-15T12:00:00.000Z');
      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe('2024-06-15T12:00:00.000Z');
    });
  });

  describe('now', () => {
    test('returns current time as ISO string', () => {
      const before = new Date().toISOString();
      const result = now();
      const after = new Date().toISOString();
      expect(result >= before && result <= after).toBe(true);
    });
  });
});
