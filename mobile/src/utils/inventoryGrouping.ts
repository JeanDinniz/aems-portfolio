import type { FilmRoll } from '@/services/api/inventory.service';

export type StoreLite = {
    id: number;
    name: string;
    has_shared_inventory?: boolean;
    linked_inventory_store_ids?: number[];
};

export type TonalityGroup = { tonality: string | null; rolls: FilmRoll[]; totalRemaining: number };
export type FilmTypeGroup = { filmTypeId: number; filmTypeName: string; tonalities: TonalityGroup[] };
export type StoreGroup = { storeId: number; displayName: string; filmTypes: FilmTypeGroup[] };

const PPF_KEY = '__ppf__';

function tonalityKey(t: string | null | undefined): string {
    const v = (t ?? '').trim();
    return v === '' ? PPF_KEY : v.toUpperCase();
}

function sortTonalities(a: TonalityGroup, b: TonalityGroup): number {
    if (a.tonality === null) return 1;
    if (b.tonality === null) return -1;
    return a.tonality.localeCompare(b.tonality, 'pt-BR');
}

/** Loja→Tipo→Tonalidade para as bobinas de UM store_id (sem merge). */
function buildStoreGroup(storeId: number, storeName: string, rolls: FilmRoll[]): StoreGroup {
    const byType = new Map<number, { name: string; byTon: Map<string, TonalityGroup> }>();

    for (const r of rolls) {
        let type = byType.get(r.film_type_id);
        if (!type) {
            type = { name: r.film_type_name || `Tipo ${r.film_type_id}`, byTon: new Map() };
            byType.set(r.film_type_id, type);
        }
        const key = tonalityKey(r.tonality);
        let tg = type.byTon.get(key);
        if (!tg) {
            tg = { tonality: key === PPF_KEY ? null : (r.tonality ?? null), rolls: [], totalRemaining: 0 };
            type.byTon.set(key, tg);
        }
        tg.rolls.push(r);
        tg.totalRemaining += r.remaining_meters ?? 0;
    }

    const filmTypes: FilmTypeGroup[] = Array.from(byType.entries())
        .map(([filmTypeId, t]) => ({
            filmTypeId,
            filmTypeName: t.name,
            tonalities: Array.from(t.byTon.values()).sort(sortTonalities),
        }))
        .sort((a, b) => a.filmTypeName.localeCompare(b.filmTypeName, 'pt-BR'));

    return { storeId, displayName: storeName, filmTypes };
}

/** Funde dois FilmTypeGroup de mesmo film_type_id (tonalidades de mesmo nome somam). */
function mergeFilmTypes(a: FilmTypeGroup[], b: FilmTypeGroup[]): FilmTypeGroup[] {
    const map = new Map<number, FilmTypeGroup>();
    for (const ft of [...a, ...b]) {
        const existing = map.get(ft.filmTypeId);
        if (!existing) {
            map.set(ft.filmTypeId, { ...ft, tonalities: ft.tonalities.map((t) => ({ ...t, rolls: [...t.rolls] })) });
            continue;
        }
        const byKey = new Map(existing.tonalities.map((t) => [tonalityKey(t.tonality), t]));
        for (const t of ft.tonalities) {
            const k = tonalityKey(t.tonality);
            const cur = byKey.get(k);
            if (!cur) {
                const copy = { ...t, rolls: [...t.rolls] };
                byKey.set(k, copy);
                existing.tonalities.push(copy);
            } else {
                cur.rolls.push(...t.rolls);
                cur.totalRemaining += t.totalRemaining;
            }
        }
        existing.tonalities.sort(sortTonalities);
    }
    return Array.from(map.values()).sort((x, y) => x.filmTypeName.localeCompare(y.filmTypeName, 'pt-BR'));
}

/**
 * Agrupa bobinas em Loja→Tipo→Tonalidade, fundindo lojas de estoque compartilhado
 * (has_shared_inventory + linked_inventory_store_ids) numa entrada só. Espelha
 * groupByStore + computeInventoryGroups + mergeStoreGroupsForDisplay do web.
 */
