import { SkillDefinition, SkillExecutor, ExecutionContext } from '../types';

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

  async execute(
    skill: SkillDefinition,
    params: Record<string, any>,
    context: ExecutionContext
  ): Promise<any> {
    const { operation, expression } = params;

    if (expression) {
      try {
        const sanitized = expression.replace(/[^0-9+\-*/().\s]/g, '');
        const result = Function(`"use strict"; return (${sanitized})`)();
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

export function createExecutor(type: string): SkillExecutor {
  switch (type) {
    case 'http':
      return new HttpSkillExecutor();
    case 'builtin':
      return new BuiltinSkillExecutor();
    case 'fs':
      return new FileSystemSkillExecutor();
    default:
      return new DefaultSkillExecutor();
  }
}
