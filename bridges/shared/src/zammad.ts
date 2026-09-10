import type { BridgeAttachment, BridgeChannel, TicketArticlePreferences } from './types.js';

interface ZammadUser {
  id: number;
  login?: string;
  email?: string;
  firstname?: string;
  lastname?: string;
}

interface ZammadTicket {
  id: number;
  number?: string;
  title?: string;
  state_id?: number;
  group_id?: number;
}

interface ZammadArticle {
  id: number;
  ticket_id: number;
  body?: string;
  attachments?: Array<{
    id: number;
    filename: string;
    size?: number;
    preferences?: { 'Mime-Type'?: string };
  }>;
}

function toAttachmentPayload(attachments: BridgeAttachment[] | undefined) {
  if (!attachments?.length) return undefined;
  return attachments.map((a) => ({
    filename: a.filename,
    data: a.data.toString('base64'),
    'mime-type': a.mimeType,
  }));
}

export class ZammadClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Token token=${this.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Zammad ${method} ${path} → ${response.status}: ${text.slice(0, 500)}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  async findOrCreateCustomer(externalId: string, channel: BridgeChannel, name?: string): Promise<ZammadUser> {
    const login = `${channel}_${externalId}`;
    const email = `${login}@bridge.local`;

    const search = await this.request<ZammadUser[]>(
      'GET',
      `/api/v1/users/search?query=${encodeURIComponent(login)}&limit=5`,
    );
    const existing = search.find((u) => u.login === login || u.email === email);
    if (existing) {
      return existing;
    }

    const display = (name ?? login).slice(0, 100);
    return this.request<ZammadUser>('POST', '/api/v1/users', {
      login,
      email,
      firstname: display,
      lastname: channel,
      roles: ['Customer'],
    });
  }

  async createTicket(params: {
    title: string;
    groupId: number;
    customerId: number;
    body: string;
    preferences: TicketArticlePreferences;
    attachments?: BridgeAttachment[];
  }): Promise<ZammadTicket> {
    return this.request<ZammadTicket>('POST', '/api/v1/tickets', {
      title: params.title.slice(0, 200),
      group_id: params.groupId,
      customer_id: params.customerId,
      article: {
        subject: params.title.slice(0, 200),
        body: params.body,
        type: 'web',
        internal: false,
        sender: 'Customer',
        content_type: 'text/plain',
        preferences: params.preferences,
        attachments: toAttachmentPayload(params.attachments),
      },
    });
  }

  async addCustomerArticle(params: {
    ticketId: number;
    body: string;
    preferences: TicketArticlePreferences;
    attachments?: BridgeAttachment[];
  }): Promise<ZammadArticle> {
    return this.request<ZammadArticle>('POST', '/api/v1/ticket_articles', {
      ticket_id: params.ticketId,
      body: params.body,
      type: 'web',
      internal: false,
      sender: 'Customer',
      content_type: 'text/plain',
      preferences: params.preferences,
      attachments: toAttachmentPayload(params.attachments),
    });
  }

  async getTicket(ticketId: number): Promise<ZammadTicket> {
    return this.request<ZammadTicket>('GET', `/api/v1/tickets/${ticketId}`);
  }

  async getArticle(articleId: number): Promise<ZammadArticle> {
    return this.request<ZammadArticle>('GET', `/api/v1/ticket_articles/${articleId}`);
  }

  async closeTicket(ticketId: number): Promise<void> {
    await this.request('PUT', `/api/v1/tickets/${ticketId}`, {
      state: 'closed',
      article: {
        subject: 'Session ended from messenger',
        body: 'Диалог закрыт пользователем командой /end.',
        type: 'note',
        internal: true,
        sender: 'System',
      },
    });
  }

  async downloadAttachment(ticketId: number, articleId: number, attachmentId: number): Promise<BridgeAttachment> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/ticket_attachment/${ticketId}/${articleId}/${attachmentId}`,
      {
        headers: {
          Authorization: `Token token=${this.token}`,
        },
      },
    );
    if (!response.ok) {
      throw new Error(`Zammad attachment download → ${response.status}`);
    }
    const buf = Buffer.from(await response.arrayBuffer());
    const disposition = response.headers.get('content-disposition') ?? '';
    const mimeType = response.headers.get('content-type') ?? 'application/octet-stream';
    const match = /filename\*?=(?:UTF-8''|")?([^\";]+)/i.exec(disposition);
    const filename = match ? decodeURIComponent(match[1].replace(/"/g, '')) : `file-${attachmentId}`;
    return { filename, mimeType: mimeType.split(';')[0].trim(), data: buf };
  }
}
