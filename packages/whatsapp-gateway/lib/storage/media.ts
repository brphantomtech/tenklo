import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';

import type { Config } from '../env.js';
import type { Readable } from 'node:stream';

export class ObjectNotFoundError extends Error {
    constructor(key: string) {
        super(`Object not found: ${key}`);
    }
}

export interface MediaObject {
    stream: Readable;
    contentLength: number | undefined;
}

/** S3-compatible media bucket: outbound media is streamed from it, inbound media is written to it. */
export class S3Media {
    private readonly s3: S3Client;

    constructor(private readonly config: Config) {
        this.s3 = new S3Client({
            endpoint: config.S3_ENDPOINT,
            region: config.S3_REGION,
            forcePathStyle: true,
            credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY }
        });
    }

    async openMedia(objectKey: string): Promise<MediaObject> {
        try {
            const res = await this.s3.send(new GetObjectCommand({ Bucket: this.config.S3_BUCKET_MEDIA, Key: objectKey }));
            return { stream: res.Body as Readable, contentLength: res.ContentLength };
        } catch (err) {
            throw isNotFound(err) ? new ObjectNotFoundError(objectKey) : err;
        }
    }

    async putMedia(objectKey: string, body: Buffer, contentType: string): Promise<void> {
        await this.s3.send(new PutObjectCommand({ Bucket: this.config.S3_BUCKET_MEDIA, Key: objectKey, Body: body, ContentType: contentType }));
    }

    destroy(): void {
        this.s3.destroy();
    }
}

function isNotFound(err: unknown): boolean {
    return err instanceof NoSuchKey || (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404);
}
