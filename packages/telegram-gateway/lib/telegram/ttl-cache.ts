/** Cache em memória com expiração e limite de itens (descarta o mais antigo). */
export class TtlCache<V> {
    private readonly items = new Map<string, { value: V; expiresAt: number }>();

    constructor(
        private readonly ttlMs: number,
        private readonly maxItems: number,
        private readonly now: () => number = Date.now
    ) {}

    get(key: string): V | undefined {
        const item = this.items.get(key);
        if (!item) return undefined;
        if (item.expiresAt <= this.now()) {
            this.items.delete(key);
            return undefined;
        }
        return item.value;
    }

    set(key: string, value: V): void {
        this.items.delete(key);
        this.items.set(key, { value, expiresAt: this.now() + this.ttlMs });
        while (this.items.size > this.maxItems) {
            const oldest = this.items.keys().next().value;
            if (oldest === undefined) break;
            this.items.delete(oldest);
        }
    }

    clear(): void {
        this.items.clear();
    }
}
