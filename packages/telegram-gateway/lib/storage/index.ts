import type { MediaObject, S3Media } from './media.js';
import type { PostgresSessionObjects } from './sessions.js';

export { ObjectNotFoundError, type MediaObject } from './media.js';

/** Channel objects live in Postgres and media in S3; the Telegram code only sees this one facade. */
export class Storage {
    constructor(
        private readonly sessions: PostgresSessionObjects,
        private readonly media: S3Media
    ) {}

    openMedia(objectKey: string): Promise<MediaObject> {
        return this.media.openMedia(objectKey);
    }

    putMedia(objectKey: string, body: Buffer, contentType: string): Promise<void> {
        return this.media.putMedia(objectKey, body, contentType);
    }

    /** Bytes of media a channel keeps: what it received (inbox) and what was uploaded to send (media). */
    async mediaUsage(tenantId: string, channelId: string): Promise<number> {
        const [inbox, outbound] = await Promise.all([
            this.media.sizeOf(`tenants/${tenantId}/inbox/${channelId}/`),
            this.media.sizeOf(`tenants/${tenantId}/media/${channelId}/`)
        ]);
        return inbox + outbound;
    }

    getSessionObject(key: string): Promise<Buffer | undefined> {
        return this.sessions.getSessionObject(key);
    }

    putSessionObject(key: string, body: Buffer): Promise<void> {
        return this.sessions.putSessionObject(key, body);
    }

    deleteSessionObjects(keys: string[]): Promise<void> {
        return this.sessions.deleteSessionObjects(keys);
    }

    deleteSessionPrefix(prefix: string): Promise<void> {
        return this.sessions.deleteSessionPrefix(prefix);
    }

    destroy(): void {
        this.media.destroy();
    }
}
