import { describe, expect, it } from 'vitest';

import { phoneOfJid } from './postSessionsImport.js';

describe('phoneOfJid', () => {
    it("takes the number of a paired device's JID", () => {
        expect(phoneOfJid('5511999990000:12@s.whatsapp.net')).toBe('5511999990000');
        expect(phoneOfJid('5511999990000@s.whatsapp.net')).toBe('5511999990000');
    });

    it('has no number for a LID or a malformed JID', () => {
        expect(phoneOfJid('abc@lid')).toBeNull();
        expect(phoneOfJid('')).toBeNull();
    });
});
