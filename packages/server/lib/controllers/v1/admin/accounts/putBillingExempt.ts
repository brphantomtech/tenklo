import * as z from 'zod';

import { setBillingExempt } from '@nangohq/shared';
import { zodErrorToHTTP } from '@nangohq/utils';

import { envs } from '../../../../env.js';
import { asyncWrapper } from '../../../../utils/asyncWrapper.js';

import type { PutAdminBillingExempt } from '@nangohq/types';

const paramsSchema = z.object({ accountId: z.coerce.number().int().nonnegative() }).strict();
const bodySchema = z.object({ exempt: z.boolean() }).strict();

/** Keeps an account free forever, or charges it again. Only the admin team can, and the usage keeps being measured. */
export const putBillingExempt = asyncWrapper<PutAdminBillingExempt>(async (req, res) => {
    const { account } = res.locals;
    if (!envs.NANGO_ADMIN_UUID || account.uuid !== envs.NANGO_ADMIN_UUID) {
        res.status(403).send({ error: { code: 'forbidden', message: 'Only the admin team can change billing exemptions' } });
        return;
    }

    const params = paramsSchema.safeParse(req.params);
    if (!params.success) {
        res.status(400).send({ error: { code: 'invalid_uri_params', errors: zodErrorToHTTP(params.error) } });
        return;
    }
    const body = bodySchema.safeParse(req.body);
    if (!body.success) {
        res.status(400).send({ error: { code: 'invalid_body', errors: zodErrorToHTTP(body.error) } });
        return;
    }

    const updated = await setBillingExempt({ accountId: params.data.accountId, exempt: body.data.exempt });
    if (!updated) {
        res.status(404).send({ error: { code: 'unknown_account', message: 'Unknown account' } });
        return;
    }

    res.status(200).send({ data: { accountId: params.data.accountId, billingExempt: body.data.exempt } });
});
