/**
 * Handlebars custom helpers for prompt template rendering
 */

import * as Handlebars from 'handlebars';

/**
 * Register all custom helpers with Handlebars instance
 */
export function registerHelpers(handlebars: typeof Handlebars): void {
  // Comparison helpers
  handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  handlebars.registerHelper('ne', (a: unknown, b: unknown) => a !== b);
  handlebars.registerHelper('gt', (a: number, b: number) => a > b);
  handlebars.registerHelper('gte', (a: number, b: number) => a >= b);
  handlebars.registerHelper('lt', (a: number, b: number) => a < b);
  handlebars.registerHelper('lte', (a: number, b: number) => a <= b);

  // Logical helpers
  handlebars.registerHelper('and', (...args: unknown[]): boolean => {
    const values = args.slice(0, -1); // Last arg is HandlebarsOptions
    return values.every(Boolean);
  });

  handlebars.registerHelper('or', (...args: unknown[]): boolean => {
    const values = args.slice(0, -1);
    return values.some((v) => v != null && v !== '');
  });

  // Coalesce helper - returns first non-empty value (for value selection, not conditions)
  handlebars.registerHelper('coalesce', (...args: unknown[]): string => {
    const values = args.slice(0, -1);
    const firstNonEmpty = values.find((v) => v != null && v !== '' && v !== undefined);
    return firstNonEmpty != null ? String(firstNonEmpty) : '';
  });

  handlebars.registerHelper('not', (val: unknown): boolean => !val);

  // String helpers
  handlebars.registerHelper('truncate', (str: unknown, len: number): string => {
    const s = str == null ? '' : String(str);
    if (s.length <= len) return s;
    return s.slice(0, len) + '...';
  });

  handlebars.registerHelper('upper', (str: string | undefined): string => {
    return str?.toUpperCase() || '';
  });

  handlebars.registerHelper('lower', (str: string | undefined): string => {
    return str?.toLowerCase() || '';
  });

  handlebars.registerHelper('capitalize', (str: string | undefined): string => {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  });

  // Array helpers
  handlebars.registerHelper('increment', (n: number): number => n + 1);

  handlebars.registerHelper('empty', (arr: unknown[] | undefined): boolean => {
    return !arr || arr.length === 0;
  });

  handlebars.registerHelper('length', (arr: unknown[] | undefined): number => {
    return arr?.length || 0;
  });

  // Conditional helpers
  handlebars.registerHelper('when', function(this: Handlebars.RuntimeOptions, val: unknown, options: Handlebars.HelperOptions): string {
    if (val) {
      return options.fn(this);
    }
    return options.inverse ? options.inverse(this) : '';
  });

  // Date formatting
  handlebars.registerHelper('date', (format = 'YYYY-MM-DD'): string => {
    const now = new Date();
    if (format === 'YYYY-MM-DD') {
      return now.toISOString().split('T')[0];
    }
    return now.toISOString();
  });

  // JSON stringify (for debugging)
  handlebars.registerHelper('json', (obj: unknown): string => {
    return JSON.stringify(obj, null, 2);
  });

  // Join array elements
  handlebars.registerHelper('join', (arr: string[], separator = ', '): string => {
    return arr?.join(separator) || '';
  });

  // Default value
  handlebars.registerHelper('default', (val: unknown, defaultVal: unknown): unknown => {
    return val ?? defaultVal;
  });
}
