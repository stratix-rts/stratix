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
 * Code Sandbox Executor
 * Executes JavaScript using eval() in isolation
 * Executes Python using child_process with timeout
 */
export class CodeSandboxSkillExecutor implements SkillExecutor {
  async execute(
    skill: SkillDefinition,
    params: Record<string, any>,
    context: ExecutionContext
  ): Promise<any> {
    const { code, language } = params;
    const progress = context.progressCallback;

    progress?.({ skillId: skill.skillId, stage: 'started', message: `Executing ${language}...` });

    if (language === 'javascript') {
      return this.executeJavaScript(code, progress);
    } else if (language === 'python') {
      return this.executePython(code, progress);
    } else {
      throw new Error(`Unsupported language: ${language}. Supported: javascript, python`);
    }
  }

  private executeJavaScript(code: string, progress?: (p: any) => void): Promise<any> {
    return new Promise((resolve, reject) => {
      try {
        // Capture console.log output
        const logs: string[] = [];
        const mockConsole = {
          log: (...args: any[]) => logs.push(args.map(String).join(' ')),
          error: (...args: any[]) => logs.push('[error] ' + args.map(String).join(' ')),
          warn: (...args: any[]) => logs.push('[warn] ' + args.map(String).join(' ')),
          info: (...args: any[]) => logs.push('[info] ' + args.map(String).join(' ')),
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
          Map,
          Set,
          Promise,
          parseInt,
          parseFloat,
          isNaN,
          isFinite,
          encodeURIComponent,
          decodeURIComponent,
        };

        const sandboxKeys = Object.keys(sandbox);
        const sandboxValues = Object.values(sandbox);

        // Execute in isolated context
        const fn = new Function(...sandboxKeys, code);
        const result = fn(...sandboxValues);

        // Handle async results
        if (result instanceof Promise) {
          result
            .then((asyncResult) => {
              progress?.({ skillId: 'code_execute', stage: 'completed' });
              resolve({
                result: asyncResult,
                logs,
                success: true,
                preview: { type: 'code', content: logs.length > 0 ? logs.join('\n') : String(asyncResult).slice(0, 500) }
              });
            })
            .catch((err) => {
              progress?.({ skillId: 'code_execute', stage: 'failed' });
              reject(new Error(`Execution error: ${err.message}`));
            });
        } else {
          progress?.({ skillId: 'code_execute', stage: 'completed' });
          resolve({
            result,
            logs,
            success: true,
            preview: { type: 'code', content: logs.length > 0 ? logs.join('\n') : String(result).slice(0, 500) }
          });
        }
      } catch (error) {
        progress?.({ skillId: 'code_execute', stage: 'failed' });
        reject(new Error(`JavaScript execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
      }
    });
  }

  private executePython(code: string, progress?: (p: any) => void): Promise<any> {
    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process');
      const { writeFile, unlink } = require('fs/promises');
      const { join } = require('path');
      const os = require('os');

      // Write code to temp file
      const tempFile = join(os.tmpdir(), `stratix_sandbox_${Date.now()}.py`);

      (async () => {
        try {
          await writeFile(tempFile, code);
          progress?.({ skillId: 'code_execute', stage: 'processing', message: 'Running Python...' });

          const proc = spawn('python3', [tempFile], {
            timeout: 10000, // 10 second timeout
            maxBuffer: 1024 * 1024, // 1MB output
          });

          let stdout = '';
          let stderr = '';

          proc.stdout.on('data', (data: Buffer) => {
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
              resolve({
                result: stdout.trim(),
                logs: [],
                success: true,
                preview: { type: 'code', content: stdout.trim().slice(0, 500) }
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
    default:
      return new DefaultSkillExecutor();
  }
}
