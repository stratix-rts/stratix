import * as http from 'http';
import * as https from 'https';

import { Router, Request, Response } from 'express';
import { WebSocket, WebSocketServer } from 'ws';

import { StratixRequestHelper } from '../../../stratix-core/utils';
import { OpenClawConnectionStore } from '../../../stratix-data-store/OpenClawConnectionStore';
import type { OpenClawConnectionRecord, ConnectionPoolStatus } from '../../../stratix-data-store/types';
import { openClawConnectionManager } from '../../openclaw/OpenClawConnectionManager';
import { openClawProxyManager } from '../../openclaw/OpenClawProxyManager';


const router = Router();
const requestHelper = StratixRequestHelper.getInstance();
let connectionStore: OpenClawConnectionStore | null = null;

interface ProxyConfig {
  endpoint: string;
  apiKey?: string;
}

const activeProxies = new Map<string, ProxyConfig>();
let wss: WebSocketServer | null = null;

function getProxyKey(endpoint: string): string {
  return endpoint.replace(/[^a-zA-Z0-9]/g, '_');
}

router.post('/connect', async (req: Request, res: Response) => {
  try {
    const { endpoint, apiKey } = req.body;
    
    if (!endpoint) {
      res.status(400).json(requestHelper.badRequest('endpoint is required'));
      return;
    }

    const proxyKey = getProxyKey(endpoint);
    activeProxies.set(proxyKey, { endpoint, apiKey });

    res.json(requestHelper.success({ 
      endpoint, 
      connected: true,
      proxyKey
    }, 'OpenClaw connection configured'));
  } catch {
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.post('/ws-connect', async (req: Request, res: Response) => {
  try {
    const { endpoint, accountId, apiKey } = req.body;
    
    if (!endpoint) {
      res.status(400).json(requestHelper.badRequest('endpoint is required'));
      return;
    }

    const result = await openClawConnectionManager.testConnection({
      endpoint,
      accountId: accountId || 'stratix',
      apiKey,
    });

    if (result.success) {
      res.json(requestHelper.success({
        endpoint,
        connected: true,
        deviceId: result.deviceId,
      }, result.message));
    } else {
      res.json(requestHelper.error(502, result.error || result.message));
    }
  } catch (error) {
    const err = error as Error;
    res.status(500).json(requestHelper.serverError(err.message));
  }
});

router.get('/test', async (req: Request, res: Response) => {
  try {
    const endpoint = req.query.endpoint as string;
    const apiKey = req.query.apiKey as string | undefined;
    
    if (!endpoint) {
      res.status(400).json(requestHelper.badRequest('endpoint is required'));
      return;
    }

    const headers: Record<string, string> = {};
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        res.json(requestHelper.success({ 
          endpoint, 
          connected: true,
          status: response.status 
        }, 'OpenClaw connection successful'));
      } else {
        res.json(requestHelper.error(response.status, `OpenClaw returned status ${response.status}`));
      }
    } catch (fetchError) {
      clearTimeout(timeoutId);
      throw fetchError;
    }
  } catch (error) {
    const err = error as Error;
    res.json(requestHelper.error(502, `Connection failed: ${err.message}`));
  }
});

router.use('/proxy/:proxyKey', (req: Request, res: Response) => {
  const proxyKey = String(req.params.proxyKey);
  const config = activeProxies.get(proxyKey);
  
  if (!config) {
    res.status(404).json(requestHelper.notFound('OpenClaw connection not found. Call /connect first.'));
    return;
  }

  const baseUrl = `/api/stratix/openclaw/proxy/${proxyKey}`;
  const pathAfterProxy = req.originalUrl.slice(req.originalUrl.indexOf(baseUrl) + baseUrl.length) || '/';
  const targetUrl = `${config.endpoint}${pathAfterProxy}`;
  const urlObj = new URL(targetUrl);
  
  const isHttps = urlObj.protocol === 'https:';
  const httpModule = isHttps ? https : http;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Host': urlObj.host,
  };
  
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }
  
  const agentId = req.headers['x-openclaw-agent-id'];
  if (agentId) {
    headers['x-openclaw-agent-id'] = Array.isArray(agentId) ? agentId[0] : agentId;
  }

  const bodyData = ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body);

  const options: http.RequestOptions = {
    hostname: urlObj.hostname,
    port: urlObj.port || (isHttps ? 443 : 80),
    path: urlObj.pathname + urlObj.search,
    method: req.method,
    headers,
    timeout: 60000,
  };

  const proxyReq = httpModule.request(options, (proxyRes) => {
    res.status(proxyRes.statusCode || 502);
    
    const contentType = proxyRes.headers['content-type'];
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('[OpenClaw Proxy] Error:', err.message);
    if (!res.headersSent) {
      res.status(502).json(requestHelper.error(502, `OpenClaw connection failed: ${err.message}`));
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.status(504).json(requestHelper.error(504, 'OpenClaw request timeout'));
    }
  });

  if (bodyData) {
    proxyReq.write(bodyData);
  }
  
  proxyReq.end();
});

