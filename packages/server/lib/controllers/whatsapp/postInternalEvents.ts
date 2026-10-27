import { stringTimingSafeEqual, zodErrorToHTTP } from '@nangohq/utils';

import { envs } from '../../env.js';
import { asyncWrapper } from '../../utils/asyncWrapper.js';
import { gatewayEventSchema, handleGatewayEvent } from '../../whatsapp/events.js';

import type { PostInternalWhatsAppEvent } from '@nangohq/types';

/** Receives the events of the whatsapp-gateway, authenticated by the secret they share. */
export const postInternalWhatsAppEvent = asyncWrapper<PostInternalWhatsAppEvent>(async (req, res) => {
    const secret = envs.WHATSAPP_GATEWAY_SECRET;
    const received = req.get('authorization')?.split('Bearer ').pop();
    if (!secret || !received || !stringTimingSafeEqual(received, secret)) {
        res.status(401).send({ error: { code: 'unauthorized' } });
        return;
    }

    const val = gatewayEventSchema.safeParse(req.body);
    if (!val.success) {
        res.status(400).send({ error: { code: 'invalid_body', errors: zodErrorToHTTP(val.error) } });
        return;
    }

    await handleGatewayEvent(val.data);
    res.status(204).send();
});
