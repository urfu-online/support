import { isEndCommand } from './config.js';
import type { BridgeConfig, InboundMessage } from './types.js';
import type { SessionStore } from './store.js';
import type { ZammadClient } from './zammad.js';

export class InboundTicketService {
  constructor(
    private readonly config: BridgeConfig,
    private readonly zammad: ZammadClient,
    private readonly store: SessionStore,
  ) {}

  async handleEnd(externalChatId: string): Promise<{ ended: boolean; ticketId: number | null }> {
    return this.store.withChatLock(externalChatId, async () => {
      const ticketId = await this.store.unbind(externalChatId);
      if (ticketId && this.config.endClosesTicket) {
        try {
          await this.zammad.closeTicket(ticketId);
        } catch (error) {
          console.error(`[${this.config.channel}] closeTicket failed`, error);
        }
      }
      return { ended: true, ticketId };
    });
  }

  async handleMessage(message: InboundMessage): Promise<{ ticketId: number; created: boolean; ended?: boolean }> {
    const text = (message.text ?? '').trim();
    const attachments = message.attachments ?? [];

    if (text && isEndCommand(text)) {
      const result = await this.handleEnd(message.externalChatId);
      return { ticketId: result.ticketId ?? 0, created: false, ended: true };
    }

    if (!text && attachments.length === 0) {
      return { ticketId: 0, created: false };
    }

    const body =
      text ||
      (attachments.length === 1
        ? `[вложение: ${attachments[0].filename}]`
        : `[вложения: ${attachments.map((a) => a.filename).join(', ')}]`);

    return this.store.withChatLock(message.externalChatId, async () => {
      const preferences = {
        bridge_channel: this.config.channel,
        bridge_external_id: message.externalChatId,
      };

      const existingTicketId = await this.store.getTicketId(message.externalChatId);
      if (existingTicketId) {
        await this.zammad.addCustomerArticle({
          ticketId: existingTicketId,
          body,
          preferences,
          attachments,
        });
        return { ticketId: existingTicketId, created: false };
      }

      const customer = await this.zammad.findOrCreateCustomer(
        message.user.id,
        this.config.channel,
        message.user.name ?? message.user.username,
      );

      const title = `${this.config.ticketTitlePrefix}: ${body}`.slice(0, 200);
      const ticket = await this.zammad.createTicket({
        title,
        groupId: this.config.zammadGroupId,
        customerId: customer.id,
        body,
        preferences,
        attachments,
      });

      await this.store.bind(message.externalChatId, ticket.id);
      return { ticketId: ticket.id, created: true };
    });
  }
}
