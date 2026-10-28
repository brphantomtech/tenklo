import { useState } from 'react';

import { cn } from '@/lib/utils';

const SIZES = {
    sm: 'size-10 rounded-[10px] p-2 text-sm',
    lg: 'size-14 rounded-[14px] p-2.5 text-xl'
} as const;

interface IntegrationLogoProps {
    src: string | undefined;
    name: string | null;
    size?: keyof typeof SIZES;
}

/**
 * A provider logo on a white plate — logos are drawn for light backgrounds, so the plate stays white in
 * both themes. Falls back to the provider's initial when the image is missing or fails to load.
 */
export const IntegrationLogo: React.FC<IntegrationLogoProps> = ({ src, name: rawName, size = 'sm' }) => {
    const name = rawName ?? '';
    const [failed, setFailed] = useState(false);
    const showImage = Boolean(src) && !failed;

    return (
        <div className={cn('logo-plate grid shrink-0 place-items-center overflow-hidden bg-white', SIZES[size])}>
            {showImage ? (
                <img alt={`${name} logo`} className="size-full object-contain" src={src} onError={() => setFailed(true)} />
            ) : (
                <span aria-label={`${name} logo`} className="font-semibold text-gray-800 uppercase" role="img">
                    {name.trim().charAt(0) || '?'}
                </span>
            )}
        </div>
    );
};
