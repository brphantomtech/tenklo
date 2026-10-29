/** Which connections the list shows, by health. */
export const views = ['attention', 'healthy', 'all'] as const;
export type View = (typeof views)[number];

/** Narrows a view further. */
export type StatusFilterValue = 'auth_error' | 'sync_error' | 'paused';

/**
 * The view the list shows: the one in the URL; else the one an older `?status=ok|error` link meant;
 * else what needs attention when anything does, and everything otherwise. `null` while the counts that
 * decide the default load, so the list doesn't load twice.
 */
export function resolveView({
    viewParam,
    rawStatusFilters,
    counts
}: {
    viewParam: View | null;
    rawStatusFilters: string[];
    counts: { withError: number } | null;
}): View | null {
    if (viewParam) return viewParam;
    if (rawStatusFilters.includes('error')) return 'attention';
    if (rawStatusFilters.includes('ok')) return 'healthy';
    if (!counts) return null;
    return counts.withError > 0 ? 'attention' : 'all';
}

/** The server-side error filter for a view and its status filters; the status filters themselves apply in the page. */
export function withErrorFor(view: View | null, statusFilters: StatusFilterValue[]): boolean | undefined {
    if (view === 'attention') return true;
    if (view === 'healthy') return false;
    const hasErrorFilter = statusFilters.some((s) => s === 'auth_error' || s === 'sync_error');
    if (hasErrorFilter && !statusFilters.includes('paused')) return true;
    return undefined;
}
