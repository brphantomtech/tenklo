import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';

import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useFormField } from './ui/form';

import type { ReactNode } from '@tanstack/react-router';
import type { InputHTMLAttributes } from 'react';

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
    prefix?: ReactNode;
    suffix?: ReactNode;
    fluid?: boolean;
    /** Accessible name of the field, used to label the show/hide toggle of secret inputs. */
    fieldLabel?: string;
};

const baseWrapperClasses = 'field relative flex h-10 w-full items-center gap-1.5 overflow-hidden px-3 text-sm';
const baseInputClasses =
    'h-full w-full rounded-sm border-0 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary focus-visible:outline-none disabled:cursor-not-allowed disabled:text-text-tertiary file:border-0 file:bg-transparent file:text-sm file:font-medium';
const affixClasses = 'shrink-0 rounded-md bg-ov-2 px-1.5 py-0.5 text-body-sm text-text-secondary';

interface BaseInputProps extends InputProps {
    hasError?: boolean;
}

const BaseInput = forwardRef<HTMLInputElement, BaseInputProps>(({ className, type, prefix, suffix, fluid, hasError, fieldLabel, ...props }, forwardedRef) => {
    const ref = useRef<HTMLInputElement>(null);
    const { t } = useI18n();
    const [revealed, setRevealed] = useState(false);
    const isSecret = type === 'password';

    useImperativeHandle(forwardedRef, () => ref.current as HTMLInputElement);

    const toggleLabel = t(revealed ? 'go.hideSecret' : 'go.showSecret', { field: fieldLabel || props.placeholder || '' }).trim();

    return (
        <div
            className={cn(baseWrapperClasses, props.readOnly && 'cursor-default bg-elevated', props.disabled && 'opacity-70', isSecret && 'pr-1')}
            data-invalid={hasError ? 'true' : undefined}
            onClick={() => {
                ref.current?.focus();
            }}
        >
            {prefix && <div className={affixClasses}>{prefix}</div>}
            <input
                ref={ref}
                className={cn(baseInputClasses, (fluid || suffix) && 'w-auto grow-0 field-sizing-content', className)}
                type={isSecret && revealed ? 'text' : type}
                {...props}
            />
            {suffix && <div className={affixClasses}>{suffix}</div>}
            {isSecret && (
                <button
                    aria-label={toggleLabel}
                    aria-pressed={revealed}
                    className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-text-tertiary transition-colors hover:bg-ov-2 hover:text-text-primary focus-default"
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        setRevealed((value) => !value);
                    }}
                >
                    {revealed ? (
                        <EyeOff aria-hidden="true" className="size-4" strokeWidth={1.75} />
                    ) : (
                        <Eye aria-hidden="true" className="size-4" strokeWidth={1.75} />
                    )}
                </button>
            )}
        </div>
    );
});
BaseInput.displayName = 'BaseInput';

// until shadcn provide before/after it's going to be custom
const CustomInput = forwardRef<HTMLInputElement, InputProps>((props, forwardedRef) => {
    const { error } = useFormField();

    return <BaseInput {...props} ref={forwardedRef} hasError={Boolean(error)} />;
});
CustomInput.displayName = 'Input';

const StandaloneInput = forwardRef<HTMLInputElement, InputProps>((props, forwardedRef) => {
    return <BaseInput {...props} ref={forwardedRef} hasError={false} />;
});
StandaloneInput.displayName = 'StandaloneInput';

export { CustomInput, StandaloneInput };
