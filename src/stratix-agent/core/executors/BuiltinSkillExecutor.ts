import { SkillDefinition, SkillExecutor, ExecutionContext } from '../../types';

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
        const parsed = parseFloat(num);
        if (Number.isNaN(parsed)) throw new Error(`Invalid number: ${num}`);
        tokens.push(parsed);
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
    params: Record<string, unknown>,
    _context: ExecutionContext
  ): Promise<any> {
    const operation = typeof params.operation === 'string' ? params.operation : undefined;
    const expression = typeof params.expression === 'string' ? params.expression : undefined;

    if (expression) {
      try {
        const result = this.evaluateExpression(expression);
        return { result };
      } catch (error) {
        throw new Error(`Expression evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (operation && this.calculators[operation as keyof typeof this.calculators]) {
      const op = operation as keyof typeof this.calculators;
      if (op === 'sqrt' || op === 'abs' || op === 'round' || op === 'floor' || op === 'ceil') {
        const operand = typeof params.a === 'number' ? params.a : (typeof params.value === 'number' ? params.value : NaN);
        if (Number.isNaN(operand)) throw new Error(`Invalid operand for ${op}`);
        return { result: this.calculators[op](operand), operation };
      }
      const a = typeof params.a === 'number' ? params.a : NaN;
      const b = typeof params.b === 'number' ? params.b : NaN;
      if (Number.isNaN(a) || Number.isNaN(b)) throw new Error(`Invalid operands for ${op}`);
      return { result: this.calculators[op](a, b), operation };
    }

    throw new Error('No operation or expression provided');
  }
}
