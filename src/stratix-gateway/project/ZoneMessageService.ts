import { zoneRepository } from '../../stratix-database/ZoneRepository';
import { Zone, ZoneMessage } from '../../stratix-project/types';
import { gatewayEventBus } from '../GatewayEventBus';

export class ZoneMessageService {
  constructor(
    private checkPermission: (action: string, resource: string, agentId: string) => void,
    private ensureInitialized: () => Promise<void>
  ) {}

  public async getMessages(zoneId: string, limit: number = 100, offset: number = 0): Promise<ZoneMessage[]> {
    await this.ensureInitialized();
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }
    return zoneRepository.getMessages(zoneId, limit, offset);
  }

  public async getMessagesCount(zoneId: string): Promise<number> {
    await this.ensureInitialized();
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }
    return zoneRepository.getMessagesCount(zoneId);
  }

  public async addMessage(zoneId: string, senderId: string, senderType: 'user' | 'agent', content: string): Promise<ZoneMessage> {
    await this.ensureInitialized();

    this.checkPermission('add_message', `zone:${zoneId}`, senderId);

    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    if (!content || content.trim().length === 0) {
      throw new Error('Message content cannot be empty');
    }

    if (content.length > 10000) {
      throw new Error('Message content exceeds maximum length of 10000 characters');
    }

    const message = zoneRepository.addMessage(zoneId, senderId, senderType, content.trim());

    gatewayEventBus.publishZoneEvent('zone:message_added', zoneId, {
      message
    });

    return message;
  }
}
