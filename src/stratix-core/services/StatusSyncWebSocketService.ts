/**
 * StatusSync WebSocket Service
 *
 * Connects to the StatusSync WebSocket server and forwards
 * zone-related events to StratixEventBus for RTS consumption.
 */

import StratixEventBus from '../StratixEventBus';

class StatusSyncWebSocketService {
  private ws: WebSocket | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectDelay: number = 3000;
  private maxReconnectDelay: number = 30000;
  private isConnecting: boolean = false;

  private static instance: StatusSyncWebSocketService;

  public static getInstance(): StatusSyncWebSocketService {
    if (!StatusSyncWebSocketService.instance) {
      StatusSyncWebSocketService.instance = new StatusSyncWebSocketService();
    }
    return StatusSyncWebSocketService.instance;
  }

  public connect(): void {
    if (this.ws || this.isConnecting) {
      return;
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = window.location.host;
    const wsUrl = `${wsProtocol}//${wsHost}/ws`;

    console.log('[StatusSyncWS] Connecting to:', wsUrl);
    this.isConnecting = true;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[StatusSyncWS] Connected');
        this.isConnecting = false;
        this.reconnectDelay = 3000;

        // Register as frontend client
        this.ws?.send(JSON.stringify({
          type: 'register',
          clientType: 'frontend'
        }));
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event);
      };

      this.ws.onerror = (error) => {
        console.error('[StatusSyncWS] WebSocket error:', error);
      };

      this.ws.onclose = () => {
        console.log('[StatusSyncWS] Disconnected');
        this.isConnecting = false;
        this.ws = null;
        this.scheduleReconnect();
      };
    } catch (error) {
      console.error('[StatusSyncWS] Failed to connect:', error);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);

      // Forward zone-related events to StratixEventBus
      if (data.eventType === 'stratix:zone_updated' ||
          data.eventType === 'stratix:zone_file_added' ||
          data.eventType === 'stratix:zone_file_removed' ||
          data.eventType === 'stratix:zone_member_joined' ||
          data.eventType === 'stratix:zone_member_left' ||
          data.eventType === 'stratix:zone_deleted' ||
          data.eventType === 'stratix:zone_restored' ||
          data.eventType === 'stratix:zone_task_created' ||
          data.eventType === 'stratix:zone_task_updated' ||
          data.eventType === 'stratix:zone_task_deleted' ||
          data.eventType === 'stratix:zone_task_claimed' ||
          data.eventType === 'stratix:zone_message_added') {

        console.log('[StatusSyncWS] Forwarding zone event to StratixEventBus:', data.eventType);
        StratixEventBus.getInstance().emit({
          eventType: data.eventType,
          payload: data.payload,
          timestamp: data.timestamp || Date.now(),
          requestId: data.requestId || `ws-${Date.now()}`
        });
      }
    } catch (error) {
      console.warn('[StatusSyncWS] Failed to parse message:', error);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectTimeout = setTimeout(() => {
      console.log('[StatusSyncWS] Attempting to reconnect...');
      this.connect();
    }, this.reconnectDelay);

    // Exponential backoff
    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2,
      this.maxReconnectDelay
    );
  }

  public disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

export const statusSyncWS = StatusSyncWebSocketService.getInstance();
export default StatusSyncWebSocketService;
