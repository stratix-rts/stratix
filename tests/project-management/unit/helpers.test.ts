import {
  generateId,
  formatDate,
  parseDate,
  now,
  deepClone,
  validatePriority,
  validateProgress,
  validateProjectStatus,
  validateTaskStatus,
  validateRequired,
  validatePath,
  clamp,
  formatDuration,
  debounce,
  throttle,
} from '../../../src/stratix-project/utils/helpers';

describe('Helpers', () => {
  describe('generateId', () => {
    it('should generate ID with correct prefix', () => {
      const id = generateId('proj');
      expect(id).toMatch(/^proj_[a-z0-9]+_[a-z0-9]+$/);
    });

    it('should generate unique IDs', () => {
      const id1 = generateId('test');
      const id2 = generateId('test');
      expect(id1).not.toBe(id2);
    });

    it('should use different prefixes', () => {
      const projId = generateId('proj');
      const taskId = generateId('task');
      expect(projId).toMatch(/^proj_/);
      expect(taskId).toMatch(/^task_/);
    });
  });

  describe('formatDate', () => {
    it('should format date to ISO string', () => {
      const date = new Date('2026-03-02T12:00:00.000Z');
      expect(formatDate(date)).toBe('2026-03-02T12:00:00.000Z');
    });
  });

  describe('parseDate', () => {
    it('should parse ISO string to Date', () => {
      const dateString = '2026-03-02T12:00:00.000Z';
      const date = parseDate(dateString);
      expect(date).toBeInstanceOf(Date);
      expect(date.toISOString()).toBe(dateString);
    });
  });

  describe('deepClone', () => {
    it('should deep clone an object', () => {
      const original = { a: 1, b: { c: 2 } };
      const cloned = deepClone(original);
      
      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
      expect(cloned.b).not.toBe(original.b);
    });

    it('should deep clone an array', () => {
      const original = [1, [2, 3], { a: 4 }];
      const cloned = deepClone(original);
      
      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
      expect(cloned[1]).not.toBe(original[1]);
    });
  });

  describe('validatePriority', () => {
    it('should validate priority between 1 and 5', () => {
      expect(validatePriority(1)).toBe(true);
      expect(validatePriority(3)).toBe(true);
      expect(validatePriority(5)).toBe(true);
      expect(validatePriority(0)).toBe(false);
      expect(validatePriority(6)).toBe(false);
      expect(validatePriority(1.5)).toBe(false);
    });
  });

  describe('validateProgress', () => {
    it('should validate progress between 0 and 100', () => {
      expect(validateProgress(0)).toBe(true);
      expect(validateProgress(50)).toBe(true);
      expect(validateProgress(100)).toBe(true);
      expect(validateProgress(-1)).toBe(false);
      expect(validateProgress(101)).toBe(false);
    });
  });

  describe('validateProjectStatus', () => {
    it('should validate correct project statuses', () => {
      expect(validateProjectStatus('pending')).toBe(true);
      expect(validateProjectStatus('active')).toBe(true);
      expect(validateProjectStatus('paused')).toBe(true);
      expect(validateProjectStatus('completed')).toBe(true);
      expect(validateProjectStatus('failed')).toBe(true);
      expect(validateProjectStatus('invalid')).toBe(false);
    });
  });

  describe('validateTaskStatus', () => {
    it('should validate correct task statuses', () => {
      expect(validateTaskStatus('pending')).toBe(true);
      expect(validateTaskStatus('running')).toBe(true);
      expect(validateTaskStatus('completed')).toBe(true);
      expect(validateTaskStatus('invalid')).toBe(false);
    });
  });

  describe('validateRequired', () => {
    it('should not throw for valid values', () => {
      expect(() => validateRequired('test', 'field')).not.toThrow();
      expect(() => validateRequired(123, 'field')).not.toThrow();
      expect(() => validateRequired(0, 'field')).not.toThrow();
      expect(() => validateRequired(false, 'field')).not.toThrow();
    });

    it('should throw for invalid values', () => {
      expect(() => validateRequired(undefined, 'field')).toThrow('field is required');
      expect(() => validateRequired(null, 'field')).toThrow('field is required');
      expect(() => validateRequired('', 'field')).toThrow('field is required');
    });
  });

  describe('validatePath', () => {
    it('should validate non-empty strings', () => {
      expect(validatePath('/valid/path')).toBe(true);
      expect(validatePath('C:\\Windows')).toBe(true);
    });

    it('should reject invalid paths', () => {
      expect(validatePath('')).toBe(false);
      expect(validatePath(null as any)).toBe(false);
      expect(validatePath(undefined as any)).toBe(false);
    });
  });

  describe('clamp', () => {
    it('should clamp value to range', () => {
      expect(clamp(5, 0, 10)).toBe(5);
      expect(clamp(-5, 0, 10)).toBe(0);
      expect(clamp(15, 0, 10)).toBe(10);
    });
  });

  describe('formatDuration', () => {
    it('should format seconds', () => {
      expect(formatDuration(5000)).toBe('5s');
      expect(formatDuration(30000)).toBe('30s');
    });

    it('should format minutes and seconds', () => {
      expect(formatDuration(90000)).toBe('1m 30s');
      expect(formatDuration(125000)).toBe('2m 5s');
    });

    it('should format hours, minutes and seconds', () => {
      expect(formatDuration(3661000)).toBe('1h 1m');
      expect(formatDuration(7325000)).toBe('2h 2m');
    });
  });

  describe('now', () => {
    it('should return ISO string', () => {
      const result = now();
      expect(typeof result).toBe('string');
      expect(new Date(result).toISOString()).toBe(result);
    });
  });

  describe('debounce', () => {
    it('should debounce function calls', async () => {
      jest.useFakeTimers();
      const func = jest.fn();
      const debouncedFn = debounce(func, 100);

      debouncedFn();
      debouncedFn();
      debouncedFn();

      expect(func).not.toHaveBeenCalled();

      jest.advanceTimersByTime(100);

      expect(func).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });

    it('should pass arguments to debounced function', () => {
      jest.useFakeTimers();
      const func = jest.fn();
      const debouncedFn = debounce(func, 100);

      debouncedFn('arg1', 'arg2');

      jest.advanceTimersByTime(100);

      expect(func).toHaveBeenCalledWith('arg1', 'arg2');

      jest.useRealTimers();
    });

    it('should reset timer on subsequent calls', () => {
      jest.useFakeTimers();
      const func = jest.fn();
      const debouncedFn = debounce(func, 100);

      debouncedFn();
      jest.advanceTimersByTime(50);
      debouncedFn();
      jest.advanceTimersByTime(50);
      debouncedFn();

      jest.advanceTimersByTime(100);

      expect(func).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });
  });

  describe('throttle', () => {
    it('should throttle function calls', () => {
      jest.useFakeTimers();
      const func = jest.fn();
      const throttledFn = throttle(func, 100);

      throttledFn();
      throttledFn();
      throttledFn();

      expect(func).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(100);

      throttledFn();

      expect(func).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });

    it('should pass arguments to throttled function', () => {
      jest.useFakeTimers();
      const func = jest.fn();
      const throttledFn = throttle(func, 100);

      throttledFn('arg1', 'arg2');

      expect(func).toHaveBeenCalledWith('arg1', 'arg2');

      jest.useRealTimers();
    });

    it('should allow immediate call on first invocation', () => {
      jest.useFakeTimers();
      const func = jest.fn();
      const throttledFn = throttle(func, 100);

      throttledFn();

      expect(func).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(50);

      throttledFn();

      expect(func).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(100);

      throttledFn();

      expect(func).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });
  });
});
