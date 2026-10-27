import { Loader } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef, useState } from 'react';

import { AuthError } from '@nangohq/frontend';

import { useI18n } from '@/lib/i18n';

import type Nango from '@nangohq/frontend';
import type { AuthErrorType, AuthResult, WhatsAppQrPairing } from '@nangohq/frontend';

const POLL_INTERVAL_MS = 2000;

/** Shown in the preview, where no pairing is started. */
const PREVIEW_QR = 'tenklo-connect-ui-preview';

interface Props {
    nango: Nango | null;
    providerConfigKey: string;
    isPreview: boolean;
    onSuccess: (result: AuthResult) => void;
    onError: (type: AuthErrorType, message: string) => void;
}

/**
 * Pairs a WhatsApp number by QR code: starts a pairing, renders each QR the gateway produces, and reports the
 * connection once the phone scanned it. WhatsApp rotates the QR every ~20 seconds, so it is polled.
 */
export const WhatsAppQr: React.FC<Props> = ({ nango, providerConfigKey, isPreview, onSuccess, onError }) => {
    const { t } = useI18n();
    const [pairing, setPairing] = useState<WhatsAppQrPairing | null>(null);

    // Kept in refs so a re-render of the parent does not restart the pairing.
    const onSuccessRef = useRef(onSuccess);
    const onErrorRef = useRef(onError);
    onSuccessRef.current = onSuccess;
    onErrorRef.current = onError;

    useEffect(() => {
        if (isPreview || !nango) {
            return;
        }

        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const fail = (err: unknown) => {
            if (stopped) {
                return;
            }
            stopped = true;
            if (err instanceof AuthError && err.type === 'whatsapp_gateway_unavailable') {
                onErrorRef.current(err.type, t('whatsapp.unavailable'));
                return;
            }
            onErrorRef.current(err instanceof AuthError ? err.type : 'unknown_error', err instanceof Error ? err.message : t('whatsapp.failed'));
        };

        const poll = async (sessionId: string) => {
            try {
                const status = await nango.whatsappQrStatus(providerConfigKey, sessionId);
                if (stopped) {
                    return;
                }
                if (status.connectionId) {
                    stopped = true;
                    onSuccessRef.current({ providerConfigKey: status.providerConfigKey, connectionId: status.connectionId });
                    return;
                }
                if (status.status === 'failed') {
                    stopped = true;
                    const message =
                        status.error === 'qr_timeout' ? t('whatsapp.qrTimeout') : status.error === 'banned' ? t('whatsapp.banned') : t('whatsapp.failed');
                    onErrorRef.current('whatsapp_pairing_failed', message);
                    return;
                }
                setPairing(status);
                timer = setTimeout(() => void poll(sessionId), POLL_INTERVAL_MS);
            } catch (err) {
                fail(err);
            }
        };

        void (async () => {
            try {
                const started = await nango.whatsappQrStart(providerConfigKey);
                if (stopped) {
                    return;
                }
                setPairing(started);
                timer = setTimeout(() => void poll(started.session_id), POLL_INTERVAL_MS);
            } catch (err) {
                fail(err);
            }
        })();

        return () => {
            stopped = true;
            clearTimeout(timer);
        };
    }, [nango, providerConfigKey, isPreview, t]);

    const qr = isPreview ? PREVIEW_QR : pairing?.status === 'qr' ? pairing.qr : null;
    const linking = !isPreview && pairing?.status === 'connected';

    return (
        <div className="flex flex-col gap-6 items-center">
            <div aria-live="polite" className="w-64 h-64 p-3 rounded-md border border-subtle bg-white flex items-center justify-center">
                {qr && !linking ? (
                    <QRCodeSVG aria-label={t('whatsapp.title')} className="w-full h-full" level="L" role="img" size={232} value={qr} />
                ) : (
                    <div className="flex flex-col items-center gap-3 text-center text-sm text-gray-600">
                        <Loader aria-hidden="true" className="w-6 h-6 animate-spin" />
                        {linking ? t('whatsapp.linking') : t('whatsapp.generating')}
                    </div>
                )}
            </div>
            <div className="flex flex-col gap-2 w-full">
                <p className="font-medium text-text-primary">{t('whatsapp.title')}</p>
                <ol className="list-decimal pl-5 text-sm text-text-secondary flex flex-col gap-1">
                    <li>{t('whatsapp.step1')}</li>
                    <li>{t('whatsapp.step2')}</li>
                    <li>{t('whatsapp.step3')}</li>
                </ol>
                <p className="text-xs text-text-tertiary">{t('whatsapp.refreshes')}</p>
            </div>
        </div>
    );
};
