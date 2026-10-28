import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils.js';

import type { VariantProps } from 'class-variance-authority';

// Solid primary, no gradient or glow: hover deepens a step toward the ink, press sinks 1px.
const buttonVariants = cva(
    'relative inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap font-medium tracking-[-0.005em] transition-[background-color,border-color,color,translate] duration-150 ease-out focus-default active:translate-y-px disabled:pointer-events-none disabled:opacity-45',
    {
        variants: {
            variant: {
                default:
                    'bg-primary text-on-primary shadow-card hover:bg-primary-hover disabled:opacity-100 [&:disabled:not([aria-busy])]:bg-ov-3 [&:disabled:not([aria-busy])]:text-text-tertiary [&:disabled:not([aria-busy])]:shadow-none',
                secondary: 'border border-hairline-strong bg-surface text-text-primary shadow-card hover:border-hairline-hover hover:bg-ov-1',
                transparent: 'text-text-tertiary hover:text-text-primary focus:text-text-primary'
            },
            size: {
                default: 'h-10 rounded-[10px] px-4 text-sm',
                sm: 'h-8 rounded-lg px-3 text-[13px]',
                lg: 'h-11 rounded-[10px] px-5 text-[15px]',
                icon: 'size-8 rounded-lg'
            }
        },
        defaultVariants: {
            variant: 'default',
            size: 'default'
        }
    }
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
    asChild?: boolean;
    loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, loading, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
        <Comp
            ref={ref}
            aria-busy={loading || undefined}
            className={cn(buttonVariants({ variant, size, className }))}
            {...props}
            disabled={loading || props.disabled}
        >
            {loading && <LoaderCircle aria-hidden="true" className="animate-spin" size={16} />}
            {children}
        </Comp>
    );
});
Button.displayName = 'Button';

export { Button, buttonVariants };
