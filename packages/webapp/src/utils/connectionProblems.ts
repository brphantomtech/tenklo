import type { ApiConnectionError } from '@nangohq/types';

export interface ConnectionProblem {
    /** A few words for a badge. */
    label: string;
    /** What happened, in a sentence. */
    cause: string;
    /** Who can fix it: the customer who owns the account, or you, the developer. */
    owner: 'customer' | 'you';
    /** What fixing it takes, in a few words. */
    fix: string;
    tone: 'danger' | 'warning';
    /** The log operation that recorded it. */
    logId: string;
}

const authProblems: Record<string, Omit<ConnectionProblem, 'logId'>> = {
    token_refresh: {
        label: 'Credentials expired',
        cause: 'The provider refused to refresh the access token. The customer may have revoked access or changed their password.',
        owner: 'customer',
        fix: 'The customer reconnects',
        tone: 'danger'
    },
    connection_test: {
        label: 'Credentials stopped working',
        cause: 'The provider rejected the credentials when they were checked.',
        owner: 'customer',
        fix: 'The customer reconnects',
        tone: 'danger'
    },
    override: {
        label: 'Credentials override failed',
        cause: 'Your credentials override hook failed for this connection.',
        owner: 'you',
        fix: 'Check the logs',
        tone: 'danger'
    }
};

const unknownAuthProblem: Omit<ConnectionProblem, 'logId'> = {
    label: 'Credentials problem',
    cause: 'The credentials of this connection failed.',
    owner: 'customer',
    fix: 'The customer reconnects',
    tone: 'danger'
};

/**
 * What went wrong with a connection, in words rather than error types, or `null` when nothing did.
 * Credential problems come first: while they last, nothing else on the connection can work.
 */
export function describeConnectionProblem(errors: ApiConnectionError[]): ConnectionProblem | null {
    const auth = errors.find((error) => error.type === 'auth');
    if (auth) {
        return { ...(authProblems[auth.action] ?? unknownAuthProblem), logId: auth.log_id };
    }

    const syncs = errors.filter((error) => error.type === 'sync');
    const [first] = syncs;
    if (!first) {
        return null;
    }
    const names = syncs.map((error) => error.sync_name).filter((name): name is string => Boolean(name));
    return {
        label: syncs.length === 1 ? 'Sync failing' : `${syncs.length} syncs failing`,
        cause:
            names.length === 1 && syncs.length === 1
                ? `The “${names[0]}” sync failed on its last run.`
                : names.length > 0
                  ? `These syncs failed on their last run: ${names.join(', ')}.`
                  : 'A sync failed on its last run.',
        owner: 'you',
        fix: 'Check the logs',
        tone: 'warning',
        logId: first.log_id
    };
}

/** The log of the operation that recorded a problem. */
export const problemLogUrl = (env: string, problem: ConnectionProblem) => `/${env}/logs?operationId=${encodeURIComponent(problem.logId)}`;
