import { requireEmptyQuery, zodErrorToHTTP } from '@nangohq/utils';

import { asyncWrapperWithEnvironment } from '../../utils/asyncWrapper.js';
import { resolveConnectionFromHeaders } from '../../whatsapp/connections.js';
import { getSessionStatus } from '../../whatsapp/status.js';
import { sendWhatsAppApiError } from './utils.js';

import type { GetPublicWhatsAppStatus } from '@nangohq/types';

/** The last status the gateway reported for a whatsapp-web connection's number. */
export const getPublicWhatsAppStatus = asyncWrapperWithEnvironment<GetPublicWhatsAppStatus>(async (req, res) => {
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

    res.status(200).send(await getSessionStatus(resolved.value.sessionId));
});
