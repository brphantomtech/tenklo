import { FieldLabel } from '@nangohq/design-system';

import { SecretInput } from '@/components/patterns/SecretInput';

import type { WhatsAppQrCredentials } from '@nangohq/types';

export const WhatsAppQrCredentialsComponent: React.FC<{
    credentials: WhatsAppQrCredentials;
    canRead: boolean;
}> = ({ credentials, canRead }) => {
    return (
        <>
            {credentials.phone && (
                <div className="flex flex-col gap-2">
                    <FieldLabel htmlFor="phone">Phone number</FieldLabel>
                    <SecretInput id="phone" value={credentials.phone} disabled copy canRead={canRead} />
                </div>
            )}

            {credentials.name && (
                <div className="flex flex-col gap-2">
                    <FieldLabel htmlFor="name">Profile name</FieldLabel>
                    <SecretInput id="name" value={credentials.name} disabled copy canRead={canRead} />
                </div>
            )}

            <div className="flex flex-col gap-2">
                <FieldLabel htmlFor="session_id">Session ID</FieldLabel>
                <SecretInput id="session_id" value={credentials.session_id} disabled copy canRead={canRead} />
            </div>
        </>
    );
};
