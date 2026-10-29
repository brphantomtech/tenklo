import { DefaultTransport, Publisher } from '@nangohq/pubsub';
import { Ok } from '@nangohq/utils';

import { envs } from '../env.js';
import { UsageLedger } from '../services/usage/ledger.js';

import type { PublishBatchProps, PublishBatchResult, Transport } from '@nangohq/pubsub';
import type { Event } from '@nangohq/types';
import type { Result } from '@nangohq/utils';

/**
 * Self-hosted metering (`NANGO_PUBSUB_TRANSPORT=ledger`): usage events add up into the `usage_daily` table instead
 * of going to a broker. Every other event is dropped, as with no transport.
 */
export class LedgerTransport implements Transport {
    constructor(private readonly ledger = new UsageLedger()) {}

    // eslint-disable-next-line @typescript-eslint/require-await
    async connect(): Promise<Result<void>> {
        return Ok(undefined);
    }

    async disconnect(): Promise<Result<void>> {
        await this.ledger.flush();
        return Ok(undefined);
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    async publish(event: Event): Promise<Result<void>> {
        if (event.subject === 'usage') {
            this.ledger.record(event);
        }
        return Ok(undefined);
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    async publishBatch<TSubject extends Event['subject']>({ events }: PublishBatchProps<TSubject>): Promise<Result<PublishBatchResult>> {
        for (const event of events as Event[]) {
            if (event.subject === 'usage') {
                this.ledger.record(event);
            }
        }
        return Ok({ successful: events.map((e) => e.idempotencyKey), failed: [] });
    }

    subscribe(): void {}
}

class PubSub {
    public publisher: Publisher;
    public transport: Transport;

    constructor() {
        this.transport = envs.NANGO_PUBSUB_TRANSPORT === 'ledger' ? new LedgerTransport() : new DefaultTransport();
        this.publisher = new Publisher(this.transport);
    }

    async connect(): Promise<Result<void>> {
        return this.transport.connect();
    }

    async disconnect(): Promise<Result<void>> {
        return this.transport.disconnect();
    }
}

export const pubsub = new PubSub();