export function groupInventory(rolls: FilmRoll[], stores: StoreLite[]): StoreGroup[] {
    // 1) Grupo por store_id individual.
    const byStore = new Map<number, { name: string; rolls: FilmRoll[] }>();
    for (const r of rolls) {
        let s = byStore.get(r.store_id);
        if (!s) {
            s = { name: r.store_name || `Loja ${r.store_id}`, rolls: [] };
            byStore.set(r.store_id, s);
        }
        s.rolls.push(r);
    }
    const storeGroups = new Map<number, StoreGroup>();
    for (const [storeId, s] of byStore.entries()) {
        storeGroups.set(storeId, buildStoreGroup(storeId, s.name, s.rolls));
    }

    // 2) Componentes de estoque compartilhado a partir de `stores`.
    const storeById = new Map(stores.map((s) => [s.id, s]));
    const processed = new Set<number>();
    const result: StoreGroup[] = [];

    for (const s of stores) {
        if (processed.has(s.id)) continue;
        processed.add(s.id);
        const partnerIds = (s.has_shared_inventory ? s.linked_inventory_store_ids ?? [] : [])
            .filter((id) => !processed.has(id) && storeById.has(id));
        partnerIds.forEach((id) => processed.add(id));

        const memberIds = [s.id, ...partnerIds];
        const members = memberIds.map((id) => storeGroups.get(id)).filter((g): g is StoreGroup => !!g);
        if (members.length === 0) continue;

        if (members.length === 1 && partnerIds.length === 0) {
            result.push(members[0]);
        } else {
            const names = memberIds.map((id) => storeById.get(id)?.name ?? `Loja ${id}`);
            const filmTypes = members.reduce<FilmTypeGroup[]>((acc, m) => mergeFilmTypes(acc, m.filmTypes), []);
            result.push({ storeId: s.id, displayName: names.join(' + '), filmTypes });
        }
    }

    // 3) Lojas com bobinas mas ausentes de `stores` (fallback) — evita sumir dados.
    for (const [storeId, g] of storeGroups.entries()) {
        if (!processed.has(storeId)) result.push(g);
    }

    return result.sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'));
}

export type InvRow =
    | { type: 'store'; key: string; label: string }
    | { type: 'type'; key: string; label: string }
    | {
          type: 'tonality';
          key: string;
          groupKey: string;
          label: string;
          count: number;
          totalRemaining: number;
          expanded: boolean;
      }
    | { type: 'roll'; key: string; roll: FilmRoll };

/** Chave estável de um grupo de tonalidade (para o Set de expansão). */
export function tonalityGroupKey(storeId: number, filmTypeId: number, tonality: string | null): string {
    return `${storeId}:${filmTypeId}:${tonality ?? PPF_KEY}`;
}

/**
 * Achata os grupos em linhas para a FlashList. Emite header de loja só quando
 * `showStoreHeaders`; a linha-resumo de tonalidade é sempre emitida, e as bobinas
 * só quando a tonalidade está expandida (`expanded.has(groupKey)`).
 */
export function buildInventoryRows(
    groups: StoreGroup[],
    expanded: Set<string>,
    opts: { showStoreHeaders: boolean }
): InvRow[] {
    const rows: InvRow[] = [];
    for (const g of groups) {
        if (opts.showStoreHeaders) {
            rows.push({ type: 'store', key: `s-${g.storeId}`, label: g.displayName });
        }
        for (const ft of g.filmTypes) {
            rows.push({ type: 'type', key: `t-${g.storeId}-${ft.filmTypeId}`, label: ft.filmTypeName });
            for (const ton of ft.tonalities) {
                const groupKey = tonalityGroupKey(g.storeId, ft.filmTypeId, ton.tonality);
                const isOpen = expanded.has(groupKey);
                rows.push({
                    type: 'tonality',
                    key: `ton-${groupKey}`,
                    groupKey,
                    label: ton.tonality ?? 'PPF / sem tonalidade',
                    count: ton.rolls.length,
                    totalRemaining: ton.totalRemaining,
                    expanded: isOpen,
                });
                if (isOpen) {
                    for (const r of ton.rolls) rows.push({ type: 'roll', key: `roll-${r.id}`, roll: r });
                }
            }
        }
    }
    return rows;
}
