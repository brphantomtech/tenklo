import { describe, expect, it } from 'vitest';

import { buildCategories, categoryLabel } from './categories';

describe('buildCategories', () => {
    it('counts providers per category, Popular first and Other last', () => {
        const categories = buildCategories([
            { categories: ['crm', 'popular'] },
            { categories: ['crm', 'other'] },
            { categories: ['accounting'] },
            { categories: undefined }
        ]);

        expect(categories).toEqual([
            { slug: 'popular', label: 'Popular', count: 1 },
            { slug: 'accounting', label: 'Accounting', count: 1 },
            { slug: 'crm', label: 'CRM', count: 2 },
            { slug: 'other', label: 'Other', count: 1 }
        ]);
    });

    it('counts a provider once even when a category repeats', () => {
        expect(buildCategories([{ categories: ['hr', 'hr'] }])).toEqual([{ slug: 'hr', label: 'HR', count: 1 }]);
    });
});

describe('categoryLabel', () => {
    it('names categories it has no label for', () => {
        expect(categoryLabel('dev-tools')).toBe('Developer tools');
        expect(categoryLabel('field-service')).toBe('Field service');
    });
});
