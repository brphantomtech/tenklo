import { describe, expect, it } from 'vitest';

import { resolveView, withErrorFor } from './views';

describe('resolveView', () => {
    it('opens on what needs attention when anything does', () => {
        expect(resolveView({ viewParam: null, rawStatusFilters: [], counts: { withError: 3 } })).toBe('attention');
        expect(resolveView({ viewParam: null, rawStatusFilters: [], counts: { withError: 0 } })).toBe('all');
    });

    it('waits for the counts before picking the default', () => {
        expect(resolveView({ viewParam: null, rawStatusFilters: [], counts: null })).toBeNull();
    });

    it('keeps the view from the URL', () => {
        expect(resolveView({ viewParam: 'healthy', rawStatusFilters: ['error'], counts: { withError: 3 } })).toBe('healthy');
    });

    it('reads older status links as views', () => {
        expect(resolveView({ viewParam: null, rawStatusFilters: ['error'], counts: null })).toBe('attention');
        expect(resolveView({ viewParam: null, rawStatusFilters: ['ok'], counts: null })).toBe('healthy');
    });
});

describe('withErrorFor', () => {
    it('filters on the server by the view', () => {
        expect(withErrorFor('attention', [])).toBe(true);
        expect(withErrorFor('healthy', [])).toBe(false);
        expect(withErrorFor('all', [])).toBeUndefined();
    });

    it('asks for errored connections when every status filter is an error', () => {
        expect(withErrorFor('all', ['auth_error', 'sync_error'])).toBe(true);
        expect(withErrorFor('all', ['auth_error', 'paused'])).toBeUndefined();
    });
});
