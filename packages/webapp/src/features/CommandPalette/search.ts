/** Lowercase and without accents, so "Integracao" finds "Integração". */
export const fold = (text: string) =>
    text
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase();
