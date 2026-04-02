/**
 * Stratix 请求帮助器
 * 
 * 生成符合 Stratix 规范的 API 请求/响应对象
 */

import { StratixApiResponse } from '../stratix-protocol';

import StratixIdGenerator from './StratixIdGenerator';

export class StratixRequestHelper {
  private static instance: StratixRequestHelper;
  private idGenerator: StratixIdGenerator;

  private constructor() {
    this.idGenerator = StratixIdGenerator.getInstance();
  }

  public static getInstance(): StratixRequestHelper {
    if (!StratixRequestHelper.instance) {
      StratixRequestHelper.instance = new StratixRequestHelper();
    }
    return StratixRequestHelper.instance;
  }

  /**
   * 生成成功响应
   * @param data 响应数据
   * @param message 响应消息
   */
  public success<T>(data: T, message: string = '操作成功'): StratixApiResponse<T> {
    return {
      code: 200,
      message,
      data,
      requestId: this.idGenerator.generateRequestId(),
    };
  }

  /**
   * 生成错误响应
   * @param code 错误码
   * @param message 错误消息
   */
  public error<T = null>(
    code: number,
    message: string
  ): StratixApiResponse<T> {
    return {
      code,
      message,
      data: null,
      requestId: this.idGenerator.generateRequestId(),
    };
  }

  /**
   * 生成参数错误响应 (400)
   * @param message 错误消息
   */
  public badRequest<T = null>(message: string = '参数错误'): StratixApiResponse<T> {
    return this.error(400, message);
  }

  /**
   * 生成未授权响应 (401)
   * @param message 错误消息
   */
  public unauthorized<T = null>(message: string = '未授权'): StratixApiResponse<T> {
    return this.error(401, message);
  }

  /**
   * 生成禁止访问响应 (403)
   * @param message 错误消息
   */
  public forbidden<T = null>(message: string = '禁止访问'): StratixApiResponse<T> {
    return this.error(403, message);
  }

  /**
   * 生成资源不存在响应 (404)
   * @param message 错误消息
   */
  public notFound<T = null>(message: string = '资源不存在'): StratixApiResponse<T> {
    return this.error(404, message);
  }

  /**
   * 生成服务器错误响应 (500)
   * @param message 错误消息
   */
  public serverError<T = null>(message: string = '服务器内部错误'): StratixApiResponse<T> {
    return this.error(500, message);
  }

  /**
   * 生成服务不可用响应 (503)
   * @param message 错误消息
   */
  public serviceUnavailable<T = null>(message: string = '服务暂不可用'): StratixApiResponse<T> {
    return this.error(503, message);
  }

  /**
   * 判断响应是否成功
   * @param response API 响应
   */
  public isSuccess<T>(response: StratixApiResponse<T>): boolean {
    return response.code === 200;
  }

  /**
   * 判断响应是否为客户端错误 (4xx)
   * @param response API 响应
   */
  public isClientError<T>(response: StratixApiResponse<T>): boolean {
    return response.code >= 400 && response.code < 500;
  }

  /**
   * 判断响应是否为服务端错误 (5xx)
   * @param response API 响应
   */
  public isServerError<T>(response: StratixApiResponse<T>): boolean {
    return response.code >= 500;
  }

  /**
   * 从响应中提取数据（如果成功）
   * @param response API 响应
   * @param defaultValue 默认值
   */
  public extractData<T>(response: StratixApiResponse<T>, defaultValue: T): T {
    return this.isSuccess(response) && response.data !== null ? response.data : defaultValue;
  }

  /**
   * 创建分页响应
   * @param items 数据项
   * @param total 总数
   * @param page 当前页
   * @param pageSize 每页大小
   */
  public paginated<T>(
    items: T[],
    total: number,
    page: number,
    pageSize: number
  ): StratixApiResponse<{ items: T[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const totalPages = Math.ceil(total / pageSize);
    return this.success({
      items,
      total,
      page,
      pageSize,
      totalPages,
    });
  }

  /**
   * 包装异步操作为标准响应
   * @param operation 异步操作
   * @param successMessage 成功消息
   * @param errorMessage 错误消息
   */
  public async wrapAsync<T>(
    operation: () => Promise<T>,
    successMessage: string = '操作成功',
    errorMessage: string = '操作失败'
  ): Promise<StratixApiResponse<T>> {
    try {
      const data = await operation();
      return this.success(data, successMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : errorMessage;
      return this.error(500, message);
    }
  }
}

export default StratixRequestHelper;
