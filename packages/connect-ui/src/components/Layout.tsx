import { Outlet } from '@tanstack/react-router';
import { FocusTrap } from 'focus-trap-react';
import { ShieldCheck } from 'lucide-react';
import { useRef } from 'react';
import { useClickAway, useKeyPressEvent } from 'react-use';

import { triggerClose } from '@/lib/events';
import { useI18n } from '@/lib/i18n';
import { useGlobal } from '@/lib/store';
import { useAppliedTheme } from '@/lib/theme';
import NangoLogoSVG from '@/svg/logo.svg?react';
import { ThemePendingSpinner } from './ThemePendingSpinner';

import type { FocusTrapProps } from 'focus-trap-react';

// focus-trap-react re-exports its option type only as the prop's type, not a named export.
type FocusTrapOptions = NonNullable<FocusTrapProps['focusTrapOptions']>;

// Trap focus inside the dialog while leaving Layout's own Escape / click-away close handlers in
// charge: don't deactivate on Escape, and let outside clicks through. On open, move focus onto the
// dialog's scroll container so keyboard/SR users land inside the dialog — and, because Connect UI
// renders inside an iframe, focusing an element within it is what pulls focus into the iframe at all.
// initialFocus / fallbackFocus must resolve to a REAL focusable element inside the trap: the
// `display:contents` wrapper below has no layout box and cannot receive focus, so both point at the
// scroll container (tabIndex=-1), not the wrapper.
const focusTrapOptions = {
    escapeDeactivates: false,
    allowOutsideClick: true,
    initialFocus: '#connect-ui-dialog-content',
    fallbackFocus: '#connect-ui-dialog-content'
} satisfies FocusTrapOptions;

export const Layout: React.FC = () => {
    const ref = useRef<HTMLDivElement>(null);

    const { isEmbedded, settings, isAuthLink } = useGlobal();
    const { t } = useI18n();
    const { isPending } = useAppliedTheme();
    const showWatermark = settings?.showWatermark ?? false;
    // Hide the dialog rather than skip rendering it: the code inside fetches the theme.
    const themePendingClass = isPending ? 'opacity-0' : '';

    useClickAway(ref, (event: MouseEvent | TouchEvent) => {
        if (isPending) return;

        const target = event.target instanceof Element ? event.target : null;

        if (target?.closest('[data-slot="select-content"]')) return;

        if (target === document.documentElement) {
            const rect = ref.current?.getBoundingClientRect();
            if (rect) {
                const point = 'changedTouches' in event ? event.changedTouches[0] : event;
                if (point.clientX >= rect.left && point.clientX <= rect.right && point.clientY >= rect.top && point.clientY <= rect.bottom) {
                    return;
                }
            }
        }

        triggerClose('click:outside');
    });

    useKeyPressEvent('Escape', () => {
        triggerClose('click:outside');
    });

    const content = (
        <FocusTrap active={!isPending} focusTrapOptions={focusTrapOptions}>
            <div className="contents">
                <div className="w-full flex-1 overflow-y-auto outline-none" id="connect-ui-dialog-content" tabIndex={-1}>
                    <div className="mx-auto flex min-h-full w-full max-w-[460px] flex-col px-5 pt-3 pb-6 sm:px-7">
                        <Outlet />
                    </div>
                </div>
                {showWatermark && (
                    <div className="flex shrink-0 items-center justify-center border-t border-hairline px-5 py-2.5">
                        <a
                            className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-micro text-text-tertiary transition-colors hover:text-text-secondary focus-default"
                            href="https://www.tenklo.dev?utm_source=connectui"
                            rel="noopener noreferrer"
                            target="_blank"
                        >
                            <ShieldCheck aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
                            {t('common.securedBy')}
                            <NangoLogoSVG aria-hidden="true" className="ml-0.5 inline-block h-3.5 w-auto text-text-secondary" />
                            <span className="sr-only">Tenklo</span>
                        </a>
                    </div>
                )}
            </div>
        </FocusTrap>
    );

    if (isEmbedded) {
        // Embedded in the host's own container (e.g. a dialog): fill the frame edge to edge and let the
        // host own the outer shape, keeping the content in a readable column.
        return (
            <>
                <div
                    ref={ref}
                    aria-label={t('common.dialogLabel')}
                    aria-labelledby="connect-ui-title"
                    aria-modal="true"
                    className={`flex h-screen w-screen flex-col overflow-hidden bg-surface text-text-primary transition-opacity duration-200 ${themePendingClass}`}
                    id="connect-ui-dialog"
                    role="dialog"
                    tabIndex={-1}
                >
                    {content}
                </div>
                {isPending && <ThemePendingSpinner />}
            </>
        );
    }

    return (
        <>
            <div
                className={`absolute flex h-screen w-screen flex-col items-center justify-center overflow-hidden sm:p-10 ${isAuthLink ? 'bg-canvas' : 'bg-scrim'}`}
            >
                <div
                    ref={ref}
                    aria-label={t('common.dialogLabel')}
                    aria-labelledby="connect-ui-title"
                    aria-modal="true"
                    className={`flex h-full w-full flex-col overflow-hidden bg-surface text-text-primary transition-opacity duration-200 sm:h-[min(680px,100%)] sm:w-[460px] sm:rounded-[20px] sm:shadow-dialog sm:ring-1 sm:ring-hairline ${themePendingClass}`}
                    id="connect-ui-dialog"
                    role="dialog"
                    tabIndex={-1}
                >
                    {content}
                </div>
            </div>
            {isPending && <ThemePendingSpinner />}
        </>
    );
};
