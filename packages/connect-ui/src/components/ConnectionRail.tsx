import { Check, LockKeyhole, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { IntegrationLogo } from './IntegrationLogo';

export type RailState = 'idle' | 'connecting' | 'connected' | 'failed';

interface ConnectionRailProps {
    logo: string | undefined;
    name: string | null;
    state: RailState;
}

/**
 * The signature of Connect UI: the integration on one side, a secured endpoint on the other, and the
 * link between them. Its state follows the connection — waiting, in flight, made, or broken.
 */
export const ConnectionRail: React.FC<ConnectionRailProps> = ({ logo, name, state }) => {
    return (
        <div className="flex items-center justify-center" data-state={state}>
            <IntegrationLogo name={name} size="lg" src={logo} />

            <div aria-hidden="true" className="relative mx-2 h-6 w-14 sm:w-16">
                {/* Resting track: a dotted hairline */}
                <span className={cn('absolute inset-x-0 top-1/2 -translate-y-1/2 rail-track', state === 'failed' && 'rail-track-error')} />
                {/* Made link: a solid line drawn from the integration to the endpoint */}
                {state === 'connected' && (
                    <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-primary origin-left animate-rail-draw" />
                )}
                {/* Signal travelling across while a connection is in flight */}
                {state === 'connecting' && <span className="absolute top-1/2 left-0 size-2 -translate-y-1/2 rounded-full bg-primary animate-rail-signal" />}
                {state === 'idle' && <span className="absolute top-1/2 left-1/2 size-1.5 -translate-1/2 rounded-full bg-primary" />}
            </div>

            <div
                aria-hidden="true"
                className={cn(
                    'grid size-14 shrink-0 place-items-center rounded-[14px] border transition-colors duration-300',
                    state === 'connected' ? 'border-transparent bg-primary text-on-primary animate-pop' : 'border-hairline bg-elevated text-text-secondary',
                    state === 'failed' && 'border-error-border bg-error-soft text-error'
                )}
            >
                {state === 'connected' ? (
                    <Check className="size-6" strokeWidth={2.25} />
                ) : state === 'failed' ? (
                    <X className="size-5" strokeWidth={2} />
                ) : (
                    <LockKeyhole className={cn('size-[22px]', state === 'connecting' && 'animate-soft-pulse')} strokeWidth={1.75} />
                )}
            </div>
        </div>
    );
};
