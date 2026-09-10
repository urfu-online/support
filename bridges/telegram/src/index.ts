import { Readable } from 'node:stream';
import nodeFetch, { type RequestInfo, type RequestInit } from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { Bot, type Context, InputFile } from 'grammy';
import {
  createBridgeApp,
  InboundTicketService,
  loadBridgeConfig,
  SessionStore,
  stripHtml,
  ZammadClient,
  type BridgeAttachment,
} from '@support/bridge-shared';

function createProxyAgent(proxyUrl: string): HttpsProxyAgent<string> | SocksProxyAgent {
  if (proxyUrl.startsWith('socks')) {
    return new SocksProxyAgent(proxyUrl);
  }
  return new HttpsProxyAgent(proxyUrl);
}

async function main(): Promise<void> {
  const config = loadBridgeConfig('telegram');
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN');
  }

  const proxy =
    process.env.TELEGRAM_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    '';

  const agent = proxy ? createProxyAgent(proxy) : undefined;
  const proxiedFetch = (url: RequestInfo, init?: RequestInit) =>
    nodeFetch(url, { ...init, agent: agent ?? init?.agent });

  const botConfig: ConstructorParameters<typeof Bot>[1] = {};
  if (agent) {
    botConfig.client = {
      fetch: ((url: unknown, init?: unknown) =>
        proxiedFetch(String(url), init as RequestInit)) as never,
    };
    console.log(`[telegram] using proxy ${proxy.replace(/\/\/.*@/, '//***@')}`);
  } else {
    console.warn('[telegram] no TELEGRAM_PROXY/HTTPS_PROXY set — Bot API must be reachable directly');
  }

  const bot = new Bot(token, botConfig);
  const zammad = new ZammadClient(config.zammadUrl, config.zammadToken);
  const store = new SessionStore(config.redisUrl, config.channel);
  const inbound = new InboundTicketService(config, zammad, store);

  async function downloadTelegramFile(
    fileId: string,
    filename: string,
    mimeType: string,
  ): Promise<BridgeAttachment> {
    const file = await bot.api.getFile(fileId);
    if (!file.file_path) {
      throw new Error('Telegram getFile: empty path');
    }
    const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    const res = await proxiedFetch(url);
    if (!res.ok) {
      throw new Error(`TG file download → ${res.status}`);
    }
    const data = Buffer.from(await res.arrayBuffer());
    return { filename, mimeType, data };
  }

  createBridgeApp({
    config,
    store,
    zammad,
    pathPrefix: process.env.HTTP_PATH_PREFIX ?? '/bridges/telegram',
    sendToMessenger: async (externalChatId, text, attachments) => {
      const chatId = Number(externalChatId);
      const clean = stripHtml(text);
      if (clean) {
        await bot.api.sendMessage(chatId, clean);
      }
      for (const file of attachments ?? []) {
        const input = new InputFile(Readable.from(file.data), file.filename);
        if (file.mimeType.startsWith('image/')) {
          await bot.api.sendPhoto(chatId, input);
        } else if (file.mimeType.startsWith('audio/')) {
          await bot.api.sendAudio(chatId, input);
        } else if (file.mimeType.startsWith('video/')) {
          await bot.api.sendVideo(chatId, input);
        } else {
          await bot.api.sendDocument(chatId, input);
        }
      }
      if (!clean && !(attachments && attachments.length)) {
        await bot.api.sendMessage(chatId, ' ');
      }
    },
  }).listen(config.port, () => {
    console.log(`[telegram] HTTP on :${config.port} (outbound + health); starting long polling`);
  });

  const welcome =
    process.env.TELEGRAM_WELCOME_MESSAGE ??
    'Здравствуйте! Опишите проблему или пришлите файл. /end — закрыть обращение.';

  bot.command('start', async (ctx: Context) => {
    await ctx.reply(welcome);
  });

  bot.on(
    ['message:text', 'message:photo', 'message:document', 'message:audio', 'message:video', 'message:voice'],
    async (ctx: Context) => {
      if (ctx.hasCommand('start')) return;

      const chatId = ctx.chat?.id;
      const from = ctx.from;
      if (!chatId || !from) return;

      const text = ctx.message?.text ?? ctx.message?.caption ?? '';
      const attachments: BridgeAttachment[] = [];

      try {
        if (ctx.message?.photo?.length) {
          const best = ctx.message.photo[ctx.message.photo.length - 1];
          attachments.push(
            await downloadTelegramFile(best.file_id, `photo-${best.file_unique_id}.jpg`, 'image/jpeg'),
          );
        }
        if (ctx.message?.document) {
          const doc = ctx.message.document;
          attachments.push(
            await downloadTelegramFile(
              doc.file_id,
              doc.file_name ?? `document-${doc.file_unique_id}`,
              doc.mime_type ?? 'application/octet-stream',
            ),
          );
        }
        if (ctx.message?.audio) {
          const audio = ctx.message.audio;
          attachments.push(
            await downloadTelegramFile(
              audio.file_id,
              audio.file_name ?? `audio-${audio.file_unique_id}.mp3`,
              audio.mime_type ?? 'audio/mpeg',
            ),
          );
        }
        if (ctx.message?.video) {
          const video = ctx.message.video;
          attachments.push(
            await downloadTelegramFile(
              video.file_id,
              video.file_name ?? `video-${video.file_unique_id}.mp4`,
              video.mime_type ?? 'video/mp4',
            ),
          );
        }
        if (ctx.message?.voice) {
          const voice = ctx.message.voice;
          attachments.push(
            await downloadTelegramFile(
              voice.file_id,
              `voice-${voice.file_unique_id}.ogg`,
              voice.mime_type ?? 'audio/ogg',
            ),
          );
        }
      } catch (error) {
        console.error('[telegram] inbound attachment failed', error);
        await ctx.reply('Не удалось загрузить вложение. Пришлите текст или другой файл.');
        return;
      }

      const result = await inbound.handleMessage({
        externalChatId: String(chatId),
        text,
        user: {
          id: String(from.id),
          name: [from.first_name, from.last_name].filter(Boolean).join(' ') || undefined,
          username: from.username,
        },
        messageId: ctx.message?.message_id ? String(ctx.message.message_id) : undefined,
        attachments,
      });

      if (result.ended) {
        await ctx.reply(config.goodbyeMessage);
      }
    },
  );

  await bot.api.deleteWebhook({ drop_pending_updates: false });

  bot.start({
    onStart: (info) => console.log(`[telegram] polling as @${info.username}`),
  });

  const shutdown = async (signal: string) => {
    console.log(`[telegram] ${signal}, stopping`);
    await bot.stop();
    await store.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
