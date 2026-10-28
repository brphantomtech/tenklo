import { TriangleAlert } from 'lucide-react';
import { useMount } from 'react-use';

import { APIError } from '@/lib/api';
import { telemetry } from '@/lib/telemetry';
import { HeaderButtons } from './HeaderButtons';

function errorMessage(error: unknown, message?: string): string {
    if (message) {
        return message;
    }
    if (error instanceof APIError && error.details.res.status === 401) {
        return 'Your session has expired, please refresh the modal';
    }
    return 'An error occurred. Please refresh your page or contact our support.';
}

const ErrorMsg: React.FC<{ error?: unknown; message?: string }> = ({ error, message }) => {
    return (
        <div className="flex flex-col items-center gap-4 px-4 text-center animate-rise">
            <div aria-hidden="true" className="grid size-12 place-items-center rounded-2xl border border-error-border bg-error-soft text-error">
                <TriangleAlert className="size-5" strokeWidth={1.75} />
            </div>
            <p className="max-w-[34ch] text-body text-text-primary" role="alert">
                {errorMessage(error, message)}
            </p>
        </div>
    );
};

export const ErrorFallback: React.FC<{ error?: unknown; message?: string }> = ({ error, message }) => {
    useMount(() => {
        if (!message) {
            telemetry('view:unknown_error');
        }
    });
    return (
        <div className="flex h-full w-full flex-1 flex-col">
            <HeaderButtons />
            <div className="relative flex flex-1 flex-col justify-center py-10">
                <ErrorMsg error={error} message={message} />
            </div>
        </div>
    );
};

export const ErrorFallbackGlobal: React.FC = () => {
    return (
        <div className="absolute flex h-screen w-screen items-center justify-center overflow-hidden bg-scrim sm:p-10">
            <div className="relative flex h-full w-full flex-col overflow-hidden bg-surface px-5 pt-3 pb-6 text-text-primary sm:h-[min(680px,100%)] sm:w-[460px] sm:rounded-[20px] sm:px-7 sm:shadow-dialog">
                <ErrorFallback />
            </div>
        </div>
    );
};
