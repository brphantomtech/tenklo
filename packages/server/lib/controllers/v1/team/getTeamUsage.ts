import * as z from 'zod';

import { environmentService, getAccountUsage, monthOf } from '@nangohq/shared';
import { zodErrorToHTTP } from '@nangohq/utils';

import { asyncWrapper } from '../../../utils/asyncWrapper.js';

import type { GetTeamUsage, LedgerMetricName } from '@nangohq/types';

const querySchema = z
    .object({
        env: z.string(),
        month: z
            .string()
            .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
            .optional()
    })
    .strict();

/** The account's usage over a month (the current one by default), across all its environments. */
export const getTeamUsage = asyncWrapper<GetTeamUsage>(async (req, res) => {
    const val = querySchema.safeParse(req.query);
    if (!val.success) {
        res.status(400).send({ error: { code: 'invalid_query_params', errors: zodErrorToHTTP(val.error) } });
        return;
    }

    const { account } = res.locals;
    const { from, to } = monthOf(val.data.month ? new Date(`${val.data.month}-01T00:00:00Z`) : new Date());

    const usage = await getAccountUsage({ accountId: account.id, from, to });
    if (!usage) {
        res.status(404).send({ error: { code: 'not_found', message: 'Unknown account' } });
        return;
    }

    const environments = await environmentService.getEnvironmentsByAccountId(account.id);
    const nameOf = new Map(environments.isOk() ? environments.value.map((e) => [e.id, e.name]) : []);

    res.status(200).send({
        data: {
            month: from.slice(0, 7),
            billingExempt: usage.billingExempt,
            metrics: usage.metrics as Record<LedgerMetricName, number>,
            environments: usage.environments.map((e) => ({ name: nameOf.get(e.environmentId) ?? String(e.environmentId), metrics: e.metrics }))
        }
    });
});
