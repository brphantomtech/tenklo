// Regras do canal sem dependência de socket, rede ou relógio: fáceis de testar e de revisar.

import type { ChannelStatus, ChannelStatusReason, GroupsSyncedEvent, Recipient } from '../contracts/index.js';

// ---------------------------------------------------------------------------
// Destinatário
// ---------------------------------------------------------------------------

export type ParsedRecipient =
    | { kind: 'contact-jid'; jid: string }
    | { kind: 'contact-phone'; phone: string }
    | { kind: 'group'; jid: string }
    | { kind: 'invalid'; reason: string };

const GROUP_JID = /^\d[\d-]*@g\.us$/;
const CONTACT_JID = /^\d{5,20}(:\d+)?@(s\.whatsapp\.net|lid)$/;

/**
 * Contato aceita JID (@s.whatsapp.net ou @lid) ou só os dígitos do telefone com DDI. Os dígitos são resolvidos
 * no WhatsApp antes do envio, o que também corrige o nono dígito de celulares brasileiros.
 */
export function parseRecipient(to: Recipient): ParsedRecipient {
    const value = to.externalId.trim();
    if (to.kind === 'group') {
        return GROUP_JID.test(value) ? { kind: 'group', jid: value } : { kind: 'invalid', reason: 'JID de grupo inválido' };
    }
    if (value.includes('@')) {
        const jid = value.replace(/@c\.us$/, '@s.whatsapp.net');
        if (CONTACT_JID.test(jid)) return { kind: 'contact-jid', jid };
        return { kind: 'invalid', reason: 'JID de contato inválido' };
    }
    const phone = value.replace(/\D/g, '');
    if (phone.length < 10 || phone.length > 15) return { kind: 'invalid', reason: 'telefone deve ter de 10 a 15 dígitos com DDI' };
    return { kind: 'contact-phone', phone };
}

/** 5511999990000:12@s.whatsapp.net -> 5511999990000 */
export function jidUser(jid: string | undefined): string | undefined {
    return jid?.split('@')[0]?.split(':')[0] || undefined;
}

// ---------------------------------------------------------------------------
// Queda de conexão
// ---------------------------------------------------------------------------

export type DisconnectDecision =
    | { action: 'restart' }
    | { action: 'reconnect' }
    | { action: 'stop'; status: ChannelStatus; reason: ChannelStatusReason; clearSession: boolean };

/** Códigos do DisconnectReason da Baileys. 408 vale tanto para QR expirado quanto para conexão perdida. */
export function classifyDisconnect(statusCode: number | undefined, registered: boolean): DisconnectDecision {
    switch (statusCode) {
        case 401:
            return { action: 'stop', status: 'DISCONNECTED', reason: 'LOGGED_OUT', clearSession: true };
        case 403:
            return { action: 'stop', status: 'BANNED', reason: 'BANNED', clearSession: true };
        case 440:
            // A mesma sessão foi aberta em outro lugar. Não disputa: quem abriu por último fica com ela.
            return { action: 'stop', status: 'DISCONNECTED', reason: 'CONNECTION_REPLACED', clearSession: false };
        case 411:
        case 500:
            return { action: 'stop', status: 'DISCONNECTED', reason: 'SESSION_INVALID', clearSession: true };
        case 515:
            // Normal logo depois do pareamento.
            return { action: 'restart' };
    }
    if (!registered) {
        // Ainda no QR: não fica gerando QR para sempre; o usuário pede de novo.
        const reason: ChannelStatusReason = statusCode === 408 ? 'QR_TIMEOUT' : 'CONNECTION_LOST';
        return { action: 'stop', status: 'DISCONNECTED', reason, clearSession: true };
    }
    return { action: 'reconnect' };
}

/** Backoff exponencial com jitter: 2s, 4s, 8s... até 60s. */
export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
    const base = Math.min(60_000, 2_000 * 2 ** Math.max(0, attempt - 1));
    return Math.round(base * (0.8 + random() * 0.4));
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

/** Intervalo aleatório entre envios do mesmo canal. Ritmo constante é sinal de automação. */
export function pacingDelayMs(minMs: number, maxMs: number, random: () => number = Math.random): number {
    return Math.round(minMs + random() * (maxMs - minMs));
}

/** Tempo de "digitando...", proporcional ao tamanho do texto, entre 1,5s e 5s. */
export function typingDurationMs(textLength: number): number {
    return Math.min(5_000, 1_500 + textLength * 25);
}

/** proto.WebMessageInfo.Status: 3 = DELIVERY_ACK, 4 = READ, 5 = PLAYED. */
export function receiptStatus(status: number | null | undefined): 'DELIVERED' | 'READ' | undefined {
    if (status === 3) return 'DELIVERED';
    if (status === 4 || status === 5) return 'READ';
    return undefined;
}

// ---------------------------------------------------------------------------
// Grupos
// ---------------------------------------------------------------------------

export interface GroupLike {
    id: string;
    subject: string;
    announce?: boolean;
    isCommunity?: boolean;
    size?: number;
    participants: Array<{ id: string; lid?: string; phoneNumber?: string; admin?: 'admin' | 'superadmin' | null }>;
}

export interface Me {
    id: string;
    lid?: string | undefined;
}

export function isAdmin(group: GroupLike, me: Me): boolean {
    const mine = new Set([jidUser(me.id), jidUser(me.lid)].filter(Boolean));
    return group.participants.some((p) => !!p.admin && [p.id, p.lid, p.phoneNumber].some((jid) => mine.has(jidUser(jid))));
}

export function canSendToGroup(group: GroupLike, me: Me): boolean {
    return !group.isCommunity && (!group.announce || isAdmin(group, me));
}

type GroupSummary = GroupsSyncedEvent['payload']['groups'][number];

/** Comunidades (o "pai") não recebem mensagem; ficam fora da lista. */
export function summarizeGroups(groups: GroupLike[], me: Me): GroupSummary[] {
    return groups
        .filter((g) => !g.isCommunity)
        .map((g) => {
            const admin = isAdmin(g, me);
            const announce = !!g.announce;
            return {
                externalId: g.id,
                name: g.subject,
                participantsCount: g.size ?? g.participants.length,
                isAdmin: admin,
                announce,
                canSend: !announce || admin
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}
