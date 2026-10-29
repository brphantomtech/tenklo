import { describe, expect, it } from 'vitest';

import { formatUsage, lastMonths } from './usageRows';

describe('formatUsage', () => {
    it('shows counts as they are and averages with one decimal', () => {
        expect(formatUsage(1234, 'count')).toBe('1,234');
        expect(formatUsage(2.5, 'count')).toBe('2.5');
    });

    it('shows bytes in the largest unit that keeps them above one', () => {
        expect(formatUsage(512, 'bytes')).toBe('512 B');
        expect(formatUsage(1_500_000, 'bytes')).toBe('1.5 MB');
        expect(formatUsage(2_000_000_000, 'bytes')).toBe('2 GB');
    });
});

describe('lastMonths', () => {
    it('counts back across the year', () => {
        expect(lastMonths(new Date('2026-02-10T00:00:00Z'), 3)).toEqual(['2026-02', '2026-01', '2025-12']);
    });
});
