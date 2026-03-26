import { SkillDefinition, SkillExecutor, ExecutionContext } from '../types';
import { SafetyValidator } from './SafetyValidator';

export class HttpSkillExecutor implements SkillExecutor {
  async execute(
    skill: SkillDefinition,
    params: Record<string, any>,
    context: ExecutionContext
  ): Promise<any> {
    // Handle web_search specially - uses DuckDuckGo API
    if (skill.skillId === 'web_search') {
      const { query, num_results = 5 } = params;
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1`;

      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
        });

        const data = await response.json();

        // Extract relevant results
        const results: { title: string; url: string; snippet: string }[] = [];

        if (data.RelatedTopics && data.RelatedTopics.length > 0) {
          for (const topic of data.RelatedTopics.slice(0, num_results)) {
            if (topic.Text && topic.FirstURL) {
              results.push({
                title: topic.Text.split(' - ')[0] || topic.Text,
                url: topic.FirstURL,
                snippet: topic.Text,
              });
            }
          }
        }

        // Also include Abstract if available
        if (data.AbstractText && results.length < num_results) {
          results.unshift({
            title: data.Heading || 'Wikipedia Summary',
            url: data.AbstractURL || '',
            snippet: data.AbstractText,
          });
        }

        return {
          query,
          results: results.slice(0, num_results),
          total: results.length,
        };
      } catch (error) {
        throw new Error(`Web search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Handle file_download specially - fetch and save to file
    if (skill.skillId === 'file_download') {
      const { url, path } = params;
      const { writeFile } = require('fs/promises');

      try {
        const response = await fetch(url, { method: 'GET' });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const buffer = await response.arrayBuffer();
        await writeFile(path, Buffer.from(buffer));

        return { success: true, path, size: buffer.byteLength };
      } catch (error) {
        throw new Error(`File download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Default HTTP handling for generic API calls
    const url = params.url || params.endpoint;
    const method = params.method || 'GET';
    const headers = params.headers || {};

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: params.body ? JSON.stringify(params.body) : undefined,
      });

      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        return await response.json();
      }
      return await response.text();
    } catch (error) {
      throw new Error(`HTTP request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

export class BuiltinSkillExecutor implements SkillExecutor {
  private calculators = {
    add: (a: number, b: number) => a + b,
    subtract: (a: number, b: number) => a - b,
    multiply: (a: number, b: number) => a * b,
    divide: (a: number, b: number) => {
      if (b === 0) throw new Error('Division by zero');
      return a / b;
    },
    pow: (a: number, b: number) => Math.pow(a, b),
    sqrt: (a: number) => Math.sqrt(a),
    abs: (a: number) => Math.abs(a),
    round: (a: number) => Math.round(a),
    floor: (a: number) => Math.floor(a),
    ceil: (a: number) => Math.ceil(a),
  };

  /**
   * 安全表达式求值器 - 避免使用 Function() 带来的注入风险
   * 支持: +, -, *, /, ^, sqrt, abs, round, floor, ceil, 括号
   */
  private evaluateExpression(expression: string): number {
    const sanitized = expression.replace(/\s+/g, '');

    // Tokenizer
    const tokens: (number | string)[] = [];
    let i = 0;
    while (i < sanitized.length) {
      const char = sanitized[i];

      if (/[0-9.]/.test(char)) {
        let num = '';
        while (i < sanitized.length && /[0-9.]/.test(sanitized[i])) {
          num += sanitized[i];
          i++;
        }
        tokens.push(parseFloat(num));
      } else if (/[+\-*/^()]/.test(char)) {
        tokens.push(char);
        i++;
      } else if (/[a-z]/.test(char)) {
        let name = '';
        while (i < sanitized.length && /[a-z]/.test(sanitized[i])) {
          name += sanitized[i];
          i++;
        }
        tokens.push(name);
      } else {
        throw new Error(`Invalid character: ${char}`);
      }
    }

    // Parser & Evaluator using recursive descent
    let pos = 0;

    const peek = () => tokens[pos];
    const consume = () => tokens[pos++];

    const parseExpression = (): number => {
      return parseAddSub();
    };

    const parseAddSub = (): number => {
      let left = parseMulDiv();
      while (peek() === '+' || peek() === '-') {
        const op = consume() as string;
        const right = parseMulDiv();
        left = op === '+' ? left + right : left - right;
      }
      return left;
    };

    const parseMulDiv = (): number => {
      let left = parsePower();
      while (peek() === '*' || peek() === '/') {
        const op = consume() as string;
        const right = parsePower();
        if (op === '/') {
          if (right === 0) throw new Error('Division by zero');
          left = left / right;
        } else {
          left = left * right;
        }
      }
      return left;
    };

    const parsePower = (): number => {
      let left = parseUnary();
      while (peek() === '^') {
        consume();
        const right = parseUnary();
        left = Math.pow(left, right);
      }
      return left;
    };

    const parseUnary = (): number => {
      if (peek() === '-') {
        consume();
        return -parseUnary();
      }
      return parsePrimary();
    };

    const parsePrimary = (): number => {
      const token = peek();

      if (token === '(') {
        consume();
        const result = parseExpression();
        if (consume() !== ')') throw new Error('Expected closing parenthesis');
        return result;
      }

      if (typeof token === 'number') {
        consume();
        return token;
      }

      if (typeof token === 'string' && /^[a-z]+$/.test(token)) {
        consume();
        if (peek() === '(') {
          consume();
          const arg = parseExpression();
          if (consume() !== ')') throw new Error('Expected closing parenthesis');
          return this.evaluateFunction(token, arg);
        }
        throw new Error(`Expected '(' after function name ${token}`);
      }

      throw new Error(`Unexpected token: ${token}`);
    };

    const result = parseExpression();
    if (pos < tokens.length) {
      throw new Error(`Unexpected token after expression: ${tokens[pos]}`);
    }
    return result;
  }

  private evaluateFunction(name: string, arg: number): number {
    switch (name) {
      case 'sqrt': return Math.sqrt(arg);
      case 'abs': return Math.abs(arg);
      case 'round': return Math.round(arg);
      case 'floor': return Math.floor(arg);
      case 'ceil': return Math.ceil(arg);
      case 'sin': return Math.sin(arg);
      case 'cos': return Math.cos(arg);
      case 'tan': return Math.tan(arg);
      case 'log': return Math.log(arg);
      case 'log10': return Math.log10(arg);
      case 'exp': return Math.exp(arg);
      default: throw new Error(`Unknown function: ${name}`);
    }
  }

  async execute(
    skill: SkillDefinition,
    params: Record<string, any>,
    context: ExecutionContext
  ): Promise<any> {
    const { operation, expression } = params;

    if (expression) {
      try {
        const result = this.evaluateExpression(expression);
        return { result };
      } catch (error) {
        throw new Error(`Expression evaluation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    if (operation && this.calculators[operation as keyof typeof this.calculators]) {
      const op = operation as keyof typeof this.calculators;
      if (op === 'sqrt' || op === 'abs' || op === 'round' || op === 'floor' || op === 'ceil') {
        return { result: this.calculators[op](params.a ?? params.value), operation };
      }
      return { result: this.calculators[op](params.a, params.b), operation };
    }

    throw new Error('No operation or expression provided');
  }
}

export class FileSystemSkillExecutor implements SkillExecutor {
  async execute(
    skill: SkillDefinition,
    params: Record<string, any>,
    context: ExecutionContext
  ): Promise<any> {
    const { readFile, writeFile, appendFile, mkdir, readdir, rm, stat } = require('fs/promises');
    const { existsSync } = require('fs');
    const path = require('path');

    const basePath = context.variables?.basePath || process.cwd();
    const filePath = path.isAbsolute(params.path)
      ? params.path
      : path.join(basePath, params.path);

    const progress = context.progressCallback;

    switch (skill.skillId) {
      case 'file_read': {
        progress?.({ skillId: skill.skillId, stage: 'processing', message: 'Reading file...' });
        const content = await readFile(filePath, params.encoding || 'utf-8');
        const preview = content.length > 1000
          ? { type: 'text' as const, content: content.slice(0, 1000) + '...[truncated]' }
          : { type: 'text' as const, content };
        progress?.({ skillId: skill.skillId, stage: 'completed' });
        return { content, path: filePath, preview };
      }

      case 'file_write': {
        progress?.({ skillId: skill.skillId, stage: 'processing', message: 'Writing file...' });
        await writeFile(filePath, params.content, params.encoding || 'utf-8');
        progress?.({ skillId: skill.skillId, stage: 'completed' });
        return { success: true, path: filePath };
      }

      case 'file_append': {
        progress?.({ skillId: skill.skillId, stage: 'processing', message: 'Appending to file...' });
        await appendFile(filePath, params.content, params.encoding || 'utf-8');
        progress?.({ skillId: skill.skillId, stage: 'completed' });
        return { success: true, path: filePath };
      }

      case 'file_list': {
        progress?.({ skillId: skill.skillId, stage: 'processing', message: 'Listing directory...' });
        const files = await readdir(filePath);
        progress?.({ skillId: skill.skillId, stage: 'completed' });
        return { files, path: filePath, preview: { type: 'table', content: `${files.length} items` } };
      }

      case 'file_delete': {
        progress?.({ skillId: skill.skillId, stage: 'processing', message: 'Deleting...' });
        await rm(filePath, { recursive: params.recursive || false });
        progress?.({ skillId: skill.skillId, stage: 'completed' });
        return { success: true, path: filePath };
      }

      case 'file_info': {
        const info = await stat(filePath);
        return {
          size: info.size,
          created: info.birthtime,
          modified: info.mtime,
          isDirectory: info.isDirectory(),
          isFile: info.isFile(),
          path: filePath,
          preview: { type: 'json', content: JSON.stringify({ size: info.size, type: info.isDirectory() ? 'directory' : 'file' }) }
        };
      }

      default:
        throw new Error(`Unknown file operation: ${skill.skillId}`);
    }
  }
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

    progress?.({ skillId: skill.skillId, stage: 'started', message: `Executing ${language}...` });

    if (language === 'javascript') {
      return this.executeJavaScript(code, progress, config);
    } else if (language === 'python') {
      return this.executePython(code, progress, config);
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

  private executeJavaScript(code: string, progress?: (p: any) => void, config?: ReturnType<typeof this.getSandboxConfig>): Promise<any> {
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
          log: (...args: any[]) => {
            const msg = args.map(String).join(' ');
            // Enforce output size limit
            if (logs.join('\n').length + msg.length > (config?.maxOutputSize ?? 1024 * 1024)) {
              logs.push('[output truncated]');
              return;
            }
            logs.push(msg);
          },
          error: (...args: any[]) => logs.push('[error] ' + args.map(String).join(' ')),
          warn: (...args: any[]) => logs.push('[warn] ' + args.map(String).join(' ')),
          info: (...args: any[]) => logs.push('[info] ' + args.map(String).join(' ')),
          debug: (...args: any[]) => logs.push('[debug] ' + args.map(String).join(' ')),
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
        const validValues: any[] = [];
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
        const handleResult = (value: any) => {
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

  private executePython(code: string, progress?: (p: any) => void, config?: ReturnType<typeof this.getSandboxConfig>): Promise<any> {
    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process');
      const { writeFile, unlink } = require('fs/promises');
      const { join } = require('path');
      const os = require('os');

      // Validate code before execution
      const validation = this.validatePython(code);
      if (!validation.valid) {
        reject(new Error(`Python validation failed: ${validation.reason}`));
        return;
      }

      // Write code to temp file
      const tempFile = join(os.tmpdir(), `stratix_sandbox_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);

      (async () => {
        try {
          await writeFile(tempFile, code);
          progress?.({ skillId: 'code_execute', stage: 'processing', message: 'Running Python...' });

          const cpuTime = config?.maxCpuTime ?? 10;
          const maxOutput = config?.maxOutputSize ?? 1024 * 1024;

          const proc = spawn('python3', [tempFile], {
            timeout: cpuTime * 1000,
            maxBuffer: maxOutput,
          });

          let stdout = '';
          let stderr = '';
          let outputTruncated = false;

          proc.stdout.on('data', (data: Buffer) => {
            if (stdout.length + data.length > maxOutput) {
              stdout += data.toString().slice(0, maxOutput - stdout.length);
              outputTruncated = true;
              return;
            }
            stdout += data.toString();
          });

          proc.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
          });

          proc.on('close', async (code: number) => {
            // Clean up temp file
            try {
              await unlink(tempFile);
            } catch {}

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
            } catch {}
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

export class DefaultSkillExecutor implements SkillExecutor {
  async execute(
    skill: SkillDefinition,
    params: Record<string, any>,
    context: ExecutionContext
  ): Promise<any> {
    return {
      skillId: skill.skillId,
      params,
      message: `Skill ${skill.name} executed successfully`,
    };
  }
}

/**
 * Bash 命令执行器
 * 支持执行 shell 命令，带安全验证
 */
export class BashSkillExecutor implements SkillExecutor {
  async execute(
    skill: SkillDefinition,
    params: Record<string, any>,
    context: ExecutionContext
  ): Promise<any> {
    const { command, timeout = 30, cwd } = params;
    const progress = context.progressCallback;

    // 验证命令安全性
    const validation = SafetyValidator.validateBashCommand(command, context);
    if (!validation.valid) {
      throw new Error(`Command blocked: ${validation.reason}`);
    }

    progress?.({ skillId: skill.skillId, stage: 'processing', message: 'Executing command...' });

    // 执行命令
    return new Promise((resolve, reject) => {
      const { exec } = require('child_process');
      const options: any = {
        timeout: Math.min((timeout as number), 120) * 1000,  // 最多120秒
        maxBuffer: 10 * 1024 * 1024  // 10MB
      };
      if (cwd) options.cwd = cwd;

      exec(command, options, (error: any, stdout: string, stderr: string) => {
        if (error) {
          progress?.({ skillId: skill.skillId, stage: 'failed' });
          reject(new Error(`Command failed: ${error.message}\nStderr: ${stderr}`));
          return;
        }
        progress?.({ skillId: skill.skillId, stage: 'completed' });
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          success: true,
          preview: { type: 'text', content: stdout.trim().slice(0, 500) }
        });
      });
    });
  }
}

/**
 * Zone 操作执行器
 * 支持 Agent 进入/离开 Zone，获取 Zone 列表和详情
 */
export class ZoneSkillExecutor implements SkillExecutor {
  async execute(
    skill: SkillDefinition,
    params: Record<string, any>,
    context: ExecutionContext
  ): Promise<any> {
    const { agentId } = context;
    const gatewayUrl = process.env.GATEWAY_URL || 'http://127.0.0.1:7524';

    switch (skill.skillId) {
      case 'zone_move_to': {
        const { zoneId, reason } = params;
        if (!zoneId) {
          throw new Error('zoneId is required for zone_move_to');
        }

        const response = await fetch(`${gatewayUrl}/api/zones/${zoneId}/members/${agentId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Failed to move to zone: ${response.status} ${error}`);
        }

        const data = await response.json();
        return {
          success: true,
          message: `Successfully moved to zone ${zoneId}`,
          zoneId,
          zoneName: data.zone?.title || data.zone?.name,
          memberCount: data.zone?.members?.length || 1
        };
      }

      case 'zone_leave': {
        const { reason } = params;

        // First get current zone membership
        const listResponse = await fetch(`${gatewayUrl}/api/zones?agentId=${agentId}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        let currentZoneId = null;
        if (listResponse.ok) {
          const listData = await listResponse.json();
          const zones = listData.zones || [];
          for (const zone of zones) {
            if (zone.members && zone.members.includes(agentId)) {
              currentZoneId = zone.id || zone.zoneId;
              break;
            }
          }
        }

        if (!currentZoneId) {
          return {
            success: true,
            message: 'Not currently in any zone',
            alreadyLeft: true
          };
        }

        const response = await fetch(`${gatewayUrl}/api/zones/${currentZoneId}/members/${agentId}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Failed to leave zone: ${response.status} ${error}`);
        }

        return {
          success: true,
          message: `Successfully left zone ${currentZoneId}`,
          previousZoneId: currentZoneId
        };
      }

      case 'zone_list': {
        const response = await fetch(`${gatewayUrl}/api/zones`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
          throw new Error(`Failed to list zones: ${response.status}`);
        }

        const data = await response.json();
        const zones = (data.zones || []).map((zone: any) => ({
          zoneId: zone.id || zone.zoneId,
          name: zone.name || zone.title || 'Unnamed Zone',
          title: zone.title || '',
          prompt: zone.prompt || '',
          agentCount: zone.members?.length || 0,
          status: zone.status
        }));

        return {
          success: true,
          zones,
          total: zones.length
        };
      }

      case 'zone_info': {
        const { zoneId } = params;
        if (!zoneId) {
          throw new Error('zoneId is required for zone_info');
        }

        const response = await fetch(`${gatewayUrl}/api/zones/${zoneId}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
          throw new Error(`Failed to get zone info: ${response.status}`);
        }

        const data = await response.json();
        return {
          success: true,
          zone: data.zone
        };
      }

      default:
        throw new Error(`Unknown zone skill: ${skill.skillId}`);
    }
  }
}

export function createExecutor(type: string): SkillExecutor {
  switch (type) {
    case 'http':
      return new HttpSkillExecutor();
    case 'builtin':
      return new BuiltinSkillExecutor();
    case 'fs':
      return new FileSystemSkillExecutor();
    case 'bash':
      return new BashSkillExecutor();
    case 'code_sandbox':
      return new CodeSandboxSkillExecutor();
    case 'zone':
      return new ZoneSkillExecutor();
    default:
      return new DefaultSkillExecutor();
  }
}
