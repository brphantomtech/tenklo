import { afterEach, describe, expect, it, vi } from 'vitest';

import { mask, silenceSignalSessionDumps } from './logger.js';

import type { Logger } from './logger.js';

describe('silenceSignalSessionDumps', () => {
    const originals = { info: console.info, warn: console.warn, log: console.log };
    afterEach(() => {
        Object.assign(console, originals);
    });

    it('turns the libsignal session dumps into debug lines, without the keys', () => {
        const info = vi.fn();
        console.info = info;
        const logger = { debug: vi.fn() } as unknown as Logger;
        silenceSignalSessionDumps(logger);

        console.info('Closing session:', { currentRatchet: { ephemeralKeyPair: { privKey: Buffer.from([1, 2, 3]) } } });

        expect(info).not.toHaveBeenCalled();
        expect(logger.debug).toHaveBeenCalledWith({ component: 'libsignal' }, 'Closing session');
    });

    it('leaves the other console messages alone', () => {
        const warn = vi.fn();
        console.warn = warn;
        silenceSignalSessionDumps({ debug: vi.fn() } as unknown as Logger);

        console.warn('something else', 1);

        expect(warn).toHaveBeenCalledWith('something else', 1);
    });
});

describe('mask', () => {
    it('masks the middle of a phone JID', () => {
        expect(mask('5511999990000@s.whatsapp.net')).toBe('5511****0000@s.whatsapp.net');
    });
});
