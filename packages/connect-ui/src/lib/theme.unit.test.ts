import { describe, expect, it } from 'vitest';

import { onPrimaryColor } from './theme.js';

describe('onPrimaryColor', () => {
    it('puts ink on the default Tenklo brand cyan, where white would fail AA', () => {
        expect(onPrimaryColor('#00B2E3')).toBe('#0b0b0c');
    });

    it('keeps white on dark or saturated primaries', () => {
        expect(onPrimaryColor('#7c3aed')).toBe('#ffffff');
        expect(onPrimaryColor('#007ca0')).toBe('#ffffff');
        expect(onPrimaryColor('#000')).toBe('#ffffff');
    });

    it('puts ink on light primaries', () => {
        expect(onPrimaryColor('#f59e0b')).toBe('#0b0b0c');
        expect(onPrimaryColor('#ffffff')).toBe('#0b0b0c');
    });

    it('falls back to white for a value it cannot parse', () => {
        expect(onPrimaryColor('not-a-color')).toBe('#ffffff');
    });
});