router.post('/disconnect', async (req: Request, res: Response) => {
  try {
    const { endpoint } = req.body;
    
    if (!endpoint) {
      res.status(400).json(requestHelper.badRequest('endpoint is required'));
      return;
    }

    const proxyKey = getProxyKey(endpoint);
    activeProxies.delete(proxyKey);

    res.json(requestHelper.success({ endpoint }, 'OpenClaw connection removed'));
  } catch {
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.get('/connections', async (_req: Request, res: Response) => {
  try {
    const connections = Array.from(activeProxies.entries()).map(([key, config]) => ({
      proxyKey: key,
      endpoint: config.endpoint
    }));
    res.json(requestHelper.success(connections, 'Active connections'));
  } catch {
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.get('/tailscale/nodes', async (_req: Request, res: Response) => {
  try {
    const response = await fetch('http://127.0.0.1:4243/localapi/v0/machines', {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      res.json(requestHelper.success([], 'Tailscale not available or not running'));
      return;
    }

    const data = await response.json() as Array<{
      ID?: string;
      NodeId?: string;
      Name?: string;
      HostName?: string;
      IPAddresses?: string[];
      TailscaleIPs?: string[];
      Online?: boolean;
      Latency?: unknown;
    }>;
    
    const nodes = data.map((machine) => ({
      nodeId: machine.ID || machine.NodeId,
      name: machine.Name || machine.HostName,
      ipAddress: machine.IPAddresses?.[0] || machine.TailscaleIPs?.[0],
      online: machine.Online ?? true,
      latency: machine.Latency
    }));

    res.json(requestHelper.success(nodes, 'Tailscale nodes discovered'));
  } catch (error) {
    console.warn('[OpenClaw] Failed to discover Tailscale nodes:', error);
    res.json(requestHelper.success([], 'Tailscale discovery failed - ensure Tailscale is running'));
  }
});

export function initConnectionStore(store: OpenClawConnectionStore): void {
  connectionStore = store;
  connectionStore.startWatching();
  
  openClawProxyManager.onDeviceToken(async (connectionId, deviceToken) => {
    try {
      if (connectionStore) {
        await connectionStore.updateDeviceToken(connectionId, deviceToken);
      }
    } catch (error) {
      console.error('[OpenClaw] Failed to update device token:', error);
    }
  });
}

router.get('/connections/list', async (_req: Request, res: Response) => {
  try {
    if (!connectionStore) {
      res.status(503).json(requestHelper.error(503, 'Connection store not initialized'));
      return;
    }
    
    const connections = await connectionStore.list();
    const statuses = openClawProxyManager.getAllStatuses();
    
    const statusMap = new Map(statuses.map(s => [s.connectionId, s]));
    
    const result = connections.map(conn => ({
      ...conn,
      status: statusMap.get(conn.id)?.status || 'disconnected',
      clientCount: statusMap.get(conn.id)?.clientCount || 0,
      latency: statusMap.get(conn.id)?.latency,
    }));
    
    res.json(requestHelper.success(result, 'Connections fetched'));
  } catch (error) {
    console.error('[OpenClaw] Error listing connections:', error);
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.get('/connections/:id', async (req: Request, res: Response) => {
  try {
    if (!connectionStore) {
      res.status(503).json(requestHelper.error(503, 'Connection store not initialized'));
      return;
    }
    
    const { id } = req.params;
    const connectionId = Array.isArray(id) ? id[0] : id;
    const connection = await connectionStore.get(connectionId);
    
    if (!connection) {
      res.json(requestHelper.notFound('Connection not found'));
      return;
    }
    
    const status = openClawProxyManager.getStatus(connectionId);
    
    res.json(requestHelper.success({
      ...connection,
      status: status?.status || 'disconnected',
      clientCount: status?.clientCount || 0,
      latency: status?.latency,
    }, 'Connection fetched'));
  } catch (error) {
    console.error('[OpenClaw] Error getting connection:', error);
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.post('/connections/check', async (req: Request, res: Response) => {
  try {
    if (!connectionStore) {
      res.status(503).json(requestHelper.error(503, 'Connection store not initialized'));
      return;
    }
    
    const { endpoint } = req.body;
    
    if (!endpoint) {
      res.status(400).json(requestHelper.badRequest('endpoint is required'));
      return;
    }
    
    const result = await connectionStore.checkEndpointExists(endpoint);
    
    if (result.exists && result.connection) {
      const status = openClawProxyManager.getStatus(result.connection.id);
      res.json(requestHelper.success({
        exists: true,
        connection: {
          ...result.connection,
          status: status?.status || 'disconnected',
        },
      }, 'Connection already exists'));
    } else {
      res.json(requestHelper.success({ exists: false }, 'Endpoint not found'));
    }
  } catch (error) {
    console.error('[OpenClaw] Error checking endpoint:', error);
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.post('/connections', async (req: Request, res: Response) => {
  try {
    if (!connectionStore) {
      res.status(503).json(requestHelper.error(503, 'Connection store not initialized'));
      return;
    }
    
    const { name, method, endpoint, sharedToken, deviceToken, deviceId } = req.body;
    
    if (!endpoint || !method) {
      res.status(400).json(requestHelper.badRequest('endpoint and method are required'));
      return;
    }
    
    if (method !== 'pairing' && method !== 'tailscale') {
      res.status(400).json(requestHelper.badRequest('method must be "pairing" or "tailscale"'));
      return;
    }
    
    const existing = await connectionStore.findByEndpoint(endpoint);
    if (existing) {
      res.status(409).json(requestHelper.error(409, 'Connection with this endpoint already exists'));
      return;
    }
    
    const connection = await connectionStore.create({
      name: name || extractNameFromEndpoint(endpoint),
      method,
      endpoint,
      sharedToken,
      deviceToken,
      deviceId,
    });
    
    res.json(requestHelper.success(connection, 'Connection created'));
  } catch (error) {
    console.error('[OpenClaw] Error creating connection:', error);
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.put('/connections/:id', async (req: Request, res: Response) => {
  try {
    if (!connectionStore) {
      res.status(503).json(requestHelper.error(503, 'Connection store not initialized'));
      return;
    }
    
    const { id } = req.params;
    const connectionId = Array.isArray(id) ? id[0] : id;
    const updates = req.body;
    
    delete updates.id;
    delete updates.createdAt;
    
    const connection = await connectionStore.update(connectionId, updates);
    
    if (!connection) {
      res.json(requestHelper.notFound('Connection not found'));
      return;
    }
    
    res.json(requestHelper.success(connection, 'Connection updated'));
  } catch (error) {
    console.error('[OpenClaw] Error updating connection:', error);
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.delete('/connections/:id', async (req: Request, res: Response) => {
  try {
    if (!connectionStore) {
      res.status(503).json(requestHelper.error(503, 'Connection store not initialized'));
      return;
    }
    
    const { id } = req.params;
    const connectionId = Array.isArray(id) ? id[0] : id;
    
    openClawProxyManager.remove(connectionId);
    
    const deleted = await connectionStore.delete(connectionId);
    
    if (!deleted) {
      res.json(requestHelper.notFound('Connection not found'));
      return;
    }
    
    res.json(requestHelper.success(null, 'Connection deleted'));
  } catch (error) {
    console.error('[OpenClaw] Error deleting connection:', error);
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.post('/connections/:id/connect', async (req: Request, res: Response) => {
  try {
    if (!connectionStore) {
      res.status(503).json(requestHelper.error(503, 'Connection store not initialized'));
      return;
    }
    
    const { id } = req.params;
    const connectionId = Array.isArray(id) ? id[0] : id;
    const connection = await connectionStore.get(connectionId);
    
    if (!connection) {
      res.json(requestHelper.notFound('Connection not found'));
      return;
    }
    
    const result = await openClawProxyManager.connect(connection);
    
    if (result.success) {
      res.json(requestHelper.success({
        connectionId,
        status: 'connected',
      }, 'Connected successfully'));
    } else {
      res.json(requestHelper.error(502, result.error || 'Connection failed'));
    }
  } catch (error) {
    console.error('[OpenClaw] Error connecting:', error);
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.post('/connections/:id/disconnect', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const connectionId = Array.isArray(id) ? id[0] : id;
    
    await openClawProxyManager.disconnect(connectionId);
    
    res.json(requestHelper.success({
      connectionId,
      status: 'disconnected',
    }, 'Disconnected'));
  } catch (error) {
    console.error('[OpenClaw] Error disconnecting:', error);
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.get('/status', async (_req: Request, res: Response) => {
  try {
    const statuses = openClawProxyManager.getAllStatuses();
    res.json(requestHelper.success(statuses, 'Connection statuses'));
  } catch (error) {
    console.error('[OpenClaw] Error getting statuses:', error);
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

router.get('/status/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const connectionId = Array.isArray(id) ? id[0] : id;
    const status = openClawProxyManager.getStatus(connectionId);
    
    if (!status) {
      res.json(requestHelper.notFound('Connection status not found'));
      return;
    }
    
    res.json(requestHelper.success(status, 'Connection status'));
  } catch (error) {
    console.error('[OpenClaw] Error getting status:', error);
    res.status(500).json(requestHelper.serverError('Internal server error'));
  }
});

function extractNameFromEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint.replace(/^ws/, 'http'));
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
      return '本地连接';
    }
    if (url.hostname.includes('.ts.net') || url.hostname.includes('.tailscale')) {
      return url.hostname.split('.')[0];
    }
    return url.hostname;
  } catch {
    return '自定义连接';
  }
}

let connectionStoreWss: WebSocketServer | null = null;

export function initWebSocketServer(server: http.Server) {
  wss = new WebSocketServer({ noServer: true });
  connectionStoreWss = new WebSocketServer({ noServer: true });
  
  wss.on('connection', (clientWs: WebSocket, req: http.IncomingMessage, proxyKey: string, targetPath: string) => {
    const config = activeProxies.get(proxyKey);
    
    if (!config) {
      clientWs.close(1008, 'Proxy not found');
      return;
    }
    
    const targetUrl = `${config.endpoint}${targetPath}`;
    const urlObj = new URL(targetUrl);
    const wsProtocol = urlObj.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${urlObj.host}${urlObj.pathname}${urlObj.search}`;
    
    console.log('[WS Proxy] Connecting to:', wsUrl);
    
    const targetWs = new WebSocket(wsUrl, {
      headers: {
        'Host': urlObj.host,
        ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {}),
      },
    });
    
    targetWs.on('open', () => {
      console.log('[WS Proxy] Connected to target');
    });
    
    targetWs.on('message', (data: Buffer, isBinary: boolean) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data, { binary: isBinary });
      }
    });
    
    targetWs.on('close', (code: number, reason: Buffer) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(code, reason);
      }
    });
    
    targetWs.on('error', (err: Error) => {
      console.error('[WS Proxy] Target error:', err.message);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(1011, 'Target connection error');
      }
    });
    
    clientWs.on('message', (data: Buffer, isBinary: boolean) => {
      if (targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(data, { binary: isBinary });
      }
    });
    
    clientWs.on('close', () => {
      if (targetWs.readyState === WebSocket.OPEN) {
        targetWs.close();
      }
    });
    
    clientWs.on('error', (err: Error) => {
      console.error('[WS Proxy] Client error:', err.message);
      if (targetWs.readyState === WebSocket.OPEN) {
        targetWs.close();
      }
    });
  });

  connectionStoreWss.on('connection', async (clientWs: WebSocket, req: http.IncomingMessage, connectionId: string) => {
    console.log('[WS Proxy] Client connected to:', connectionId);
    
    if (!connectionStore) {
      clientWs.close(1011, 'Connection store not initialized');
      return;
    }
    
    const connection = await connectionStore.get(connectionId);
    if (!connection) {
      clientWs.close(1008, 'Connection not found');
      return;
    }
    
    const isConnected = openClawProxyManager.isConnected(connectionId);
    if (!isConnected) {
      const result = await openClawProxyManager.connect(connection);
      if (!result.success) {
        clientWs.close(1011, result.error || 'Failed to connect');
        return;
      }
    }
    
    const attached = openClawProxyManager.attachClient(connectionId, clientWs);
    if (!attached) {
      clientWs.close(1011, 'Failed to attach to connection');
      return;
    }
    
    console.log('[WS Proxy] Client attached to connection:', connectionId);
  });
  
  server.on('upgrade', (req: http.IncomingMessage, socket: any, head: Buffer) => {
    const url = req.url || '';
    
    const connectionMatch = url.match(/\/api\/stratix\/openclaw\/ws-proxy\/([^\/]+)$/);
    if (connectionMatch && connectionStoreWss) {
      const connectionId = connectionMatch[1];
      console.log('[WS Proxy] Upgrade request for connection:', connectionId);
      
      connectionStoreWss.handleUpgrade(req, socket, head, (clientWs) => {
        connectionStoreWss!.emit('connection', clientWs, req, connectionId);
      });
      return;
    }
    
    const proxyMatch = url.match(/\/api\/stratix\/openclaw\/proxy\/([^\/]+)(\/.*)?$/);
    if (proxyMatch && wss) {
      const proxyKey = proxyMatch[1];
      const targetPath = proxyMatch[2] || '/';
      
      console.log('[WS Proxy] Upgrade request for proxy:', proxyKey);
      
      wss.handleUpgrade(req, socket, head, (clientWs) => {
        wss!.emit('connection', clientWs, req, proxyKey, targetPath);
      });
      return;
    }
  });
}

export default router;
