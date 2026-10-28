import { LoaderCircle } from 'lucide-react';
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

    const steps = [t('whatsapp.step1'), t('whatsapp.step2'), t('whatsapp.step3')];

    return (
        <div className="flex flex-col items-center gap-5">
            <div className="flex flex-col items-center gap-3">
                {/* Viewfinder: the QR sits on a white plate (scanners need it) framed by primary corners. */}
                <div className="relative p-2">
                    {[
                        'top-0 left-0 border-t-2 border-l-2 rounded-tl-xl',
                        'top-0 right-0 border-t-2 border-r-2 rounded-tr-xl',
                        'bottom-0 left-0 border-b-2 border-l-2 rounded-bl-xl',
                        'bottom-0 right-0 border-r-2 border-b-2 rounded-br-xl'
                    ].map((corner) => (
                        <span key={corner} aria-hidden="true" className={`absolute size-6 border-primary ${corner}`} />
                    ))}
                    <div aria-live="polite" className="logo-plate grid size-[196px] place-items-center rounded-xl bg-white p-3">
                        {qr && !linking ? (
                            <QRCodeSVG aria-label={t('whatsapp.title')} className="size-full animate-rise" level="L" role="img" size={172} value={qr} />
                        ) : (
                            <div className="flex flex-col items-center gap-3 px-4 text-center text-body-sm text-gray-700">
                                <LoaderCircle aria-hidden="true" className="size-6 animate-spin text-gray-500" />
                                {linking ? t('whatsapp.linking') : t('whatsapp.generating')}
                            </div>
                        )}
                    </div>
                </div>
                <p className="flex items-center gap-2 text-micro text-text-tertiary">
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-primary animate-soft-pulse" />
                    {t('whatsapp.refreshes')}
                </p>
            </div>

            <div className="flex w-full flex-col gap-3 rounded-xl border border-hairline bg-elevated p-4">
                <p className="text-body font-medium text-text-primary">{t('whatsapp.title')}</p>
                <ol className="flex flex-col gap-2.5">
                    {steps.map((step, index) => (
                        <li key={index} className="flex items-start gap-2.5 text-body-sm text-text-secondary">
                            <span
                                aria-hidden="true"
                                className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-ov-3 text-[11px] font-semibold text-text-primary tabular-nums"
                            >
                                {index + 1}
                            </span>
                            <span>{step}</span>
                        </li>
                    ))}
                </ol>
            </div>
        </div>
    );
};
