import { ChildProcess, spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { unlink, writeFile } from 'fs/promises';

import { SkillDefinition, SkillExecutor, ExecutionContext } from '../../types';

function log(level: 'info' | 'warn' | 'error', message: string, ctx?: Record<string, unknown>): void {
  console[level](`[CodeSandboxSkillExecutor] ${message}`, ctx || '');
}

/**
 * Code Sandbox Executor - Enhanced Security Version
 * Executes JavaScript using isolated Function() with restricted globals
 * Executes Python using child_process with forbidden modules check
 */
export class CodeSandboxSkillExecutor implements SkillExecutor {
  // Forbidden JavaScript globals that could be used for attacks
  private static readonly FORBIDDEN_JS_GLOBALS = [
    'window', 'document', 'fetch', 'XMLHttpRequest', 'WebSocket',
    'import', 'require', 'eval', 'Function', 'globalThis', 'global',
    'process', 'Buffer', '__dirname', '__filename', 'module', 'exports',
    'navigator', 'location', 'history', 'localStorage', 'sessionStorage',
    'indexedDB', 'openDatabase', 'setImmediate', 'clearImmediate',
    'postMessage', 'addEventListener', 'removeEventListener',
    'MutationObserver', 'IntersectionObserver', 'requestIdleCallback',
  ];

  // Forbidden Python modules that could be used for attacks
  private static readonly FORBIDDEN_PYTHON_MODULES = [
    'os', 'subprocess', 'socket', 'requests', 'urllib', 'urllib2', 'urllib3',
    'http', 'ftp', 'tempfile', 'shutil', 'pickle', 'marshal', 'eval',
    'exec', 'code', 'compile', 'builtins', 'sys', 'importlib', 'pkgutil',
    'pathlib', 'glob', 'fnmatch', 'tarfile', 'zipfile', 'gzip', 'bz2',
    'lzma', 'zlib', 'crypt', 'cryptography', 'ssl', 'select',
    'multiprocessing', 'concurrent', 'threading', 'asyncio', 'gevent',
    'ctypes', 'cffi', 'resource', 'signal', 'pty', 'tty', 'termios',
    'fcntl', 'grp', 'pwd', 'spwd', 'tty', 'fcntl', 'distutils', 'setuptools',
  ];

  // Dangerous JavaScript code patterns
  private static readonly DANGEROUS_JS_PATTERNS = [
    { pattern: /import\s*\(/, reason: 'Dynamic import()' },
    { pattern: /require\s*\(/, reason: 'require()' },
    { pattern: /eval\s*\(/, reason: 'eval()' },
    { pattern: /new\s+Function\s*\(/, reason: 'new Function()' },
    { pattern: /\bprocess\b/, reason: 'process object' },
    { pattern: /\bglobal\[/, reason: 'global bracket access' },
    { pattern: /\bglobalThis\b/, reason: 'globalThis' },
    { pattern: /__dirname/, reason: '__dirname' },
    { pattern: /__filename/, reason: '__filename' },
    { pattern: /for\s*\(\s*\w+\s+in\s+/, reason: 'for...in loop (prototype pollution risk)' },
    { pattern: /\bconstructor\b.*\bprototype\b/, reason: 'Prototype manipulation' },
    { pattern: /\bObject\.defineProperty\b/, reason: 'Property definition' },
    { pattern: /\bObject\.setPrototypeOf\b/, reason: 'Prototype chain modification' },
    { pattern: /\b__proto__\b/, reason: '__proto__ access' },
    { pattern: /\[Symbol\]\s*\(/, reason: 'Symbol injection' },
    { pattern: /proxy|Proxy/, reason: 'Proxy object' },
    { pattern: /Reflect\./, reason: 'Reflect API' },
  ];

  // Dangerous Python code patterns
  private static readonly DANGEROUS_PYTHON_PATTERNS = [
    { pattern: /import\s+(os|subprocess|socket|requests|urllib|http|ftp|tempfile|shutil)/, reason: 'Forbidden import' },
    { pattern: /from\s+(os|subprocess|socket|requests|urllib|http|ftp|tempfile|shutil)\s+import/, reason: 'Forbidden from import' },
    { pattern: /\bos\./, reason: 'os module access' },
    { pattern: /\bsubprocess\./, reason: 'subprocess module access' },
    { pattern: /\bsocket\./, reason: 'socket module access' },
    { pattern: /\bopen\s*\(/, reason: 'file open()' },
    { pattern: /\bexec\s*\(/, reason: 'exec()' },
    { pattern: /\beval\s*\(/, reason: 'eval()' },
    { pattern: /\bcompile\s*\(/, reason: 'compile()' },
    { pattern: /\bgetattr\s*\(/, reason: 'getattr()' },
    { pattern: /\bsetattr\s*\(/, reason: 'setattr()' },
    { pattern: /\bdelattr\s*\(/, reason: 'delattr()' },
    { pattern: /\b__import__\s*\(/, reason: '__import__()' },
    { pattern: /\binput\s*\(/, reason: 'input() (DoS risk)' },
    { pattern: /\bcompile\s*\(/, reason: 'compile()' },
    { pattern: /\bmarshal\.loads\b/, reason: 'marshal loads' },
    { pattern: /\bpickle\.loads\b/, reason: 'pickle loads' },
  ];

  private getSandboxConfig(context: ExecutionContext) {
    return {
      maxMemory: context.sandboxConfig?.maxMemory ?? 128,
      maxCpuTime: context.sandboxConfig?.maxCpuTime ?? 10,
      maxOutputSize: context.sandboxConfig?.maxOutputSize ?? 1024 * 1024,
      maxFileSize: context.sandboxConfig?.maxFileSize ?? 10 * 1024 * 1024,
      maxTempFiles: context.sandboxConfig?.maxTempFiles ?? 5,
    };
  }

  async execute(
    skill: SkillDefinition,
    params: Record<string, any>,
    context: ExecutionContext
  ): Promise<any> {
    const { code, language } = params;
    const progress = context.progressCallback;
    const config = this.getSandboxConfig(context);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const progressAny = progress as any;

    progress?.({ skillId: skill.skillId, stage: 'started', message: `Executing ${language}...` });

    if (language === 'javascript') {
      return this.executeJavaScript(code, progressAny, config);
    } else if (language === 'python') {
      return this.executePython(code, progressAny, config);
    } else {
      throw new Error(`Unsupported language: ${language}. Supported: javascript, python`);
    }
  }

  private validateJavaScript(code: string): { valid: boolean; reason?: string } {
    // Check for forbidden globals
    for (const global of CodeSandboxSkillExecutor.FORBIDDEN_JS_GLOBALS) {
      // Check both direct references and bracket notation
      const directPattern = new RegExp(`\\b${global}\\b`);
      const bracketPattern = new RegExp(`\\bglobal\\s*\\[\\s*['"']${global}['"']\\s*\\]`);

      if (directPattern.test(code) || bracketPattern.test(code)) {
        return { valid: false, reason: `Forbidden global: ${global}` };
      }
    }

    // Check for dangerous patterns
    for (const { pattern, reason } of CodeSandboxSkillExecutor.DANGEROUS_JS_PATTERNS) {
      if (pattern.test(code)) {
        return { valid: false, reason: `Dangerous pattern: ${reason}` };
      }
    }

    // Check code length
    if (code.length > 50000) {
      return { valid: false, reason: 'Code too long (max 50KB)' };
    }

    return { valid: true };
  }

  private executeJavaScript(code: string, progress?: (p: unknown) => void, config?: ReturnType<typeof this.getSandboxConfig>): Promise<unknown> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const progressAny = progress as any;
    return new Promise((resolve, reject) => {
      try {
        // Validate code before execution
        const validation = this.validateJavaScript(code);
        if (!validation.valid) {
          reject(new Error(`JavaScript validation failed: ${validation.reason}`));
          return;
        }

        // Capture console.log output
        const logs: string[] = [];
        const mockConsole = {
          log: (...args: unknown[]) => {
            const msg = args.map(String).join(' ');
            // Enforce output size limit
            if (logs.join('\n').length + msg.length > (config?.maxOutputSize ?? 1024 * 1024)) {
              logs.push('[output truncated]');
              return;
            }
            logs.push(msg);
          },
          error: (...args: unknown[]) => logs.push('[error] ' + args.map(String).join(' ')),
          warn: (...args: unknown[]) => logs.push('[warn] ' + args.map(String).join(' ')),
          info: (...args: unknown[]) => logs.push('[info] ' + args.map(String).join(' ')),
          debug: (...args: unknown[]) => logs.push('[debug] ' + args.map(String).join(' ')),
        };

        // Create a sandboxed function with limited globals
        const sandbox = {
          console: mockConsole,
          Math,
          JSON,
          Array,
          Object,
          String,
          Number,
          Boolean,
          Date,
          RegExp,
          Error,
          TypeError,
          RangeError,
          SyntaxError,
          ReferenceError,
          Map,
          Set,
          WeakMap,
          WeakSet,
          Promise,
          parseInt,
          parseFloat,
          isNaN,
          isFinite,
          encodeURIComponent,
          decodeURIComponent,
          encodeURI,
          decodeURI,
          escape,
          unescape,
          Infinity,
          NaN,
          undefined,
          null: null,
          true: true,
          false: false,
        };

        const sandboxKeys = Object.keys(sandbox);
        const sandboxValues = Object.values(sandbox);

        // Filter out invalid identifier names (null, true, false, undefined, Infinity, NaN)
        // These cannot be used as function parameter names but are either global or handled separately
        const INVALID_IDENTIFIERS = new Set(['null', 'true', 'false', 'undefined', 'Infinity', 'NaN']);
        const validKeys: string[] = [];
        const validValues: unknown[] = [];
        for (let i = 0; i < sandboxKeys.length; i++) {
          const key = sandboxKeys[i];
          // Skip invalid identifiers that can't be function parameter names
          if (!INVALID_IDENTIFIERS.has(key) && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)) {
            validKeys.push(key);
            validValues.push(sandboxValues[i]);
          }
        }

        // Set up timeout for execution
        const timeoutMs = (config?.maxCpuTime ?? 10) * 1000;
        let timeoutId: NodeJS.Timeout | null = null;

        // Auto-wrap single-expression code with return
        // Check if code is a simple expression (no semicolons at top level)
        const isExpression = (c: string): boolean => {
          let inString = false;
          let stringChar = '';
          for (let i = 0; i < c.length; i++) {
            const ch = c[i];
            if (!inString && (ch === '"' || ch === "'" || ch === '`')) {
              inString = true;
              stringChar = ch;
            } else if (inString && ch === stringChar && c[i-1] !== '\\') {
              inString = false;
            } else if (!inString && ch === ';') {
              return false;
            }
          }
          return true;
        };

        const wrappedCode = isExpression(code.trim()) && !code.trim().startsWith('return ')
          ? `return ${code}`
          : code;

        // Execute in isolated context
        const fn = new Function(...validKeys, wrappedCode);
        const result = fn(...validValues);

        // Handle async results
        const handleResult = (value: unknown) => {
          if (timeoutId) clearTimeout(timeoutId);
          progress?.({ skillId: 'code_execute', stage: 'completed' });
          const output = logs.length > 0 ? logs.join('\n') : String(value);
          resolve({
            result: value,
            logs,
            success: true,
            preview: { type: 'code', content: output.slice(0, Math.min(output.length, config?.maxOutputSize ?? 1024 * 1024)) }
          });
        };

        const handleError = (err: Error) => {
          if (timeoutId) clearTimeout(timeoutId);
          progress?.({ skillId: 'code_execute', stage: 'failed' });
          reject(new Error(`Execution error: ${err.message}`));
        };

        // Set up timeout
        timeoutId = setTimeout(() => {
          handleError(new Error(`Execution timeout (${timeoutMs / 1000}s exceeded)`));
        }, timeoutMs);

        if (result instanceof Promise) {
          result
            .then(handleResult)
            .catch(handleError);
        } else {
          handleResult(result);
        }
      } catch (error) {
        progress?.({ skillId: 'code_execute', stage: 'failed' });
        reject(new Error(`JavaScript execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
      }
    });
  }

  private validatePython(code: string): { valid: boolean; reason?: string } {
    // Check for forbidden modules
    for (const module of CodeSandboxSkillExecutor.FORBIDDEN_PYTHON_MODULES) {
      // Check both import and from ... import patterns
      const importPattern = new RegExp(`import\\s+${module}\\b`);
      const fromImportPattern = new RegExp(`from\\s+${module}\\s+import`);
      const dotAccessPattern = new RegExp(`\\b${module}\\.`);

      if (importPattern.test(code) || fromImportPattern.test(code) || dotAccessPattern.test(code)) {
        return { valid: false, reason: `Forbidden module: ${module}` };
      }
    }

    // Check for dangerous patterns
    for (const { pattern, reason } of CodeSandboxSkillExecutor.DANGEROUS_PYTHON_PATTERNS) {
      if (pattern.test(code)) {
        return { valid: false, reason: `Dangerous pattern: ${reason}` };
      }
    }

    // Check code length
    if (code.length > 50000) {
      return { valid: false, reason: 'Code too long (max 50KB)' };
    }

    return { valid: true };
  }

  private executePython(code: string, progress?: (p: unknown) => void, config?: ReturnType<typeof this.getSandboxConfig>): Promise<unknown> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const progressAny = progress as any;
    return new Promise((resolve, reject) => {

      // Validate code before execution
      const validation = this.validatePython(code);
      if (!validation.valid) {
        reject(new Error(`Python validation failed: ${validation.reason}`));
        return;
      }

      // Write code to temp file
      const tempFile = path.join(os.tmpdir(), `stratix_sandbox_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);

      (async () => {
        try {
          await writeFile(tempFile, code);
          progress?.({ skillId: 'code_execute', stage: 'processing', message: 'Running Python...' });

          const cpuTime = config?.maxCpuTime ?? 10;
          const maxOutput = config?.maxOutputSize ?? 1024 * 1024;

          const proc = spawn('python3', [tempFile], {
            timeout: cpuTime * 1000,
          }) as ChildProcess;

          let stdout = '';
          let stderr = '';
          let outputTruncated = false;

          proc.stdout!.on('data', (data: Buffer) => {
            if (stdout.length + data.length > maxOutput) {
              stdout += data.toString().slice(0, maxOutput - stdout.length);
              outputTruncated = true;
              return;
            }
            stdout += data.toString();
          });

          proc.stderr!.on('data', (data: Buffer) => {
            stderr += data.toString();
          });

          proc.on('close', async (code: number) => {
            // Clean up temp file
            try {
              await unlink(tempFile);
            } catch (err) {
              log('warn', 'Temp file cleanup failed', { error: String(err) });
            }

            if (code === 0) {
              progress?.({ skillId: 'code_execute', stage: 'completed' });
              const finalOutput = outputTruncated ? stdout.trim() + '\n[output truncated]' : stdout.trim();
              resolve({
                result: stdout.trim(),
                logs: [],
                success: true,
                preview: { type: 'code', content: finalOutput.slice(0, Math.min(finalOutput.length, maxOutput)) }
              });
            } else {
              progress?.({ skillId: 'code_execute', stage: 'failed' });
              reject(new Error(`Python execution failed (exit ${code}): ${stderr || stdout}`));
            }
          });

          proc.on('error', async (err: Error) => {
            try {
              await unlink(tempFile);
            } catch (cleanupErr) {
              log('warn', 'Temp file cleanup failed', { error: String(cleanupErr) });
            }
            progress?.({ skillId: 'code_execute', stage: 'failed' });
            reject(new Error(`Python spawn error: ${err.message}`));
          });
        } catch (error) {
          progress?.({ skillId: 'code_execute', stage: 'failed' });
          reject(new Error(`Failed to execute Python: ${error instanceof Error ? error.message : 'Unknown error'}`));
        }
      })();
    });
  }
}
