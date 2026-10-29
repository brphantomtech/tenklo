import { useQuery } from '@tanstack/react-query';

import { APIError, apiFetch } from '../utils/api';

import type { GetTeamUsage } from '@nangohq/types';

export function useTeamUsage(env: string, month?: string) {
    return useQuery<GetTeamUsage['Success'], APIError>({
        queryKey: ['team', env, 'usage', month ?? 'current'],
        queryFn: async () => {
            const query = new URLSearchParams({ env, ...(month ? { month } : {}) });
            const res = await apiFetch(`/api/v1/team/usage?${query.toString()}`, { method: 'GET' });
            const json = (await res.json()) as GetTeamUsage['Reply'];
            if (!res.ok || 'error' in json) {
                throw new APIError({ res, json });
            }
            return json;
        },
        enabled: Boolean(env)
    });
}
