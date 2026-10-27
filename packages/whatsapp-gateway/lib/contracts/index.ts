import { Ajv } from 'ajv';
import addFormatsModule from 'ajv-formats';

import schemas from './generated/schemas.json' with { type: 'json' };

import type { Command, Event } from './generated/types.js';
import type { ValidateFunction } from 'ajv';

export type * from './generated/types.js';

export type CommandOf<T extends Command['type']> = Extract<Command, { type: T }>;
export type EventOf<T extends Event['type']> = Extract<Event, { type: T }>;
export type EventPayload<T extends Event['type']> = EventOf<T>['payload'];

const BASE_ID = 'https://contracts.stackchat.dev/v1/';

// ajv-formats é CommonJS: o plugin está em module.exports.default.
const addFormats = addFormatsModule.default;

const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
for (const schema of schemas) ajv.addSchema(schema);

const commandValidator = ajv.getSchema(BASE_ID + 'command.json') as ValidateFunction<Command>;
const eventValidator = ajv.getSchema(BASE_ID + 'event.json') as ValidateFunction<Event>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseCommand(data: unknown): ParseResult<Command> {
    if (commandValidator(data)) return { ok: true, value: data };
    return { ok: false, error: ajv.errorsText(commandValidator.errors) };
}

/** Evento inválido é bug do worker: falha alto em vez de publicar algo que o core vai rejeitar. */
export function assertValidEvent(event: Event): void {
    const type = event.type;
    if (!eventValidator(event)) {
        throw new Error(`Evento ${type} fora do contrato: ${ajv.errorsText(eventValidator.errors)}`);
    }
}
