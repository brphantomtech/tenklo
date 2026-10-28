import { useEffect, useLayoutEffect, useState } from 'react';

import { useGlobal } from './store';

import type { ConnectUIThemeSettings, Theme } from '@nangohq/types';

const THEME_TIMEOUT_MS = 3000;

export function isValidTheme(theme: string): theme is Theme {
    return ['light', 'dark', 'system'].includes(theme);
}

export function useAppliedTheme(): { appliedTheme: 'light' | 'dark'; isPending: boolean } {
    const theme = useGlobal((state) => state.theme);
    const settings = useGlobal((state) => state.settings);
    const systemTheme = useSystemTheme();

    const appliedTheme = !theme || theme === 'system' ? systemTheme : theme;

    useEffect(() => {
        if (theme) {
            return;
        }
        const timeout = setTimeout(() => useGlobal.getState().setTheme('system'), THEME_TIMEOUT_MS);
        return () => clearTimeout(timeout);
    }, [theme]);

    useLayoutEffect(() => {
        document.documentElement.classList.toggle('dark', appliedTheme === 'dark');
        if (settings) {
            setColors(settings.theme, appliedTheme);
        }
    }, [appliedTheme, settings]);

    return { appliedTheme, isPending: !theme };
}

function useSystemTheme(): 'light' | 'dark' {
    const [systemTheme, setSystemTheme] = useState(getSystemTheme);

    useEffect(() => {
        const query = window.matchMedia('(prefers-color-scheme: dark)');
        const onChange = (event: MediaQueryListEvent) => setSystemTheme(event.matches ? 'dark' : 'light');
        query.addEventListener('change', onChange);
        return () => query.removeEventListener('change', onChange);
    }, []);

    return systemTheme;
}

function getSystemTheme(): 'light' | 'dark' {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function setColors(theme: ConnectUIThemeSettings, appliedTheme: 'light' | 'dark'): void {
    const root = document.documentElement;
    const primary = theme[appliedTheme].primary;

    if (!primary) {
        root.style.removeProperty('--color-primary');
        root.style.removeProperty('--color-on-primary');
        return;
    }

    root.style.setProperty('--color-primary', primary);
    root.style.setProperty('--color-on-primary', onPrimaryColor(cssColorToHex(primary)));
}

/**
 * Converts any CSS color (hex, rgb, hsl, named colors, etc.) to hex format
 * @param cssColor - Any valid CSS color string
 * @returns Hex color string (e.g., "red" -> "#ff0000")
 */
function cssColorToHex(cssColor: string): string {
    if (cssColor.startsWith('#')) {
        return cssColor;
    }

    // Create a temporary element to leverage browser's color parsing
    const tempElement = document.createElement('div');
    tempElement.style.color = cssColor;
    document.body.appendChild(tempElement);

    // Get the computed color value
    const computedColor = window.getComputedStyle(tempElement).color;

    // Clean up
    document.body.removeChild(tempElement);

    // Convert rgb(r,g,b) to hex
    const rgbMatch = computedColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (rgbMatch) {
        const r = parseInt(rgbMatch[1], 10);
        const g = parseInt(rgbMatch[2], 10);
        const b = parseInt(rgbMatch[3], 10);
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    // Fallback: return the original color if parsing fails
    return cssColor;
}

const INK = '#0b0b0c';
const WHITE = '#ffffff';

/**
 * Text color for a primary fill: whichever of white or Tenklo ink reads with the higher WCAG contrast.
 * (A luminance threshold put white on the default brand cyan, at 2.5:1.)
 */
export function onPrimaryColor(bgColor: string): string {
    const bg = relativeLuminance(bgColor);
    if (bg === null) {
        return WHITE;
    }
    const ink = relativeLuminance(INK) ?? 0;
    const contrastWithWhite = 1.05 / (bg + 0.05);
    const contrastWithInk = (bg + 0.05) / (ink + 0.05);
    return contrastWithInk > contrastWithWhite ? INK : WHITE;
}

function relativeLuminance(hex: string): number | null {
    let color = hex.charAt(0) === '#' ? hex.substring(1) : hex;
    if (color.length === 3) {
        color = color
            .split('')
            .map((c) => c + c)
            .join('');
    }
    if (!/^[0-9a-f]{6}/i.test(color)) {
        return null;
    }
    const [r, g, b] = [0, 2, 4].map((offset) => {
        const channel = parseInt(color.substring(offset, offset + 2), 16) / 255;
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
