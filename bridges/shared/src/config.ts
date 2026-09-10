import type { BridgeChannel, BridgeConfig } from './types.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

export function loadBridgeConfig(channel: BridgeChannel): BridgeConfig {
  return {
    channel,
    port: Number(process.env.PORT ?? '8080'),
    zammadUrl: (process.env.ZAMMAD_URL ?? 'http://zammad-web:3000').replace(/\/$/, ''),
    zammadToken: required('ZAMMAD_TOKEN'),
    zammadGroupId: Number(process.env.ZAMMAD_GROUP_ID ?? '1'),
    redisUrl: process.env.REDIS_URL ?? 'redis://redis:6379',
    outboundSecret: required('BRIDGE_OUTBOUND_SECRET'),
    ticketTitlePrefix: process.env.TICKET_TITLE_PREFIX ?? channel.toUpperCase(),
    endClosesTicket: (process.env.BRIDGE_END_CLOSES_TICKET ?? 'true').toLowerCase() !== 'false',
    goodbyeMessage:
      process.env.BRIDGE_GOODBYE_MESSAGE ??
      'Обращение закрыто. Напишите снова, если понадобится помощь.',
  };
}

/** /end, /закрыть, «закрыть обращение» и т.п. */
export function isEndCommand(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/^\//, '');
  return (
    normalized === 'end' ||
    normalized === 'close' ||
    normalized === 'закрыть' ||
    normalized === 'стоп' ||
    normalized.startsWith('end ') ||
    normalized.startsWith('закрыть')
  );
}
