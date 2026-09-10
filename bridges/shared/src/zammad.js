function toAttachmentPayload(attachments) {
    if (!attachments?.length)
        return undefined;
    return attachments.map((a) => ({
        filename: a.filename,
        data: a.data.toString('base64'),
        'mime-type': a.mimeType,
    }));
}
export class ZammadClient {
    baseUrl;
    token;
    constructor(baseUrl, token) {
        this.baseUrl = baseUrl;
        this.token = token;
    }
    async request(method, path, body) {
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
            return undefined;
        }
        return (await response.json());
    }
    async findOrCreateCustomer(externalId, channel, name) {
        const login = `${channel}_${externalId}`;
        const email = `${login}@bridge.local`;
        const search = await this.request('GET', `/api/v1/users/search?query=${encodeURIComponent(login)}&limit=5`);
        const existing = search.find((u) => u.login === login || u.email === email);
        if (existing) {
            return existing;
        }
        const display = (name ?? login).slice(0, 100);
        return this.request('POST', '/api/v1/users', {
            login,
            email,
            firstname: display,
            lastname: channel,
            roles: ['Customer'],
        });
    }
    async createTicket(params) {
        return this.request('POST', '/api/v1/tickets', {
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
    async addCustomerArticle(params) {
        return this.request('POST', '/api/v1/ticket_articles', {
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
    async getTicket(ticketId) {
        return this.request('GET', `/api/v1/tickets/${ticketId}`);
    }
    async getArticle(articleId) {
        return this.request('GET', `/api/v1/ticket_articles/${articleId}`);
    }
    async closeTicket(ticketId) {
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
    async downloadAttachment(ticketId, articleId, attachmentId) {
        const response = await fetch(`${this.baseUrl}/api/v1/ticket_attachment/${ticketId}/${articleId}/${attachmentId}`, {
            headers: {
                Authorization: `Token token=${this.token}`,
            },
        });
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
