import type { ApiTeam, DBTeam } from '@nangohq/types';

export function teamToApi({ has_baa: _hasBaa, billing_exempt: _billingExempt, ...team }: DBTeam): ApiTeam {
    return {
        ...team,
        created_at: team.created_at.toISOString(),
        updated_at: team.updated_at.toISOString()
    };
}
