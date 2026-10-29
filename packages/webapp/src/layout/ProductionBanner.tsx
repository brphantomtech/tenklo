import { useMeta } from '@/hooks/useMeta';
import { useStore } from '@/store';

/**
 * A band above every dashboard page while the current environment is marked as production, so changes
 * that reach live customers never look like changes to a test environment.
 */
export const ProductionBanner: React.FC = () => {
    const env = useStore((state) => state.env);
    const { data } = useMeta();
    const isProduction = data?.data.environments.some((environment) => environment.name === env && environment.is_production);

    if (!isProduction) {
        return null;
    }

    return (
        <div
            role="status"
            className="flex h-8 shrink-0 items-center gap-2 border-b border-status-danger-border bg-status-danger-bg px-6 text-body-small-medium text-text-secondary"
        >
            <span aria-hidden className="size-2 rounded-full bg-status-danger-text" />
            <span className="font-semibold tracking-wide text-status-danger-text">PRODUCTION</span>
            <span>Changes here affect live customers.</span>
        </div>
    );
};
