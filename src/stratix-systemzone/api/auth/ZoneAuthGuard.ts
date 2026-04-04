// ============================================
// ZoneAuthGuard - System Zone 认证守卫
// Phase 1: Step 6 - API 路由 + 认证
// ============================================

import type { Request, Response, NextFunction } from 'express';

// Owner ID header name
const OWNER_ID_HEADER = 'x-owner-id';

// Default owner ID for development/single-user mode
const DEFAULT_OWNER_ID = 'default-user';

// ------------------------------------------------
// 扩展 Express Request 类型
// ------------------------------------------------

declare global {
  namespace Express {
    interface Request {
      ownerId?: string;
    }
  }
}

// ------------------------------------------------
// ZoneAuthGuard 类
// ------------------------------------------------

/**
 * System Zone 认证守卫
 *
 * 验证请求中的 owner_id 与当前用户匹配
 * 复用 Gateway 现有认证中间件模式（header-based）
 *
 * 在 Embedded/单机模式下，使用 X-Owner-Id header
 * 多用户模式下可扩展为 JWT/session 验证
 */
export class ZoneAuthGuard {
  /**
   * 创建认证中间件
   * @param options 配置选项
   */
  static middleware(options: {
    required?: boolean;
    allowDefault?: boolean;
  } = {}): (req: Request, res: Response, next: NextFunction) => void {
    const { required = true, allowDefault = true } = options;

    return (req: Request, res: Response, next: NextFunction): void => {
      const ownerId = req.headers[OWNER_ID_HEADER] as string | undefined;

      if (!ownerId) {
        if (required) {
          if (allowDefault) {
            // Use default owner for single-user mode
            req.ownerId = DEFAULT_OWNER_ID;
            next();
          } else {
            res.status(401).json({
              success: false,
              error: 'Missing required header: X-Owner-Id',
            });
          }
        } else {
          // Owner ID is optional
          req.ownerId = DEFAULT_OWNER_ID;
          next();
        }
        return;
      }

      // Validate owner ID format (basic validation)
      if (!this.isValidOwnerId(ownerId)) {
        res.status(400).json({
          success: false,
          error: 'Invalid owner ID format',
        });
        return;
      }

      req.ownerId = ownerId;
      next();
    };
  }

  /**
   * 验证 owner ID 格式
   */
  private static isValidOwnerId(ownerId: string): boolean {
    // Basic validation: non-empty string, max 255 chars
    return typeof ownerId === 'string' && ownerId.length > 0 && ownerId.length <= 255;
  }

  /**
   * 创建 zone owner 验证中间件
   * 验证请求中的 owner_id 是否与目标 zone 的 owner 匹配
   */
  static zoneOwnerMiddleware(
    getZoneOwner: (zoneId: string) => Promise<string | null>
  ): (req: Request, res: Response, next: NextFunction) => Promise<void> {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const requestOwnerId = req.ownerId;
      const zoneId = req.params.zoneId || req.params.id;

      if (!requestOwnerId) {
        res.status(401).json({
          success: false,
          error: 'Unauthorized: missing owner ID',
        });
        return;
      }

      if (!zoneId) {
        // No zone ID in request, skip zone owner check
        next();
        return;
      }

      // Handle string | string[] type from Express params
      const zoneIdStr = Array.isArray(zoneId) ? zoneId[0] : zoneId;

      if (!zoneIdStr) {
        next();
        return;
      }

      try {
        const zoneOwnerId = await getZoneOwner(zoneIdStr);

        if (!zoneOwnerId) {
          res.status(404).json({
            success: false,
            error: `Zone not found: ${zoneId}`,
          });
          return;
        }

        if (zoneOwnerId !== requestOwnerId) {
          res.status(403).json({
            success: false,
            error: 'Forbidden: you do not have access to this zone',
          });
          return;
        }

        next();
      } catch (error) {
        console.error('[ZoneAuthGuard] Error verifying zone owner:', error);
        res.status(500).json({
          success: false,
          error: 'Internal server error',
        });
      }
    };
  }

  /**
   * 验证用户是否为 zone owner
   */
  static async verifyZoneAccess(
    zoneId: string,
    requestOwnerId: string,
    getZoneOwner: (zoneId: string) => Promise<string | null>
  ): Promise<{ allowed: boolean; error?: string }> {
    try {
      const zoneOwnerId = await getZoneOwner(zoneId);

      if (!zoneOwnerId) {
        return { allowed: false, error: `Zone not found: ${zoneId}` };
      }

      if (zoneOwnerId !== requestOwnerId) {
        return { allowed: false, error: 'Forbidden: you do not have access to this zone' };
      }

      return { allowed: true };
    } catch (error) {
      console.error('[ZoneAuthGuard] Error verifying zone access:', error);
      return { allowed: false, error: 'Internal server error' };
    }
  }
}

// Export singleton instance for convenience
export const zoneAuthGuard = new ZoneAuthGuard();