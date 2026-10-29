import { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { useTeamUsage } from '@/hooks/useTeamUsage';
import { useStore } from '@/store';
import { ErrorPageComponent } from '../../../components/patterns/ErrorComponent';
import DashboardLayout from '../../../layout/DashboardLayout';
import { formatUsage, lastMonths, USAGE_ROWS } from './usageRows';

import type { ApiError } from '@nangohq/types';

/** What the account used in a month, across its environments. Measured for every account, charged or not. */
export const TeamUsage: React.FC = () => {
    const env = useStore((state) => state.env);
    const months = useMemo(() => lastMonths(new Date(), 12), []);
    const [month, setMonth] = useState(months[0] ?? '');
    const { data, error, isLoading } = useTeamUsage(env, month);

    if (error) {
        return <ErrorPageComponent title="Usage" error={error.json as ApiError<string>} />;
    }

    const usage = data?.data;

    return (
        <DashboardLayout fullWidth title="Usage" className="flex flex-col gap-6 max-w-7xl mx-0">
            <Helmet>
                <title>Usage - Tenklo</title>
            </Helmet>
            <div className="flex flex-wrap items-center justify-between gap-4">
                <p className="text-body-medium-regular text-text-secondary">
                    Requests and data transfer are the month&apos;s total. Connections and storage are the average of its days.
                    {usage?.billingExempt && ' This account is not charged for its usage.'}
                </p>
                <div className="w-40">
                    <Select value={month} onValueChange={setMonth}>
                        <SelectTrigger className="w-full" aria-label="Month">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {months.map((m) => (
                                <SelectItem key={m} value={m}>
                                    {m}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {isLoading || !usage ? (
                <div className="flex flex-col gap-3">
                    <Skeleton className="w-full h-8" />
                    <Skeleton className="w-full h-8" />
                    <Skeleton className="w-full h-8" />
                </div>
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Metric</TableHead>
                            {usage.environments.map((e) => (
                                <TableHead key={e.name}>{e.name}</TableHead>
                            ))}
                            <TableHead>Total</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {USAGE_ROWS.map((row) => (
                            <TableRow key={row.metric}>
                                <TableCell>
                                    <div className="flex flex-col">
                                        <span className="text-text-strong">{row.label}</span>
                                        <span className="text-body-small-regular text-text-tertiary">
                                            {row.description} · {row.kind === 'total' ? 'total' : 'daily average'}
                                        </span>
                                    </div>
                                </TableCell>
                                {usage.environments.map((e) => (
                                    <TableCell key={e.name}>{formatUsage(e.metrics[row.metric], row.unit)}</TableCell>
                                ))}
                                <TableCell className="text-text-strong">{formatUsage(usage.metrics[row.metric], row.unit)}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </DashboardLayout>
    );
};
