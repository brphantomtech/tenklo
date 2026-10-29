/** How each provider category from `providers.yaml` reads in the catalog. */
const CATEGORY_LABELS: Record<string, string> = {
    popular: 'Popular',
    accounting: 'Accounting',
    analytics: 'Analytics',
    ats: 'Recruiting (ATS)',
    banking: 'Banking',
    cms: 'CMS',
    communication: 'Communication',
    crm: 'CRM',
    design: 'Design',
    'dev-tools': 'Developer tools',
    'e-commerce': 'E-commerce',
    erp: 'ERP',
    gaming: 'Gaming',
    hr: 'HR',
    iam: 'Identity & access',
    invoicing: 'Invoicing',
    'knowledge-base': 'Knowledge base',
    legal: 'Legal',
    marketing: 'Marketing',
    mcp: 'MCP servers',
    other: 'Other',
    payment: 'Payments',
    productivity: 'Productivity',
    search: 'Search',
    social: 'Social',
    sports: 'Sports',
    storage: 'Storage',
    support: 'Support',
    surveys: 'Surveys',
    ticketing: 'Ticketing',
    video: 'Video'
};

export const categoryLabel = (slug: string) => CATEGORY_LABELS[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, ' ');

export interface CatalogCategory {
    slug: string;
    label: string;
    count: number;
}

/** The categories of a set of providers with how many each has: Popular first, Other last, the rest by name. */
export function buildCategories(providers: { categories?: string[] | undefined }[]): CatalogCategory[] {
    const counts = new Map<string, number>();
    for (const provider of providers) {
        for (const slug of new Set(provider.categories ?? [])) {
            counts.set(slug, (counts.get(slug) ?? 0) + 1);
        }
    }
    const rank = (slug: string) => (slug === 'popular' ? 0 : slug === 'other' ? 2 : 1);
    return [...counts]
        .map(([slug, count]) => ({ slug, label: categoryLabel(slug), count }))
        .sort((a, b) => rank(a.slug) - rank(b.slug) || a.label.localeCompare(b.label));
}
