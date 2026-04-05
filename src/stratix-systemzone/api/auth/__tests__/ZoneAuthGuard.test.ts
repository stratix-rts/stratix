// ============================================
// ZoneAuthGuard.test.ts - System Zone 认证守卫测试
// Phase 1: Step 6 - API 路由 + 认证
// ============================================

import type { Request, Response, NextFunction } from 'express';

// We test the static methods directly by importing the class
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ZoneAuthGuard } = require('../ZoneAuthGuard');

describe('ZoneAuthGuard', () => {
  // -------------------------------------------------------------------------
  // Helper types & mocks
  // -------------------------------------------------------------------------

  type MockRequest = Partial<Request> & { ownerId?: string; headers?: Record<string, string | string[] | undefined>; params?: Record<string, string | string[]> };
  type MockResponse = Partial<Response> & { statusCode?: number; body?: unknown };
  type MockNext = NextFunction & jest.Mock;

  const mockResponse = (): MockResponse => {
    const res: MockResponse = {};
    res.status = jest.fn((code: number) => { res.statusCode = code; return res; });
    res.json = jest.fn((body: unknown) => { res.body = body; return res; });
    return res;
  };

  const mockNext = (): MockNext => jest.fn() as MockNext;

  // -------------------------------------------------------------------------
  // ZoneAuthGuard.middleware()
  // -------------------------------------------------------------------------

  describe('middleware()', () => {
    it('sets default owner ID when X-Owner-Id header is missing and allowDefault=true', () => {
      const middleware = ZoneAuthGuard.middleware({ required: true, allowDefault: true });
      const req = { headers: {} } as MockRequest;
      const res = mockResponse();
      const next = mockNext();

      middleware(req as Request, res as Response, next);

      expect(req.ownerId).toBe('default-user');
      expect(next).toHaveBeenCalled();
    });

    it('sets default owner ID when required=false and header is missing', () => {
      const middleware = ZoneAuthGuard.middleware({ required: false });
      const req = { headers: {} } as MockRequest;
      const res = mockResponse();
      const next = mockNext();

      middleware(req as Request, res as Response, next);

      expect(req.ownerId).toBe('default-user');
      expect(next).toHaveBeenCalled();
    });

    it('returns 401 when header is missing and allowDefault=false', () => {
      const middleware = ZoneAuthGuard.middleware({ required: true, allowDefault: false });
      const req = { headers: {} } as MockRequest;
      const res = mockResponse();
      const next = mockNext();

      middleware(req as Request, res as Response, next);

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({
        success: false,
        error: 'Missing required header: X-Owner-Id',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 400 when owner ID format is invalid (empty string)', () => {
      const middleware = ZoneAuthGuard.middleware({ required: true, allowDefault: false });
      const req = { headers: { 'x-owner-id': '' } } as MockRequest;
      const res = mockResponse();
      const next = mockNext();

      middleware(req as Request, res as Response, next);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: 'Invalid owner ID format',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 400 when owner ID format is invalid (too long)', () => {
      const middleware = ZoneAuthGuard.middleware({ required: true, allowDefault: false });
      const longId = 'a'.repeat(256);
      const req = { headers: { 'x-owner-id': longId } } as MockRequest;
      const res = mockResponse();
      const next = mockNext();

      middleware(req as Request, res as Response, next);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: 'Invalid owner ID format',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('accepts valid owner ID and sets it on request', () => {
      const middleware = ZoneAuthGuard.middleware({ required: true, allowDefault: false });
      const req = { headers: { 'x-owner-id': 'user-123' } } as MockRequest;
      const res = mockResponse();
      const next = mockNext();

      middleware(req as Request, res as Response, next);

      expect(req.ownerId).toBe('user-123');
      expect(next).toHaveBeenCalled();
    });

    it('accepts owner ID at max length (255 chars)', () => {
      const middleware = ZoneAuthGuard.middleware({ required: true, allowDefault: false });
      const maxId = 'a'.repeat(255);
      const req = { headers: { 'x-owner-id': maxId } } as MockRequest;
      const res = mockResponse();
      const next = mockNext();

      middleware(req as Request, res as Response, next);

      expect(req.ownerId).toBe(maxId);
      expect(next).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // ZoneAuthGuard.zoneOwnerMiddleware()
  // -------------------------------------------------------------------------

  describe('zoneOwnerMiddleware()', () => {
    it('returns 401 when request has no ownerId', async () => {
      const getZoneOwner = jest.fn().mockResolvedValue('owner-1');
      const middleware = ZoneAuthGuard.zoneOwnerMiddleware(getZoneOwner);

      const req = { ownerId: undefined, params: { zoneId: 'zone-1' } } as MockRequest;
      const res = mockResponse();
      const next = jest.fn();

      await middleware(req as Request, res as Response, next);

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({
        success: false,
        error: 'Unauthorized: missing owner ID',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next when no zoneId is present in request', async () => {
      const getZoneOwner = jest.fn().mockResolvedValue('owner-1');
      const middleware = ZoneAuthGuard.zoneOwnerMiddleware(getZoneOwner);

      const req = { ownerId: 'user-1', params: {} } as MockRequest;
      const res = mockResponse();
      const next = jest.fn();

      await middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(getZoneOwner).not.toHaveBeenCalled();
    });

    it('returns 404 when zone is not found', async () => {
      const getZoneOwner = jest.fn().mockResolvedValue(null);
      const middleware = ZoneAuthGuard.zoneOwnerMiddleware(getZoneOwner);

      const req = { ownerId: 'user-1', params: { zoneId: 'zone-1' } } as MockRequest;
      const res = mockResponse();
      const next = jest.fn();

      await middleware(req as Request, res as Response, next);

      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({
        success: false,
        error: 'Zone not found: zone-1',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 403 when user is not the zone owner', async () => {
      const getZoneOwner = jest.fn().mockResolvedValue('owner-1');
      const middleware = ZoneAuthGuard.zoneOwnerMiddleware(getZoneOwner);

      const req = { ownerId: 'user-2', params: { zoneId: 'zone-1' } } as MockRequest;
      const res = mockResponse();
      const next = jest.fn();

      await middleware(req as Request, res as Response, next);

      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({
        success: false,
        error: 'Forbidden: you do not have access to this zone',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next when user is the zone owner', async () => {
      const getZoneOwner = jest.fn().mockResolvedValue('owner-1');
      const middleware = ZoneAuthGuard.zoneOwnerMiddleware(getZoneOwner);

      const req = { ownerId: 'owner-1', params: { zoneId: 'zone-1' } } as MockRequest;
      const res = mockResponse();
      const next = jest.fn();

      await middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
    });

    it('handles zoneId as array (Express params behavior)', async () => {
      const getZoneOwner = jest.fn().mockResolvedValue('owner-1');
      const middleware = ZoneAuthGuard.zoneOwnerMiddleware(getZoneOwner);

      const req = { ownerId: 'owner-1', params: { zoneId: ['zone-1'] } } as MockRequest;
      const res = mockResponse();
      const next = jest.fn();

      await middleware(req as Request, res as Response, next);

      expect(getZoneOwner).toHaveBeenCalledWith('zone-1');
      expect(next).toHaveBeenCalled();
    });

    it('returns 500 when getZoneOwner throws', async () => {
      const getZoneOwner = jest.fn().mockRejectedValue(new Error('DB error'));
      const middleware = ZoneAuthGuard.zoneOwnerMiddleware(getZoneOwner);

      const req = { ownerId: 'user-1', params: { zoneId: 'zone-1' } } as MockRequest;
      const res = mockResponse();
      const next = jest.fn();

      await middleware(req as Request, res as Response, next);

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({
        success: false,
        error: 'Internal server error',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('uses params.id as fallback when params.zoneId is not present', async () => {
      const getZoneOwner = jest.fn().mockResolvedValue('owner-1');
      const middleware = ZoneAuthGuard.zoneOwnerMiddleware(getZoneOwner);

      const req = { ownerId: 'owner-1', params: { id: 'zone-1' } } as MockRequest;
      const res = mockResponse();
      const next = jest.fn();

      await middleware(req as Request, res as Response, next);

      expect(getZoneOwner).toHaveBeenCalledWith('zone-1');
      expect(next).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // ZoneAuthGuard.verifyZoneAccess()
  // -------------------------------------------------------------------------

  describe('verifyZoneAccess()', () => {
    it('returns allowed=true when user is the zone owner', async () => {
      const getZoneOwner = jest.fn().mockResolvedValue('owner-1');

      const result = await ZoneAuthGuard.verifyZoneAccess('zone-1', 'owner-1', getZoneOwner);

      expect(result).toEqual({ allowed: true });
      expect(getZoneOwner).toHaveBeenCalledWith('zone-1');
    });

    it('returns allowed=false with error when zone not found', async () => {
      const getZoneOwner = jest.fn().mockResolvedValue(null);

      const result = await ZoneAuthGuard.verifyZoneAccess('zone-1', 'user-1', getZoneOwner);

      expect(result).toEqual({
        allowed: false,
        error: 'Zone not found: zone-1',
      });
    });

    it('returns allowed=false with error when user is not the owner', async () => {
      const getZoneOwner = jest.fn().mockResolvedValue('owner-1');

      const result = await ZoneAuthGuard.verifyZoneAccess('zone-1', 'user-2', getZoneOwner);

      expect(result).toEqual({
        allowed: false,
        error: 'Forbidden: you do not have access to this zone',
      });
    });

    it('returns allowed=false with error when getZoneOwner throws', async () => {
      const getZoneOwner = jest.fn().mockRejectedValue(new Error('DB error'));

      const result = await ZoneAuthGuard.verifyZoneAccess('zone-1', 'user-1', getZoneOwner);

      expect(result).toEqual({
        allowed: false,
        error: 'Internal server error',
      });
    });
  });
});
