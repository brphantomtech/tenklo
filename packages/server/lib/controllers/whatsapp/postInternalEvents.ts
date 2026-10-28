import { stringTimingSafeEqual, zodErrorToHTTP } from '@nangohq/utils';

import { asyncWrapper } from '../../utils/asyncWrapper.js';
import { gatewayEventSchema, handleGatewayEvent } from '../../whatsapp/events.js';
import { gatewayConfig } from '../../whatsapp/gateway.js';

import type { GatewayKind } from '../../whatsapp/gateway.js';
import type { PostInternalWhatsAppEvent } from '@nangohq/types';

/** Receives the events of a channel gateway, authenticated by the secret they share. */
function postInternalGatewayEvent(kind: GatewayKind) {
    return asyncWrapper<PostInternalWhatsAppEvent>(async (req, res) => {
        const secret = gatewayConfig(kind)?.secret;
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
}

export const postInternalWhatsAppEvent = postInternalGatewayEvent('whatsapp');
export const postInternalTelegramEvent = postInternalGatewayEvent('telegram');
