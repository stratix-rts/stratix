import type { StratixSkillParameter } from '@/stratix-core/stratix-protocol';

export interface ValidationResult {
  isValid: boolean;
  errorMessage: string;
}

export interface ParamValidateRule {
  paramId: string;
  required?: boolean;
  type?: 'string' | 'number' | 'boolean' | 'object';
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  customValidator?: (value: any) => ValidationResult;
}

/** Extended parameter type with validation properties */
type ValidatedParam = StratixSkillParameter & Partial<Pick<ParamValidateRule, 'min' | 'max' | 'minLength' | 'maxLength' | 'pattern'>>;

export class ParamValidator {
  static validate(param: StratixSkillParameter, value: any): ValidationResult {
    const validatedParam = param as ValidatedParam;

    if (param.required && ParamValidator.isEmpty(value)) {
      return {
        isValid: false,
        errorMessage: `${param.name} 为必填项`
      };
    }

    if (!param.required && ParamValidator.isEmpty(value)) {
      return { isValid: true, errorMessage: '' };
    }

    switch (param.type) {
      case 'string':
        return ParamValidator.validateString(validatedParam, value);
      case 'number':
        return ParamValidator.validateNumber(validatedParam, value);
      case 'boolean':
        return ParamValidator.validateBoolean(value);
      case 'object':
        return ParamValidator.validateObject(value);
      default:
        return { isValid: true, errorMessage: '' };
    }
  }

  private static isEmpty(value: any): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string' && value.trim() === '') return true;
    return false;
  }

  private static validateString(param: ValidatedParam, value: any): ValidationResult {
    if (typeof value !== 'string') {
      return {
        isValid: false,
        errorMessage: `${param.name} 必须为文本类型`
      };
    }

    if (param.minLength !== undefined && value.length < param.minLength) {
      return {
        isValid: false,
        errorMessage: `${param.name} 不能少于 ${param.minLength} 个字符`
      };
    }

    if (param.maxLength !== undefined && value.length > param.maxLength) {
      return {
        isValid: false,
        errorMessage: `${param.name} 不能超过 ${param.maxLength} 个字符`
      };
    }

    if (param.pattern !== undefined && !param.pattern.test(value)) {
      return {
        isValid: false,
        errorMessage: `${param.name} 格式不正确`
      };
    }

    return { isValid: true, errorMessage: '' };
  }

  private static validateNumber(param: ValidatedParam, value: any): ValidationResult {
    const numValue = typeof value === 'string' ? parseFloat(value) : value;

    if (isNaN(numValue)) {
      return {
        isValid: false,
        errorMessage: `${param.name} 必须为有效数字`
      };
    }

    if (param.min !== undefined && numValue < param.min) {
      return {
        isValid: false,
        errorMessage: `${param.name} 不能小于 ${param.min}`
      };
    }

    if (param.max !== undefined && numValue > param.max) {
      return {
        isValid: false,
        errorMessage: `${param.name} 不能大于 ${param.max}`
      };
    }

    return { isValid: true, errorMessage: '' };
  }

  private static validateBoolean(value: any): ValidationResult {
    if (typeof value !== 'boolean' && value !== 'true' && value !== 'false' && value !== 1 && value !== 0) {
      return {
        isValid: false,
        errorMessage: '必须为布尔值'
      };
    }
    return { isValid: true, errorMessage: '' };
  }

  private static validateObject(value: any): ValidationResult {
    if (typeof value !== 'object' || Array.isArray(value)) {
      return {
        isValid: false,
        errorMessage: '必须为对象类型'
      };
    }
    return { isValid: true, errorMessage: '' };
  }

  static validateAll(
    params: StratixSkillParameter[],
    values: Record<string, any>
  ): { isValid: boolean; errors: Record<string, string> } {
    const errors: Record<string, string> = {};
    let isValid = true;

    for (const param of params) {
      const value = values[param.paramId];
      const result = this.validate(param, value);
      
      if (!result.isValid) {
        isValid = false;
        errors[param.paramId] = result.errorMessage;
      }
    }

    return { isValid, errors };
  }

  static getDefaultValue(param: StratixSkillParameter): any {
    if (param.defaultValue !== undefined && param.defaultValue !== null) {
      return param.defaultValue;
    }

    switch (param.type) {
      case 'string':
        return '';
      case 'number':
        return 0;
      case 'boolean':
        return false;
      case 'object':
        return {};
      default:
        return null;
    }
  }

  static initializeFormValues(params: StratixSkillParameter[]): Record<string, any> {
    const values: Record<string, any> = {};
    for (const param of params) {
      values[param.paramId] = this.getDefaultValue(param);
    }
    return values;
  }
}

export default ParamValidator;
