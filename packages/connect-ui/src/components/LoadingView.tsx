import { useI18n } from '@/lib/i18n';
import { HeaderButtons } from './HeaderButtons';
import { Skeleton } from './ui/skeleton';

export const LoadingView: React.FC = () => {
    const { t } = useI18n();

    return (
        <div aria-label={t('common.loading')} className="flex-1" role="status">
            <HeaderButtons />
            <div className="flex flex-col gap-5 pt-5">
                <div className="flex flex-col gap-2.5">
                    <Skeleton className="h-6 w-1/2" />
                    <Skeleton className="h-4 w-4/5" />
                </div>
                <div className="flex flex-col divide-y divide-hairline overflow-hidden rounded-xl border border-hairline">
                    {[0.62, 0.48, 0.7, 0.4].map((width) => (
                        <div key={width} className="flex items-center gap-3.5 px-3.5 py-3">
                            <Skeleton className="size-10 rounded-[10px]" />
                            <Skeleton className="h-3.5" style={{ width: `${width * 100}%` }} />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
