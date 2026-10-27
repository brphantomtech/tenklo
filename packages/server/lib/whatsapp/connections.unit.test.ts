import { describe, expect, it } from 'vitest';

import { belongsToSession, outboundMediaKey } from './connections.js';

const TENANT = '7d0c3a52-4f7e-4d55-9b6e-2f7f4c1a9e01';
const SESSION = '1b9f0e44-0c1d-4b8a-8f3e-5a6b7c8d9e02';
const OTHER = '2c8e1f55-1d2e-4c9b-9f4a-6b7c8d9e0f13';

describe('whatsapp media keys', () => {
    const target = { tenantId: TENANT, sessionId: SESSION };

    it('uploads under the media prefix the contract accepts', () => {
        expect(outboundMediaKey({ ...target, name: 'abc' })).toBe(`tenants/${TENANT}/media/${SESSION}/abc`);
    });

    it("serves a session's received and uploaded files", () => {
        expect(belongsToSession(`tenants/${TENANT}/inbox/${SESSION}/3EB0C4F1`, target)).toBe(true);
        expect(belongsToSession(outboundMediaKey({ ...target, name: 'abc' }), target)).toBe(true);
    });

    it('refuses the files of another session or tenant, and nested paths', () => {
        expect(belongsToSession(`tenants/${TENANT}/inbox/${OTHER}/3EB0C4F1`, target)).toBe(false);
        expect(belongsToSession(`tenants/${OTHER}/media/${SESSION}/abc`, target)).toBe(false);
        expect(belongsToSession(`tenants/${TENANT}/media/${SESSION}/x/../../${OTHER}/abc`, target)).toBe(false);
        expect(belongsToSession(`tenants/${TENANT}/media/${SESSION}/`, target)).toBe(false);
    });
});
