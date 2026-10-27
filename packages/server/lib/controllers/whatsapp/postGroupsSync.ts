import { getLogger, requireEmptyQuery, zodErrorToHTTP } from '@nangohq/utils';

import { asyncWrapperWithEnvironment } from '../../utils/asyncWrapper.js';
import { resolveConnectionFromHeaders } from '../../whatsapp/connections.js';
import { sendGatewayCommand } from '../../whatsapp/gateway.js';
import { sendGatewayUnavailable, sendWhatsAppApiError } from './utils.js';

import type { PostPublicWhatsAppGroupsSync } from '@nangohq/types';

const logger = getLogger('WhatsApp.Groups');

/** Asks for the groups of a whatsapp-web connection's number. They arrive in a groups.synced webhook. */
export const postPublicWhatsAppGroupsSync = asyncWrapperWithEnvironment<PostPublicWhatsAppGroupsSync>(async (req, res) => {
    const emptyQuery = requireEmptyQuery(req);
    if (emptyQuery) {
        res.status(400).send({ error: { code: 'invalid_query_params', errors: zodErrorToHTTP(emptyQuery.error) } });
        return;
    }

    const { account, environment } = res.locals;
    const resolved = await resolveConnectionFromHeaders({ headers: req.headers, account, environment });
    if (resolved.isErr()) {
        sendWhatsAppApiError(res, resolved.error);
        return;
    }

    const sent = await sendGatewayCommand({ tenantId: environment.uuid, channelId: resolved.value.sessionId }, { type: 'groups.sync', payload: {} });
    if (sent.isErr()) {
        logger.error('failed to ask the gateway for the WhatsApp groups', sent.error);
        sendGatewayUnavailable(res);
        return;
    }

    res.status(202).send({ commandId: sent.value.commandId });
});
