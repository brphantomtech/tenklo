import { Link } from '@tanstack/react-router';
import { ArrowLeft, X } from 'lucide-react';

import { triggerClose } from '@/lib/events';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export interface FlowStep {
    current: number;
    total: number;
}

interface HeaderButtonsProps extends React.HTMLAttributes<HTMLDivElement> {
    onClickClose?: () => void;
    backLink?: string;
    onClickBack?: () => void;
    isAuthLink?: boolean;
    /** Where this view sits in the connect flow, shown as a segmented progress. */
    step?: FlowStep;
}

export const HeaderButtons: React.FC<HeaderButtonsProps> = ({
    onClickClose = () => triggerClose('click:close'),
    backLink,
    onClickBack,
    isAuthLink,
    step,
    className,
    ...props
}) => {
    const { t } = useI18n();

    return (
        <header {...props} className={cn('grid h-11 shrink-0 grid-cols-[1fr_auto_1fr] items-center', className)}>
            <div className="justify-self-start">
                {backLink && (
                    <Link
                        className="-ml-2 inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-body-sm font-medium text-text-secondary transition-colors hover:bg-ov-2 hover:text-text-primary focus-default"
                        to={backLink}
                        onClick={onClickBack}
                    >
                        <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.75} />
                        {t('common.back')}
                    </Link>
                )}
            </div>

            <div className="justify-self-center">{step && <StepProgress step={step} />}</div>

            <div className="justify-self-end">
                {!isAuthLink && (
                    <button
                        aria-label={t('common.close')}
                        className="-mr-2 grid size-8 cursor-pointer place-items-center rounded-lg text-text-tertiary transition-colors hover:bg-ov-2 hover:text-text-primary focus-default"
                        type="button"
                        onClick={onClickClose}
                    >
                        <X aria-hidden="true" className="size-[18px]" strokeWidth={1.75} />
                    </button>
                )}
            </div>
        </header>
    );
};

const StepProgress: React.FC<{ step: FlowStep }> = ({ step }) => {
    const { t } = useI18n();

    return (
        <p className="flex items-center gap-1">
            <span className="sr-only">{t('common.step', { current: step.current, total: step.total })}</span>
            {Array.from({ length: step.total }, (_, index) => {
                const position = index + 1;
                return (
                    <span
                        key={position}
                        aria-hidden="true"
                        className={cn(
                            'h-1 rounded-full transition-[width,background-color] duration-500 ease-out',
                            position === step.current ? 'w-6 bg-primary' : 'w-3',
                            position < step.current && 'bg-primary opacity-45',
                            position > step.current && 'bg-ov-3'
                        )}
                    />
                );
            })}
        </p>
    );
};
