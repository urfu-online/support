import express from 'express';
function extractTicketId(payload) {
    if (typeof payload.ticket_id === 'number')
        return payload.ticket_id;
    if (payload.ticket && typeof payload.ticket.id === 'number')
        return payload.ticket.id;
    return null;
}
function extractArticle(payload) {
    if (payload.article && typeof payload.article === 'object') {
        return payload.article;
    }
    return undefined;
}
function isAgentPublicReply(article) {
    if (article.internal === true)
        return false;
    const sender = (article.sender ?? '').toLowerCase();
    if (sender && sender !== 'agent')
        return false;
    const hasBody = Boolean(article.body && article.body.trim());
    const hasAttachments = Boolean(article.attachments?.length);
    return hasBody || hasAttachments;
}
export function createBridgeApp(params) {
    const app = express();
    app.disable('x-powered-by');
    app.use(express.json({ limit: '5mb' }));
    const prefix = normalizePrefix(params.pathPrefix ?? process.env.HTTP_PATH_PREFIX ?? '');
    const health = async (_req, res) => {
        try {
            await params.store.ping();
            res.json({ ok: true, channel: params.config.channel });
        }
        catch (error) {
            res.status(503).json({ ok: false, error: String(error) });
        }
    };
    app.get(`${prefix}/health`, health);
    if (prefix) {
        app.get('/health', health);
    }
    const outboundHandler = async (req, res) => {
        const secret = req.header('x-bridge-secret') ?? req.query.secret;
        if (secret !== params.config.outboundSecret) {
            res.status(401).json({ error: 'unauthorized' });
            return;
        }
        const payload = req.body;
        let article = extractArticle(payload);
        if (!article || !isAgentPublicReply(article)) {
            res.json({ skipped: true, reason: 'not_agent_public_article' });
            return;
        }
        const prefs = article.preferences ?? {};
        const channelPref = prefs.bridge_channel;
        if (channelPref && channelPref !== params.config.channel) {
            res.json({ skipped: true, reason: 'other_channel' });
            return;
        }
        const ticketId = extractTicketId(payload);
        if (!ticketId) {
            res.status(400).json({ error: 'missing_ticket_id' });
            return;
        }
        let externalId = typeof prefs.bridge_external_id === 'string' ? prefs.bridge_external_id : null;
        if (!externalId) {
            externalId = await params.store.getExternalId(ticketId);
        }
        if (!externalId) {
            res.json({ skipped: true, reason: 'no_external_mapping' });
            return;
        }
        // Enrich attachments if webhook only sent metadata / ids
        if (article.id && (!article.attachments || article.attachments.some((a) => !a.filename))) {
            try {
                const full = await params.zammad.getArticle(article.id);
                article = { ...article, attachments: full.attachments ?? article.attachments };
            }
            catch (error) {
                console.warn(`[${params.config.channel}] getArticle failed`, error);
            }
        }
        const files = [];
        if (article.id && article.attachments?.length) {
            for (const meta of article.attachments) {
                if (!meta.id)
                    continue;
                try {
                    files.push(await params.zammad.downloadAttachment(ticketId, article.id, meta.id));
                }
                catch (error) {
                    console.error(`[${params.config.channel}] attachment download failed`, meta.id, error);
                }
            }
        }
        try {
            const text = article.body ? stripHtml(article.body) : '';
            await params.sendToMessenger(externalId, text, files);
            res.json({ ok: true, ticketId, externalId, attachments: files.length });
        }
        catch (error) {
            console.error(`[${params.config.channel}] outbound send failed`, error);
            res.status(502).json({ error: 'send_failed', detail: String(error) });
        }
    };
    app.post(`${prefix}/internal/zammad-outbound`, outboundHandler);
    if (prefix) {
        app.post('/internal/zammad-outbound', outboundHandler);
    }
    app.use((err, _req, res, _next) => {
        console.error(`[${params.config.channel}] unhandled`, err);
        res.status(500).json({ error: 'internal' });
    });
    return app;
}
function normalizePrefix(prefix) {
    if (!prefix || prefix === '/')
        return '';
    return prefix.startsWith('/') ? prefix.replace(/\/$/, '') : `/${prefix.replace(/\/$/, '')}`;
}
export function stripHtml(input) {
    return input
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
}
export async function downloadUrl(url, headers = {}) {
    const response = await fetch(url, { headers });
    if (!response.ok) {
        throw new Error(`download ${url} → ${response.status}`);
    }
    const mimeType = (response.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim();
    const disposition = response.headers.get('content-disposition') ?? '';
    const match = /filename\*?=(?:UTF-8''|")?([^\";]+)/i.exec(disposition);
    const filename = match ? decodeURIComponent(match[1].replace(/"/g, '')) : undefined;
    return { data: Buffer.from(await response.arrayBuffer()), mimeType, filename };
}
