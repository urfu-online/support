import express from 'express';
import {
  createBridgeApp,
  downloadUrl,
  InboundTicketService,
  loadBridgeConfig,
  SessionStore,
  stripHtml,
  ZammadClient,
  type BridgeAttachment,
} from '@support/bridge-shared';

/** Актуальный API MAX (platform-api устарел). */
const MAX_API = (process.env.MAX_API_BASE ?? 'https://platform-api2.max.ru').replace(/\/$/, '');
const MAX_ATTACHMENT_MAX_BYTES = Number(process.env.MAX_ATTACHMENT_MAX_BYTES ?? String(25 * 1024 * 1024));

type MaxUploadType = 'image' | 'video' | 'audio' | 'file';

class MaxClient {
  constructor(private readonly token: string) {}

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${MAX_API}${path}`, {
      method,
      headers: {
        Authorization: this.token,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`MAX ${method} ${path} → ${response.status}: ${text.slice(0, 500)}`);
    }
    if (!text) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  async setMyCommands(): Promise<void> {
    try {
      await this.request('POST', '/me/commands', [
        { name: 'start', description: 'Начать / справка' },
        { name: 'end', description: 'Закрыть обращение' },
      ]);
    } catch (error) {
      // Некоторые стенды используют другой путь — не валим старт
      console.warn('[max] setMyCommands failed', error);
    }
  }

  async sendMessage(params: {
    chatId?: string | number;
    userId?: string | number;
    text?: string;
    attachments?: Array<Record<string, unknown>>;
  }): Promise<void> {
    const query = params.chatId != null
      ? `chat_id=${encodeURIComponent(String(params.chatId))}`
      : `user_id=${encodeURIComponent(String(params.userId))}`;

    const body: Record<string, unknown> = {};
    if (params.text?.trim()) {
      body.text = params.text;
      body.format = 'markdown';
    }
    if (params.attachments?.length) {
      body.attachments = params.attachments;
    }
    if (!body.text && !body.attachments) {
      body.text = ' ';
    }

    await this.sendWithRetry(query, body);
  }

  private async sendWithRetry(query: string, body: Record<string, unknown>): Promise<void> {
    const delays = [0, 1000, 2000, 4000, 8000];
    let lastError: unknown;
    for (const delay of delays) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      try {
        await this.request('POST', `/messages?${query}`, body);
        return;
      } catch (error) {
        lastError = error;
        const msg = String(error);
        if (!msg.includes('attachment.not.ready') && !msg.includes('file.not.processed')) {
          throw error;
        }
      }
    }
    throw lastError;
  }

  /**
   * Двухшаговая загрузка: POST /uploads?type= → multipart data=@file → token.
   * Для video/audio token может прийти уже на первом шаге.
   */
  async upload(type: MaxUploadType, data: Buffer, filename: string): Promise<string> {
    if (data.length > MAX_ATTACHMENT_MAX_BYTES) {
      throw new Error(`MAX upload: file too large (${data.length} > ${MAX_ATTACHMENT_MAX_BYTES})`);
    }

    const init = (await this.request('POST', `/uploads?type=${type}`)) as {
      url?: string;
      token?: string;
    };
    if (!init.url) {
      throw new Error('MAX upload: missing url');
    }

    const form = new FormData();
    form.append('data', new Blob([new Uint8Array(data)]), filename);
    const uploaded = await fetch(init.url, {
      method: 'POST',
      headers: { Authorization: this.token },
      body: form,
    });
    const uploadedText = await uploaded.text();
    if (!uploaded.ok) {
      throw new Error(`MAX CDN upload → ${uploaded.status}: ${uploadedText.slice(0, 300)}`);
    }

    let token = init.token;
    try {
      const json = JSON.parse(uploadedText) as { token?: string; retval?: unknown };
      if (json.token) token = json.token;
    } catch {
      // video/audio иногда возвращают retval без token — берём init.token
    }

    if (!token) {
      throw new Error('MAX upload: missing token after upload');
    }
    return token;
  }

  async resolveMediaUrl(kind: 'video' | 'audio', token: string): Promise<string | null> {
    const path = kind === 'video' ? `/videos/${encodeURIComponent(token)}` : `/audios/${encodeURIComponent(token)}`;
    try {
      const info = (await this.request('GET', path)) as {
        url?: string;
        filename?: string;
        files?: { mp4?: { url?: string } };
      };
      return info.url ?? info.files?.mp4?.url ?? null;
    } catch (error) {
      console.warn(`[max] resolve ${kind} failed`, error);
      return null;
    }
  }

  async subscribeWebhook(url: string, secret?: string): Promise<void> {
    const body: Record<string, unknown> = {
      url,
      update_types: ['message_created', 'bot_started'],
    };
    if (secret) body.secret = secret;
    await this.request('POST', '/subscriptions', body);
  }
}

function mimeToMaxType(mime: string): MaxUploadType {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

function extractText(update: Record<string, unknown>): string {
  const message = update.message as Record<string, unknown> | undefined;
  if (!message) return '';
  const body = message.body as Record<string, unknown> | undefined;
  if (body && typeof body.text === 'string') return body.text;
  if (typeof message.text === 'string') return message.text;
  return '';
}

function extractChatId(update: Record<string, unknown>): string | null {
  if (typeof update.chat_id === 'number' || typeof update.chat_id === 'string') {
    return String(update.chat_id);
  }
  const message = update.message as Record<string, unknown> | undefined;
  const recipient = message?.recipient as Record<string, unknown> | undefined;
  if (recipient && (typeof recipient.chat_id === 'number' || typeof recipient.chat_id === 'string')) {
    return String(recipient.chat_id);
  }
  return null;
}

function extractUser(update: Record<string, unknown>): { id: string; name?: string; username?: string } | null {
  const message = update.message as Record<string, unknown> | undefined;
  const user = (update.user ?? message?.sender) as Record<string, unknown> | undefined;
  if (!user) return null;
  if (user.is_bot === true) return null;
  const id = user.user_id ?? user.id;
  if (id === undefined || id === null) return null;
  const name =
    typeof user.name === 'string'
      ? user.name
      : [user.first_name, user.last_name].filter((x) => typeof x === 'string').join(' ') || undefined;
  return {
    id: String(id),
    name,
    username: typeof user.username === 'string' ? user.username : undefined,
  };
}

async function extractAttachments(update: Record<string, unknown>, max: MaxClient): Promise<BridgeAttachment[]> {
  const message = update.message as Record<string, unknown> | undefined;
  const body = message?.body as Record<string, unknown> | undefined;
  const list = (body?.attachments ?? message?.attachments) as Array<Record<string, unknown>> | undefined;
  if (!list?.length) return [];

  const out: BridgeAttachment[] = [];
  for (const item of list) {
    const type = String(item.type ?? '');
    if (type === 'inline_keyboard' || type === 'share' || type === 'location' || type === 'contact' || type === 'sticker') {
      continue;
    }

    const payload = (item.payload ?? {}) as Record<string, unknown>;
    let url = typeof payload.url === 'string' ? payload.url : '';
    const token = typeof payload.token === 'string' ? payload.token : '';
    const filenameHint =
      typeof item.filename === 'string'
        ? item.filename
        : typeof payload.filename === 'string'
          ? payload.filename
          : undefined;

    try {
      if (!url && token && (type === 'video' || type === 'audio')) {
        url = (await max.resolveMediaUrl(type, token)) ?? '';
      }
      if (!url) {
        console.warn(`[max] skip attachment type=${type}: no url`);
        continue;
      }

      const file = await downloadUrl(url);
      if (file.data.length > MAX_ATTACHMENT_MAX_BYTES) {
        console.warn(`[max] skip oversized attachment ${file.data.length}`);
        continue;
      }

      const ext = type === 'image' ? 'jpg' : type === 'video' ? 'mp4' : type === 'audio' ? 'mp3' : 'bin';
      out.push({
        filename: filenameHint ?? file.filename ?? `${type || 'file'}.${ext}`,
        mimeType: file.mimeType || (type === 'image' ? 'image/jpeg' : 'application/octet-stream'),
        data: file.data,
      });
    } catch (error) {
      console.error('[max] attachment download failed', type, error);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const config = loadBridgeConfig('max');
  const token = process.env.MAX_BOT_TOKEN;
  if (!token) throw new Error('Missing MAX_BOT_TOKEN');

  const webhookSecret = process.env.MAX_WEBHOOK_SECRET ?? '';
  const max = new MaxClient(token);
  const zammad = new ZammadClient(config.zammadUrl, config.zammadToken);
  const store = new SessionStore(config.redisUrl, config.channel);
  const inbound = new InboundTicketService(config, zammad, store);

  const welcome =
    process.env.MAX_WELCOME_MESSAGE ??
    'Здравствуйте! Опишите проблему или пришлите файл/фото.\nКоманды: /end — закрыть обращение.';

  const app = createBridgeApp({
    config,
    store,
    zammad,
    pathPrefix: process.env.HTTP_PATH_PREFIX ?? '/bridges/max',
    sendToMessenger: async (externalChatId, text, attachments) => {
      const maxAttachments: Array<Record<string, unknown>> = [];
      for (const file of attachments ?? []) {
        const type = mimeToMaxType(file.mimeType);
        const uploadToken = await max.upload(type, file.data, file.filename);
        maxAttachments.push({ type, payload: { token: uploadToken } });
      }
      await max.sendMessage({
        chatId: externalChatId,
        text: stripHtml(text),
        attachments: maxAttachments,
      });
    },
  });

  const webhookHandler = async (req: express.Request, res: express.Response) => {
    try {
      if (webhookSecret) {
        const header = req.header('x-max-bot-api-secret') ?? '';
        if (header !== webhookSecret) {
          res.status(401).json({ error: 'invalid_secret' });
          return;
        }
      }

      const update = req.body as Record<string, unknown>;
      const updateType = String(update.update_type ?? update.type ?? '');

      if (updateType === 'bot_started') {
        const chatId = extractChatId(update);
        const user = extractUser(update);
        if (chatId) {
          await max.sendMessage({ chatId, text: welcome });
        } else if (user) {
          await max.sendMessage({ userId: user.id, text: welcome });
        }
        res.json({ ok: true });
        return;
      }

      if (updateType !== 'message_created') {
        res.json({ ok: true, skipped: updateType });
        return;
      }

      const chatId = extractChatId(update);
      const user = extractUser(update);
      const text = extractText(update);
      if (!chatId || !user) {
        res.json({ ok: true, skipped: 'no_chat_or_user' });
        return;
      }

      const attachments = await extractAttachments(update, max);
      if (!text.trim() && attachments.length === 0) {
        res.json({ ok: true, skipped: 'empty' });
        return;
      }

      const result = await inbound.handleMessage({
        externalChatId: chatId,
        text,
        user,
        attachments,
      });

      if (result.ended) {
        await max.sendMessage({ chatId, text: config.goodbyeMessage });
      }

      res.json({ ok: true, ticketId: result.ticketId, created: result.created, ended: result.ended });
    } catch (error) {
      console.error('[max] webhook error', error);
      res.status(500).json({ error: 'webhook_failed' });
    }
  };

  const prefix = process.env.HTTP_PATH_PREFIX ?? '/bridges/max';
  app.post(`${prefix}/webhook`, webhookHandler);
  app.post('/webhook', webhookHandler);

  app.listen(config.port, async () => {
    console.log(`[max] listening on :${config.port}, api=${MAX_API}`);
    await max.setMyCommands();
    const webhookUrl = process.env.MAX_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        await max.subscribeWebhook(webhookUrl, webhookSecret || undefined);
        console.log(`[max] subscribed webhook ${webhookUrl}`);
      } catch (error) {
        console.error('[max] webhook subscribe failed (configure manually)', error);
      }
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
