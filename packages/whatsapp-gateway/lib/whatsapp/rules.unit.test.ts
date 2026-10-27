import { describe, expect, it } from 'vitest';

import { mask } from '../logger.js';
import {
    canSendToGroup,
    classifyDisconnect,
    pacingDelayMs,
    parseRecipient,
    receiptStatus,
    reconnectDelayMs,
    summarizeGroups,
    typingDurationMs
} from './rules.js';

import type { GroupLike } from './rules.js';

describe('parseRecipient', () => {
    it('aceita telefone com DDI e remove a formatação', () => {
        expect(parseRecipient({ kind: 'contact', externalId: '+55 (11) 99999-0000' })).toEqual({ kind: 'contact-phone', phone: '5511999990000' });
    });

    it('recusa telefone curto demais ou longo demais', () => {
        expect(parseRecipient({ kind: 'contact', externalId: '11999' }).kind).toBe('invalid');
        expect(parseRecipient({ kind: 'contact', externalId: '1234567890123456' }).kind).toBe('invalid');
    });

    it('aceita JID de contato, @lid e converte o legado @c.us', () => {
        expect(parseRecipient({ kind: 'contact', externalId: '5511999990000@s.whatsapp.net' })).toEqual({
            kind: 'contact-jid',
            jid: '5511999990000@s.whatsapp.net'
        });
        expect(parseRecipient({ kind: 'contact', externalId: '123456789012345@lid' }).kind).toBe('contact-jid');
        expect(parseRecipient({ kind: 'contact', externalId: '5511999990000@c.us' })).toEqual({
            kind: 'contact-jid',
            jid: '5511999990000@s.whatsapp.net'
        });
    });

    it('não aceita grupo como contato nem contato como grupo', () => {
        expect(parseRecipient({ kind: 'contact', externalId: '120363000000000000@g.us' }).kind).toBe('invalid');
        expect(parseRecipient({ kind: 'group', externalId: '5511999990000@s.whatsapp.net' }).kind).toBe('invalid');
        expect(parseRecipient({ kind: 'group', externalId: '120363000000000000@g.us' })).toEqual({ kind: 'group', jid: '120363000000000000@g.us' });
    });
});

describe('classifyDisconnect', () => {
    it('logout e banimento encerram e apagam a sessão', () => {
        expect(classifyDisconnect(401, true)).toMatchObject({ action: 'stop', status: 'DISCONNECTED', reason: 'LOGGED_OUT', clearSession: true });
        expect(classifyDisconnect(403, true)).toMatchObject({ action: 'stop', status: 'BANNED', clearSession: true });
    });

    it('sessão aberta em outro lugar encerra sem apagar', () => {
        expect(classifyDisconnect(440, true)).toMatchObject({ action: 'stop', reason: 'CONNECTION_REPLACED', clearSession: false });
    });

    it('515 depois do pareamento reabre na hora', () => {
        expect(classifyDisconnect(515, true)).toEqual({ action: 'restart' });
        expect(classifyDisconnect(515, false)).toEqual({ action: 'restart' });
    });

    it('408 sem pareamento é QR expirado; pareado é queda de conexão', () => {
        expect(classifyDisconnect(408, false)).toMatchObject({ action: 'stop', reason: 'QR_TIMEOUT', clearSession: true });
        expect(classifyDisconnect(408, true)).toEqual({ action: 'reconnect' });
    });

    it('queda desconhecida em sessão pareada reconecta', () => {
        expect(classifyDisconnect(428, true)).toEqual({ action: 'reconnect' });
        expect(classifyDisconnect(undefined, true)).toEqual({ action: 'reconnect' });
    });
});

describe('ritmo e tempos', () => {
    it('intervalo entre envios fica dentro da faixa configurada', () => {
        expect(pacingDelayMs(4_000, 10_000, () => 0)).toBe(4_000);
        expect(pacingDelayMs(4_000, 10_000, () => 0.999999)).toBe(10_000);
    });

    it('"digitando" é proporcional ao texto, entre 1,5s e 5s', () => {
        expect(typingDurationMs(0)).toBe(1_500);
        expect(typingDurationMs(10_000)).toBe(5_000);
    });

    it('backoff de reconexão cresce e para em 60s (+-20%)', () => {
        const mid = () => 0.5;
        expect(reconnectDelayMs(1, mid)).toBe(2_000);
        expect(reconnectDelayMs(3, mid)).toBe(8_000);
        expect(reconnectDelayMs(20, mid)).toBe(60_000);
    });

    it('recibos: 3 entregue, 4 e 5 lido, o resto ignorado', () => {
        expect(receiptStatus(2)).toBeUndefined();
        expect(receiptStatus(3)).toBe('DELIVERED');
        expect(receiptStatus(4)).toBe('READ');
        expect(receiptStatus(5)).toBe('READ');
    });
});

describe('grupos', () => {
    const me = { id: '5511988880000:12@s.whatsapp.net', lid: '99887766554433:12@lid' };
    const group = (over: Partial<GroupLike>): GroupLike => ({
        id: '120363000000000001@g.us',
        subject: 'Grupo',
        participants: [{ id: '5511977770000@s.whatsapp.net' }],
        ...over
    });

    it('reconhece o número conectado como admin pelo telefone ou pelo @lid', () => {
        const byLid = group({ announce: true, participants: [{ id: '99887766554433@lid', admin: 'admin' }] });
        const byPhone = group({ announce: true, participants: [{ id: '1@lid', phoneNumber: '5511988880000@s.whatsapp.net', admin: 'superadmin' }] });
        expect(canSendToGroup(byLid, me)).toBe(true);
        expect(canSendToGroup(byPhone, me)).toBe(true);
    });

    it('grupo só de admins bloqueia quem não é admin; comunidade nunca recebe', () => {
        expect(canSendToGroup(group({ announce: true }), me)).toBe(false);
        expect(canSendToGroup(group({ announce: false }), me)).toBe(true);
        expect(canSendToGroup(group({ isCommunity: true }), me)).toBe(false);
    });

    it('resumo tira comunidades e ordena por nome', () => {
        const summary = summarizeGroups(
            [
                group({ id: '2@g.us', subject: 'Zeta', size: 40 }),
                group({ id: '3@g.us', subject: 'Comunidade', isCommunity: true }),
                group({ id: '1@g.us', subject: 'Alfa', announce: true })
            ],
            me
        );
        expect(summary.map((g) => g.name)).toEqual(['Alfa', 'Zeta']);
        expect(summary[0]).toMatchObject({ announce: true, isAdmin: false, canSend: false, participantsCount: 1 });
        expect(summary[1]).toMatchObject({ canSend: true, participantsCount: 40 });
    });
});

describe('mask', () => {
    it('mascara telefones e JIDs para log', () => {
        expect(mask('5511999990000@s.whatsapp.net')).toBe('5511****0000@s.whatsapp.net');
        expect(mask('5511999990000')).toBe('5511****0000');
        expect(mask('123')).toBe('****');
    });
});
