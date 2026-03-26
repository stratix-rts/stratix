import { SkillDefinition, SkillExecutor, ExecutionContext } from '../types';
import { SafetyValidator } from './SafetyValidator';

export class HttpSkillExecutor implements SkillExecutor {
  async execute(
    skill: SkillDefinition,
    params: Record<string, any>,
    context: ExecutionContext
  ): Promise<any> {
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

    switch (skill.skillId) {
      case 'file_read': {
        const content = await readFile(filePath, params.encoding || 'utf-8');
        return { content, path: filePath };
      }

      case 'file_write': {
        await writeFile(filePath, params.content, params.encoding || 'utf-8');
        return { success: true, path: filePath };
      }

      case 'file_append': {
        await appendFile(filePath, params.content, params.encoding || 'utf-8');
        return { success: true, path: filePath };
      }

      case 'file_list': {
        const files = await readdir(filePath);
        return { files, path: filePath };
      }

      case 'file_delete': {
        await rm(filePath, { recursive: params.recursive || false });
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
          path: filePath 
        };
      }

      default:
        throw new Error(`Unknown file operation: ${skill.skillId}`);
    }
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

    // 验证命令安全性
    const validation = SafetyValidator.validateBashCommand(command, context);
    if (!validation.valid) {
      throw new Error(`Command blocked: ${validation.reason}`);
    }

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
          reject(new Error(`Command failed: ${error.message}\nStderr: ${stderr}`));
          return;
        }
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          success: true
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
    default:
      return new DefaultSkillExecutor();
  }
}
