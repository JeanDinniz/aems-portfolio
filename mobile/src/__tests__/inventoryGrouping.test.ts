import {
    groupInventory,
    buildInventoryRows,
    tonalityGroupKey,
    type StoreLite,
} from '@/utils/inventoryGrouping';
import type { FilmRoll } from '@/services/api/inventory.service';

function roll(over: Partial<FilmRoll>): FilmRoll {
    return {
        id: 1,
        visual_id: 'R1',
        store_id: 1,
        store_name: 'Loja A',
        film_type_id: 10,
        film_type_name: 'WB',
        tonality: 'G20',
        remaining_meters: 5,
        total_meters: 10,
        color: 'blue',
        status: 'em_estoque',
        ...over,
    } as unknown as FilmRoll;
}

const storesPlain: StoreLite[] = [
    { id: 1, name: 'Loja A' },
    { id: 2, name: 'Loja B' },
];

describe('groupInventory', () => {
    it('agrupa por loja → tipo → tonalidade e soma metros', () => {
        const groups = groupInventory(
            [roll({ id: 1, remaining_meters: 5 }), roll({ id: 2, remaining_meters: 3 })],
            storesPlain
        );
        expect(groups).toHaveLength(1);
        expect(groups[0].filmTypes[0].tonalities[0].tonality).toBe('G20');
        expect(groups[0].filmTypes[0].tonalities[0].totalRemaining).toBe(8);
        expect(groups[0].filmTypes[0].tonalities[0].rolls).toHaveLength(2);
    });

    it('tonalidade nula (PPF) vem por último', () => {
        const groups = groupInventory(
            [roll({ id: 1, tonality: 'G20' }), roll({ id: 2, tonality: null })],
            storesPlain
        );
        const tons = groups[0].filmTypes[0].tonalities.map((t) => t.tonality);
        expect(tons).toEqual(['G20', null]);
    });

    it('funde lojas de estoque compartilhado numa entrada só', () => {
        const shared: StoreLite[] = [
            { id: 1, name: 'Loja A', has_shared_inventory: true, linked_inventory_store_ids: [2] },
            { id: 2, name: 'Loja B', has_shared_inventory: true, linked_inventory_store_ids: [1] },
        ];
        const groups = groupInventory(
            [
                roll({ id: 1, store_id: 1, store_name: 'Loja A', tonality: 'G20', remaining_meters: 5 }),
                roll({ id: 2, store_id: 2, store_name: 'Loja B', tonality: 'G20', remaining_meters: 4 }),
            ],
            shared
        );
        expect(groups).toHaveLength(1);
        expect(groups[0].displayName).toBe('Loja A + Loja B');
        expect(groups[0].filmTypes[0].tonalities[0].totalRemaining).toBe(9);
        expect(groups[0].filmTypes[0].tonalities[0].rolls).toHaveLength(2);
    });

    it('lojas independentes ficam separadas', () => {
        const groups = groupInventory(
            [
                roll({ id: 1, store_id: 1, store_name: 'Loja A' }),
                roll({ id: 2, store_id: 2, store_name: 'Loja B' }),
            ],
            storesPlain
        );
        expect(groups.map((g) => g.displayName).sort()).toEqual(['Loja A', 'Loja B']);
    });
});

describe('buildInventoryRows', () => {
    const groups = groupInventory(
        [roll({ id: 1, tonality: 'G20', remaining_meters: 5 }), roll({ id: 2, tonality: 'G20', remaining_meters: 3 })],
        [{ id: 1, name: 'Loja A' }]
    );

    it('colapsado: não emite linhas de bobina', () => {
        const rows = buildInventoryRows(groups, new Set(), { showStoreHeaders: false });
        expect(rows.some((r) => r.type === 'roll')).toBe(false);
        const ton = rows.find((r) => r.type === 'tonality');
        expect(ton).toMatchObject({ count: 2, totalRemaining: 8, expanded: false });
    });

    it('expandido: emite as bobinas da tonalidade', () => {
        const key = tonalityGroupKey(1, 10, 'G20');
        const rows = buildInventoryRows(groups, new Set([key]), { showStoreHeaders: false });
        expect(rows.filter((r) => r.type === 'roll')).toHaveLength(2);
    });

    it('showStoreHeaders=false não emite header de loja', () => {
        const rows = buildInventoryRows(groups, new Set(), { showStoreHeaders: false });
        expect(rows.some((r) => r.type === 'store')).toBe(false);
    });

    it('showStoreHeaders=true emite header de loja', () => {
        const rows = buildInventoryRows(groups, new Set(), { showStoreHeaders: true });
        expect(rows.some((r) => r.type === 'store')).toBe(true);
    });
});
