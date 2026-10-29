import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';

import DashboardLayout from '../../layout/DashboardLayout';
import { useStore } from '../../store';
import { globalEnv } from '../../utils/env';
import { HealthSummary } from './components/HealthSummary';
import { InsightChart } from './components/InsightChart';
import { SetupProgress } from './components/SetupProgress';

/**
 * The environment's home: its health first (what needs attention), then integrations still being set up,
 * then the last 14 days of activity.
 */
export const Homepage: React.FC = () => {
    const env = useStore((state) => state.env);

    return (
        <DashboardLayout>
            <Helmet>
                <title>Home - Tenklo</title>
            </Helmet>
            <div className="flex flex-col gap-10">
                <HealthSummary env={env} />
                <SetupProgress env={env} />
                <section aria-labelledby="activity-title" className="flex flex-col gap-6">
                    <div className="flex items-baseline justify-between">
                        <h2 id="activity-title" className="text-heading-medium text-text-strong">
                            Activity
                        </h2>
                        <div className="text-text-strong text-sm">
                            Last 14 days <code className="font-code text-xs text-text-secondary">(UTC)</code>
                        </div>
                    </div>
                    {globalEnv.features.logs ? <ActivityCharts /> : <LogsNotConfigured />}
                </section>
            </div>
        </DashboardLayout>
    );
};

const LogsNotConfigured: React.FC = () => (
    <div className="flex gap-2 flex-col border border-border-muted rounded-md items-center text-text-strong text-center p-10 py-20">
        <h3 className="text-xl text-center">Logs not configured</h3>
        <div className="text-sm text-text-muted">
            Follow{' '}
            <Link to="https://docs.tenklo.dev/guides/platform/self-hosting#logs" className="text-text-link">
                these instructions
            </Link>{' '}
            to configure logs and enable execution metrics in your dashboard.
        </div>
    </div>
);

const ActivityCharts: React.FC = () => (
    <div className="grid gap-8 grid-cols-[repeat(auto-fill,minmax(300px,470px))]">
        {globalEnv.features.scripts && (
            <InsightChart
                title="Sync Executions"
                type="sync:run"
                desc=""
                help={
                    <div>
                        No sync executions in the last 14 days.{' '}
                        <Link to="https://docs.tenklo.dev/guides/functions/syncs/sync-functions" className="underline text-text-strong">
                            Learn more
                        </Link>
                    </div>
                }
            />
        )}
        {globalEnv.features.scripts && (
            <InsightChart
                title="Action Executions"
                type="action"
                desc=""
                help={
                    <div>
                        No action executions in the last 14 days.{' '}
                        <Link to="https://docs.tenklo.dev/guides/functions/action-functions" className="underline text-text-strong">
                            Learn more
                        </Link>
                    </div>
                }
            />
        )}
        <InsightChart
            title="Proxy Requests"
            type="proxy"
            desc=""
            help={
                <div>
                    No proxy requests sent in the last 14 days.{' '}
                    <Link to="https://docs.tenklo.dev/guides/platform/proxy-requests" className="underline text-text-strong">
                        Learn more
                    </Link>
                </div>
            }
        />
        {globalEnv.features.scripts && (
            <InsightChart
                title="Webhook Executions"
                type="webhook:incoming"
                desc=""
                help={
                    <div>
                        No webhook executions in the last 14 days.{' '}
                        <Link to="https://docs.tenklo.dev/getting-started/use-cases/webhooks-from-external-apis" className="underline text-text-strong">
                            Learn more
                        </Link>
                    </div>
                }
            />
        )}
        <InsightChart
            title="Authorization"
            type="auth:create_connection"
            desc=""
            help={
                <div>
                    No authorization attempted in the last 14 days.{' '}
                    <Link to="https://docs.tenklo.dev/guides/auth/auth-guide" className="underline text-text-strong">
                        Learn more
                    </Link>
                </div>
            }
        />
    </div>
);
