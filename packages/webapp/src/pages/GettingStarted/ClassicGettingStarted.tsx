import { ChevronRight, LockOpen, Pencil, RefreshCw, Wrench } from 'lucide-react';
import { Helmet } from 'react-helmet';

import { Button } from '@nangohq/design-system';

import { ButtonLink } from '@/components/ui/ButtonLink';
import { Tag } from '@/components/ui/Tag';
import { useStore } from '@/store';
import DashboardLayout from '../../layout/DashboardLayout';

export const ClassicGettingStarted: React.FC = () => {
    const env = useStore((state) => state.env);

    return (
        <DashboardLayout className="flex flex-col gap-9">
            <Helmet>
                <title>Getting Started - Tenklo</title>
            </Helmet>
            <section className="flex flex-col items-start gap-3 rounded-lg border border-border-muted bg-surface-panel p-7">
                <h1 className="text-heading-medium text-text-strong">Connect your product to the APIs your customers use</h1>
                <p className="max-w-2xl text-body-medium-regular text-text-secondary">
                    Set up an integration, let a customer connect their account through Connect UI, then read and write their data with the Tenklo API. Tenklo
                    keeps their credentials fresh and tells you when something needs attention.
                </p>
                <ButtonLink to={`/${env}/integrations/create`} variant="primary" size="md">
                    Set up an integration
                </ButtonLink>
            </section>
            <h2 className="text-xl font-semibold text-text-strong">Guides</h2>
            <div className="grid grid-cols-2 text-text-strong gap-7">
                <a
                    className="transition-all block border rounded-lg border-border-muted p-7 group hover:border-border-strong hover:shadow-card focus:shadow-card focus:border-border-selected focus:outline-0"
                    href="https://docs.tenklo.dev/guides/auth/auth-guide"
                    target="_blank"
                    rel="noreferrer"
                >
                    <header className="flex justify-between">
                        <div className="flex gap-3 items-start">
                            <Tag variant={'neutral'}>Guide 1</Tag>
                            <h2>Authorize</h2>
                        </div>
                        <div className="rounded-full border border-border-muted p-1.5 h-8 w-8">
                            <LockOpen strokeWidth={1} size={18} />
                        </div>
                    </header>
                    <main>
                        <p className="text-sm text-text-muted">Let users authorize an API from your app.</p>
                    </main>
                    <footer className="mt-4">
                        <Button variant={'ghost'} className="group-hover:text-text-strong group-focus:text-text-strong">
                            Learn more <ChevronRight strokeWidth={1} size={20} />
                        </Button>
                    </footer>
                </a>

                <a
                    className="transition-all block border rounded-lg border-border-muted p-7 group hover:border-border-strong hover:shadow-card"
                    href="https://docs.tenklo.dev/guides/functions/syncs/sync-functions"
                    target="_blank"
                    rel="noreferrer"
                >
                    <header className="flex justify-between">
                        <div className="flex gap-3 items-start">
                            <Tag variant={'neutral'}>Guide 2</Tag>
                            <h2>Read data</h2>
                        </div>
                        <div className="rounded-full border border-border-muted p-1.5 h-8 w-8">
                            <RefreshCw strokeWidth={1} size={18} />
                        </div>
                    </header>
                    <main>
                        <p className="text-sm text-text-muted">Continuously sync data from an API.</p>
                    </main>
                    <footer className="mt-4">
                        <Button variant={'ghost'} className="group-hover:text-text-strong group-focus:text-text-strong">
                            Learn more <ChevronRight strokeWidth={1} size={20} />
                        </Button>
                    </footer>
                </a>

                <a
                    className="transition-all block border rounded-lg border-border-muted p-7 group hover:border-border-strong hover:shadow-card"
                    href="https://docs.tenklo.dev/guides/functions/action-functions"
                    target="_blank"
                    rel="noreferrer"
                >
                    <header className="flex justify-between">
                        <div className="flex gap-3 items-start">
                            <Tag variant={'neutral'}>Guide 3</Tag>
                            <h2>Write data</h2>
                        </div>
                        <div className="rounded-full border border-border-muted p-1.5 h-8 w-8">
                            <Pencil strokeWidth={1} size={18} />
                        </div>
                    </header>
                    <main>
                        <p className="text-sm text-text-muted">Write data back to APIs.</p>
                    </main>
                    <footer className="mt-4">
                        <Button variant={'ghost'} className="group-hover:text-text-strong group-focus:text-text-strong">
                            Learn more <ChevronRight strokeWidth={1} size={20} />
                        </Button>
                    </footer>
                </a>

                <a
                    className="transition-all block border rounded-lg border-border-muted p-7 group hover:border-border-strong hover:shadow-card"
                    href="https://docs.tenklo.dev/guides/functions/functions-guide"
                    target="_blank"
                    rel="noreferrer"
                >
                    <header className="flex justify-between">
                        <div className="flex gap-3 items-start">
                            <Tag variant={'neutral'}>Guide 4</Tag>
                            <h2>Build custom integrations</h2>
                        </div>
                        <div className="rounded-full border border-border-muted p-1.5 h-8 w-8">
                            <Wrench strokeWidth={1} size={18} />
                        </div>
                    </header>
                    <main>
                        <p className="text-sm text-text-muted">Go beyond pre-built integrations.</p>
                    </main>
                    <footer className="mt-4">
                        <Button variant={'ghost'} className="group-hover:text-text-strong group-focus:text-text-strong">
                            Learn more <ChevronRight strokeWidth={1} size={20} />
                        </Button>
                    </footer>
                </a>
            </div>
        </DashboardLayout>
    );
};
