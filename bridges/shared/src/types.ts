export type BridgeChannel = 'max' | 'vk' | 'telegram';

export interface BridgeConfig {
  channel: BridgeChannel;
  port: number;
  zammadUrl: string;
  zammadToken: string;
  zammadGroupId: number;
  redisUrl: string;
  outboundSecret: string;
  ticketTitlePrefix: string;
  endClosesTicket: boolean;
  goodbyeMessage: string;
}

export interface ExternalUser {
  id: string;
  name?: string;
  username?: string;
}

export interface BridgeAttachment {
  filename: string;
  mimeType: string;
  data: Buffer;
}

export interface InboundMessage {
  externalChatId: string;
  text: string;
  user: ExternalUser;
  messageId?: string;
  attachments?: BridgeAttachment[];
}

export interface OutboundPayload {
  ticket_id?: number;
  ticket?: { id: number };
  article?: {
    id?: number;
    body?: string;
    sender?: string;
    type?: string;
    internal?: boolean;
    preferences?: Record<string, unknown>;
    attachments?: Array<{
      id?: number;
      filename?: string;
      size?: number;
      preferences?: { 'Mime-Type'?: string; mime_type?: string };
    }>;
  };
  [key: string]: unknown;
}

export interface TicketArticlePreferences {
  bridge_channel: BridgeChannel;
  bridge_external_id: string;
}
