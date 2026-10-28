/**
 * Warm the search index when the production server starts: it is built from
 * every page (~2.1k) on the first query, which takes several seconds.
 */
export function register() {
    if (process.env.NODE_ENV !== 'production' || process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return;
    const hostname = process.env.HOSTNAME;
    const host = !hostname || hostname === '0.0.0.0' || hostname === '::' ? '127.0.0.1' : hostname;
    const url = `http://${host}:${process.env.PORT ?? '3000'}/docs/api/search?query=tenklo`;
    setTimeout(() => {
        fetch(url).catch((err: unknown) => console.warn(`[search] warm-up failed: ${String(err)}`));
    }, 2000);
}
