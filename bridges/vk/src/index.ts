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

const VK_API = (process.env.VK_API_BASE ?? 'https://api.vk.com/method').replace(/\/$/, '');
const VK_API_VERSION = process.env.VK_API_VERSION ?? '5.199';
const VK_ATTACHMENT_MAX_BYTES = Number(process.env.VK_ATTACHMENT_MAX_BYTES ?? String(50 * 1024 * 1024));

class VkClient {
  constructor(
    private readonly token: string,
    private readonly groupId: string,
  ) {}

  async call(method: string, params: Record<string, string | number> = {}): Promise<unknown> {
    const body = new URLSearchParams({
      access_token: this.token,
      v: VK_API_VERSION,
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    });
    const response = await fetch(`${VK_API}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`VK ${method} → ${response.status}: ${text.slice(0, 400)}`);
    }
    const json = (await response.json()) as { response?: unknown; error?: { error_msg?: string; error_code?: number } };
    if (json.error) {
      throw new Error(`VK ${method}: [${json.error.error_code}] ${json.error.error_msg ?? 'error'}`);
    }
    return json.response;
  }

  async sendMessage(peerId: string | number, text: string, attachment?: string): Promise<void> {
    const randomId = Math.floor(Math.random() * 2_147_483_647);
    const params: Record<string, string | number> = {
      peer_id: peerId,
      random_id: randomId,
      group_id: this.groupId,
    };
    if (text.trim()) params.message = text;
    if (attachment) params.attachment = attachment;
    if (!params.message && !params.attachment) params.message = ' ';
    await this.call('messages.send', params);
  }

  async uploadDocument(peerId: string | number, file: BridgeAttachment): Promise<string> {
    const server = (await this.call('docs.getMessagesUploadServer', {
      type: 'doc',
      peer_id: peerId,
    })) as { upload_url?: string };
    if (!server.upload_url) throw new Error('VK docs upload: no url');

    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file.data)], { type: file.mimeType }), file.filename);
    const uploadedRes = await fetch(server.upload_url, { method: 'POST', body: form });
    if (!uploadedRes.ok) throw new Error(`VK docs upload → ${uploadedRes.status}`);
    const uploaded = (await uploadedRes.json()) as { file?: string };
    if (!uploaded.file) throw new Error('VK docs upload: no file field');

    const saved = (await this.call('docs.save', {
      file: uploaded.file,
      title: file.filename,
    })) as
      | { doc?: { owner_id: number; id: number }; type?: string }
      | Array<{ owner_id: number; id: number }>;

    const doc = Array.isArray(saved) ? saved[0] : saved.doc;
    if (!doc) throw new Error('VK docs.save: empty');
    return `doc${doc.owner_id}_${doc.id}`;
  }

  async uploadPhoto(peerId: string | number, file: BridgeAttachment): Promise<string> {
    const server = (await this.call('photos.getMessagesUploadServer', {
      peer_id: peerId,
    })) as { upload_url?: string };
    if (!server.upload_url) throw new Error('VK photos upload: no url');

    const form = new FormData();
    form.append('photo', new Blob([new Uint8Array(file.data)], { type: file.mimeType }), file.filename);
    const uploadedRes = await fetch(server.upload_url, { method: 'POST', body: form });
    if (!uploadedRes.ok) throw new Error(`VK photos upload → ${uploadedRes.status}`);
    const uploaded = (await uploadedRes.json()) as {
      server?: number;
      photo?: string;
      hash?: string;
    };

    const saved = (await this.call('photos.saveMessagesPhoto', {
      server: uploaded.server ?? 0,
      photo: uploaded.photo ?? '',
      hash: uploaded.hash ?? '',
    })) as Array<{ owner_id: number; id: number; access_key?: string }>;

    const photo = saved[0];
    if (!photo) throw new Error('VK photos.saveMessagesPhoto: empty');
    return photo.access_key
      ? `photo${photo.owner_id}_${photo.id}_${photo.access_key}`
      : `photo${photo.owner_id}_${photo.id}`;
  }
}

function pickPhotoUrl(photo: Record<string, unknown>): string | undefined {
  const sizes = photo.sizes as Array<{ url?: string; width?: number; height?: number; type?: string }> | undefined;
  if (sizes?.length) {
    const best = [...sizes].sort(
      (a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0),
    )[0];
    return best?.url;
  }
  // legacy fields
  for (const key of ['photo_2560', 'photo_1280', 'photo_807', 'photo_604', 'photo_130'] as const) {
    if (typeof photo[key] === 'string') return photo[key] as string;
  }
  return undefined;
}

async function safeDownload(url: string): Promise<BridgeAttachment | null> {
  try {
    const file = await downloadUrl(url);
    if (file.data.length > VK_ATTACHMENT_MAX_BYTES) {
      console.warn(`[vk] skip oversized ${file.data.length}`);
      return null;
    }
    return {
      filename: file.filename ?? `file-${Date.now()}`,
      mimeType: file.mimeType,
      data: file.data,
    };
  } catch (error) {
    console.error('[vk] download failed', error);
    return null;
  }
}

async function extractVkAttachments(
  attachments: Array<Record<string, unknown>> | undefined,
): Promise<BridgeAttachment[]> {
  if (!attachments?.length) return [];
  const out: BridgeAttachment[] = [];

  for (const item of attachments) {
    const type = String(item.type ?? '');
    try {
      if (type === 'photo' && item.photo && typeof item.photo === 'object') {
        const url = pickPhotoUrl(item.photo as Record<string, unknown>);
        if (!url) continue;
        const file = await safeDownload(url);
        if (!file) continue;
        out.push({
          ...file,
          filename: file.filename.endsWith('.jpg') ? file.filename : `photo-${Date.now()}.jpg`,
          mimeType: file.mimeType.startsWith('image/') ? file.mimeType : 'image/jpeg',
        });
      } else if (type === 'doc' && item.doc && typeof item.doc === 'object') {
        const doc = item.doc as { url?: string; title?: string; ext?: string; size?: number };
        if (!doc.url) continue;
        if (typeof doc.size === 'number' && doc.size > VK_ATTACHMENT_MAX_BYTES) continue;
        const file = await safeDownload(doc.url);
        if (!file) continue;
        out.push({
          ...file,
          filename: doc.title ?? file.filename ?? `doc.${doc.ext ?? 'bin'}`,
        });
      } else if (type === 'audio_message' && item.audio_message && typeof item.audio_message === 'object') {
        const audio = item.audio_message as { link_ogg?: string; link_mp3?: string };
        const url = audio.link_mp3 ?? audio.link_ogg;
        if (!url) continue;
        const file = await safeDownload(url);
        if (!file) continue;
        out.push({
          ...file,
          filename: `voice-${Date.now()}.${audio.link_mp3 ? 'mp3' : 'ogg'}`,
        });
      } else if (type === 'audio' && item.audio && typeof item.audio === 'object') {
        const audio = item.audio as { url?: string; title?: string; artist?: string };
        if (!audio.url) continue;
        const file = await safeDownload(audio.url);
        if (!file) continue;
        out.push({
          ...file,
          filename: `${audio.artist ?? 'audio'}-${audio.title ?? Date.now()}.mp3`,
        });
      } else if (type === 'video' && item.video && typeof item.video === 'object') {
        // Прямого URL часто нет без player — кладём текстовую пометку через отдельный article body
        const video = item.video as { title?: string; description?: string; id?: number; owner_id?: number };
        out.push({
          filename: `video-${video.owner_id}_${video.id}.txt`,
          mimeType: 'text/plain',
          data: Buffer.from(
            `VK video: ${video.title ?? ''}\n${video.description ?? ''}\nowner=${video.owner_id} id=${video.id}`,
            'utf8',
          ),
        });
      } else if (type === 'sticker' || type === 'gift' || type === 'link' || type === 'wall') {
        // не поддерживаем как бинарные вложения
        continue;
      }
    } catch (error) {
      console.error('[vk] attachment parse failed', type, error);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const config = loadBridgeConfig('vk');
  const token = process.env.VK_GROUP_TOKEN;
  const confirmation = process.env.VK_CONFIRMATION;
  const secret = process.env.VK_CALLBACK_SECRET ?? '';
  const groupId = process.env.VK_GROUP_ID;

  if (!token) throw new Error('Missing VK_GROUP_TOKEN');
  if (!confirmation) throw new Error('Missing VK_CONFIRMATION');
  if (!groupId) throw new Error('Missing VK_GROUP_ID');

  const vk = new VkClient(token, groupId);
  const zammad = new ZammadClient(config.zammadUrl, config.zammadToken);
  const store = new SessionStore(config.redisUrl, config.channel);
  const inbound = new InboundTicketService(config, zammad, store);

  const welcome =
    process.env.VK_WELCOME_MESSAGE ??
    'Здравствуйте! Опишите проблему или пришлите файл/фото.\nКоманды: /end — закрыть обращение.';

  const prefix = process.env.HTTP_PATH_PREFIX ?? '/bridges/vk';
  const app = createBridgeApp({
    config,
    store,
    zammad,
    pathPrefix: prefix,
    sendToMessenger: async (externalChatId, text, attachments) => {
      const clean = stripHtml(text);
      if (!attachments?.length) {
        await vk.sendMessage(externalChatId, clean);
        return;
      }

      let first = true;
      for (const file of attachments) {
        try {
          const attachment = file.mimeType.startsWith('image/')
            ? await vk.uploadPhoto(externalChatId, file)
            : await vk.uploadDocument(externalChatId, file);
          await vk.sendMessage(externalChatId, first ? clean : '', attachment);
          first = false;
        } catch (error) {
          console.error('[vk] outbound attachment failed, fallback text', error);
          if (first && clean) {
            await vk.sendMessage(externalChatId, `${clean}\n\n[вложение не удалось отправить: ${file.filename}]`);
            first = false;
          } else {
            await vk.sendMessage(externalChatId, `[вложение не удалось отправить: ${file.filename}]`);
          }
        }
      }
    },
  });

  const callbackHandler = async (
    req: { body: unknown; header?: (n: string) => string | undefined },
    res: {
      type: (t: string) => { send: (b: string) => void };
      status: (n: number) => { send: (b: string) => void };
    },
  ) => {
    try {
      const body = req.body as {
        type?: string;
        secret?: string;
        group_id?: number;
        object?: {
          message?: {
            id?: number;
            peer_id?: number;
            from_id?: number;
            text?: string;
            attachments?: Array<Record<string, unknown>>;
            payload?: string;
          };
          // иногда message лежит в object напрямую (старый формат)
        } & Record<string, unknown>;
      };

      if (body.type === 'confirmation') {
        res.type('text/plain').send(confirmation);
        return;
      }

      if (secret && body.secret !== secret) {
        res.status(403).send('forbidden');
        return;
      }

      if (body.type === 'message_new') {
        const raw = body.object ?? {};
        const message = (raw.message ?? raw) as {
          id?: number;
          peer_id?: number;
          from_id?: number;
          text?: string;
          attachments?: Array<Record<string, unknown>>;
          out?: number;
        };

        // исходящие от сообщества не обрабатываем
        if (message.out === 1) {
          res.type('text/plain').send('ok');
          return;
        }

        const peerId = message.peer_id;
        const fromId = message.from_id;
        // from_id < 0 — сообщение от сообщества/бота
        if (!peerId || !fromId || fromId < 0) {
          res.type('text/plain').send('ok');
          return;
        }

        const text = (message.text ?? '').trim();
        const attachments = await extractVkAttachments(message.attachments);

        if (text.toLowerCase() === '/start' || text.toLowerCase() === 'начать') {
          await vk.sendMessage(peerId, welcome);
          res.type('text/plain').send('ok');
          return;
        }

        if (text || attachments.length) {
          const result = await inbound.handleMessage({
            externalChatId: String(peerId),
            text,
            user: { id: String(fromId) },
            messageId: message.id ? String(message.id) : undefined,
            attachments,
          });
          if (result.ended) {
            await vk.sendMessage(peerId, config.goodbyeMessage);
          }
        }
      }

      res.type('text/plain').send('ok');
    } catch (error) {
      console.error('[vk] callback error', error);
      // VK требует "ok", иначе ретраи
      res.type('text/plain').send('ok');
    }
  };

  app.post(`${prefix}/callback`, callbackHandler);
  app.post('/callback', callbackHandler);

  app.listen(config.port, () => {
    console.log(`[vk] listening on :${config.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
