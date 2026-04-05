/**
 * logger.test.ts — System Zone 日志系统测试
 */
import { SZLogEntry, SZHealthReport, LogCategory, LogLevel } from '../logger';

// Capture console output
const consoleOutput: { level: string; args: any[] }[] = [];
const origLog = console.log;
const origWarn = console.warn;
const origError = console.error;

beforeEach(() => {
  consoleOutput.length = 0;
  console.log = (...args: any[]) => consoleOutput.push({ level: 'log', args });
  console.warn = (...args: any[]) => consoleOutput.push({ level: 'warn', args });
  console.error = (...args: any[]) => consoleOutput.push({ level: 'error', args });
});

afterEach(() => {
  console.log = origLog;
  console.warn = origWarn;
  console.error = origError;
});

// We test the types and basic module structure
describe('SZLogEntry type', () => {
  it('has required fields', () => {
    const entry: SZLogEntry = {
      timestamp: new Date().toISOString(),
      level: 'info',
      category: 'general',
      message: 'test',
    };
    expect(entry.timestamp).toBeDefined();
    expect(entry.level).toBe('info');
    expect(entry.category).toBe('general');
    expect(entry.message).toBe('test');
  });

  it('supports optional fields', () => {
    const entry: SZLogEntry = {
      timestamp: new Date().toISOString(),
      level: 'error',
      category: 'api',
      message: 'request failed',
      details: { url: '/api/test', status: 500 },
      error: 'Internal Server Error',
      correlationId: 'op-123-abc',
    };
    expect(entry.details).toBeDefined();
    expect(entry.error).toBe('Internal Server Error');
    expect(entry.correlationId).toBe('op-123-abc');
  });
});

describe('SZHealthReport type', () => {
  it('has required structure', () => {
    const report: SZHealthReport = {
      status: 'healthy',
      checks: [{ name: 'test', status: 'ok', message: 'all good' }],
      summary: 'All checks passed',
    };
    expect(report.status).toBe('healthy');
    expect(report.checks).toHaveLength(1);
    expect(report.summary).toBeDefined();
  });
});

describe('LogLevel and LogCategory types', () => {
  it('LogLevel accepts valid values', () => {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'];
    expect(levels).toHaveLength(5);
  });

  it('LogCategory accepts valid values', () => {
    const categories: LogCategory[] = ['api', 'ui', 'store', 'heartbeat', 'autoheal', 'general'];
    expect(categories).toHaveLength(6);
  });
});

describe('logger module exports', () => {
  it('exports szLog singleton', () => {
    // Dynamic import to get fresh module
    const logger = require('../logger');
    expect(logger.szLog).toBeDefined();
    expect(typeof logger.szLog.info).toBe('function');
    expect(typeof logger.szLog.error).toBe('function');
    expect(typeof logger.szLog.warn).toBe('function');
    expect(typeof logger.szLog.debug).toBe('function');
  });

  it('exports withLog helper', () => {
    const logger = require('../logger');
    expect(logger.withLog).toBeDefined();
    expect(typeof logger.withLog).toBe('function');
  });

  it('exports AutoHealEngine', () => {
    const logger = require('../logger');
    expect(logger.AutoHealEngine).toBeDefined();
    expect(typeof logger.AutoHealEngine).toBe('function');
  });

  it('exports autoHeal singleton', () => {
    const logger = require('../logger');
    expect(logger.autoHeal).toBeDefined();
    expect(typeof logger.autoHeal.start).toBe('function');
    expect(typeof logger.autoHeal.stop).toBe('function');
    expect(typeof logger.autoHeal.isRunning).toBe('function');
  });
});

describe('szLog basic operations', () => {
  // Need to require fresh for each test to avoid singleton state
  let szLog: any;

  beforeEach(() => {
    // Reset module cache
    jest.resetModules();
    // Re-mock console for the newly loaded module
    const logger = require('../logger');
    szLog = logger.szLog;
  });

  it('info logs to console', () => {
    szLog.info('general', 'test message');
    expect(consoleOutput.some(c => c.level === 'log')).toBe(true);
  });

  it('warn logs to console.warn', () => {
    szLog.warn('general', 'warning message');
    expect(consoleOutput.some(c => c.level === 'warn')).toBe(true);
  });

  it('error logs to console.error', () => {
    szLog.error('general', 'error message');
    expect(consoleOutput.some(c => c.level === 'error')).toBe(true);
  });

  it('debug does not log to console', () => {
    szLog.debug('general', 'debug message');
    expect(consoleOutput.some(c => c.args[1] === 'debug message')).toBe(false);
  });

  it('getAll returns entries', () => {
    szLog.info('general', 'entry1');
    szLog.info('general', 'entry2');
    const all = szLog.getAll();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('getAll filters by level', () => {
    szLog.info('general', 'info entry');
    szLog.error('general', 'error entry');
    const errors = szLog.getAll('error');
    expect(errors.every((e: SZLogEntry) => e.level === 'error')).toBe(true);
  });

  it('getRecentErrors returns error entries', () => {
    szLog.error('api', 'api error');
    szLog.error('ui', 'ui error');
    const errors = szLog.getRecentErrors(5);
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors.every((e: SZLogEntry) => e.level === 'error')).toBe(true);
  });

  it('checkHealth returns report', () => {
    const report = szLog.checkHealth();
    expect(report).toHaveProperty('status');
    expect(report).toHaveProperty('checks');
    expect(report).toHaveProperty('summary');
    expect(['healthy', 'degraded', 'unhealthy']).toContain(report.status);
  });

  it('checkHealth is healthy when no errors', () => {
    // Fresh instance should be healthy
    const report = szLog.checkHealth();
    expect(report.status).toBe('healthy');
  });

  it('startOperation generates correlation ID', () => {
    const opId = szLog.startOperation('test op');
    expect(opId).toMatch(/^op-/);
  });

  it('endOperation logs result', () => {
    szLog.endOperation('test op', true);
    expect(consoleOutput.some(c => c.level === 'log')).toBe(true);
  });
});

describe('withLog helper', () => {
  let szLog: any;

  beforeEach(() => {
    jest.resetModules();
    const logger = require('../logger');
    szLog = logger.szLog;
  });

  it('wraps successful async operations', async () => {
    const { withLog } = require('../logger');
    const result = await withLog('general', 'test op', async () => 42);
    expect(result).toBe(42);
  });

  it('propagates errors from wrapped function', async () => {
    const { withLog } = require('../logger');
    await expect(
      withLog('general', 'failing op', async () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');
  });
});

describe('AutoHealEngine', () => {
  let AutoHealEngine: any;
  let szLog: any;

  beforeEach(() => {
    jest.resetModules();
    const logger = require('../logger');
    AutoHealEngine = logger.AutoHealEngine;
    szLog = logger.szLog;
  });

  it('registers heal actions', () => {
    const engine = new AutoHealEngine();
    engine.registerHealAction('test', async () => true);
    expect(engine.isRunning()).toBe(false);
  });

  it('initially not running', () => {
    const engine = new AutoHealEngine();
    expect(engine.isRunning()).toBe(false);
  });
});
