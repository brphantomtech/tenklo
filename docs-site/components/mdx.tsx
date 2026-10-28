import defaultMdxComponents from 'fumadocs-ui/mdx';

import { mintlifyComponents } from './mintlify.tsx';

import type { MDXComponents } from 'mdx/types';

export function getMDXComponents(components?: MDXComponents) {
    return {
        ...defaultMdxComponents,
        ...mintlifyComponents,
        ...components
    } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
    type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
