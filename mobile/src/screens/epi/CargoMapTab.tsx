import { useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useConfirm } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Select, type SelectOption, type SelectRef } from '@/components/ui/Select';
import { Sheet, type SheetRef } from '@/components/ui/Sheet';
import { useCanDelete, useCanEdit } from '@/hooks/useMyPermissions';
import { useCargoMap, useCargoMapMutations, useEpiCatalog } from '@/hooks/useEpi';
import { EMPLOYEE_POSITIONS } from '@/constants/employees';
import type { CargoEPI } from '@/types/epi.types';

/**
 * Mapeamento cargo -> EPI (paridade com a web `CargoMapTab`).
 *
 * Define quais EPIs cada cargo exige — base do relatório de pendências. Filtra
 * por cargo. `epi:can_edit` vincula um EPI a um cargo; `epi:can_delete` remove o
 * vínculo. Cargos vêm de `EMPLOYEE_POSITIONS`; EPIs, do catálogo ativo.
 */

const ALL = '__all__';

const CARGO_FILTER_OPTIONS: SelectOption<string>[] = [
    { value: ALL, label: 'Todos os cargos' },
    ...EMPLOYEE_POSITIONS.map((p) => ({ value: p.value, label: p.label })),
];

const CARGO_OPTIONS: SelectOption<string>[] = EMPLOYEE_POSITIONS.map((p) => ({
    value: p.value,
    label: p.label,
}));

export function CargoMapTab() {
    const canEdit = useCanEdit('epi');
    const canDelete = useCanDelete('epi');
    const { confirm } = useConfirm();

    const [filterCargo, setFilterCargo] = useState<string>(ALL);
    const { data, isLoading, refetch, isRefetching } = useCargoMap(
        filterCargo === ALL ? undefined : filterCargo
    );
    const { data: catalog } = useEpiCatalog(1, true);
    const { create, remove } = useCargoMapMutations();

    const [cargo, setCargo] = useState('');
    const [epiId, setEpiId] = useState('');

    const filterSelectRef = useRef<SelectRef>(null);
    const cargoSelectRef = useRef<SelectRef>(null);
    const epiSelectRef = useRef<SelectRef>(null);
    const formSheetRef = useRef<SheetRef>(null);

    const epiOptions = useMemo<SelectOption<string>[]>(
        () => (catalog?.items ?? []).map((e) => ({ value: String(e.id), label: e.name })),
        [catalog]
    );

    const openNew = () => {
        setCargo('');
        setEpiId('');
        formSheetRef.current?.present();
    };

    const submit = () => {
        create.mutate(
            { cargo, epi_id: Number(epiId) },
            { onSuccess: () => formSheetRef.current?.dismiss() }
        );
    };

    const confirmRemove = async (m: CargoEPI) => {
        const ok = await confirm({
            title: 'Remover vínculo?',
            message: `"${m.cargo}" deixará de exigir "${m.epi_name}".`,
            confirmLabel: 'Remover',
            destructive: true,
        });
        if (ok) remove.mutate(m.id);
    };

    const items = data?.items ?? [];
    const filterLabel =
        CARGO_FILTER_OPTIONS.find((o) => o.value === filterCargo)?.label ?? 'Todos os cargos';
    const cargoLabel = CARGO_OPTIONS.find((o) => o.value === cargo)?.label ?? 'Selecione o cargo';
    const epiLabel = epiOptions.find((o) => o.value === epiId)?.label ?? 'Selecione o EPI';
    const canSubmit = !!cargo && !!epiId && !create.isPending;

    return (
        <View className="flex-1">
            <View className="flex-row items-center gap-2 px-4 pb-1 pt-3">
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={filterLabel}
                    onPress={() => filterSelectRef.current?.present()}
                    className="min-h-[40px] flex-1 flex-row items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 active:opacity-70 dark:border-dark-border-strong dark:bg-dark-input"
                >
                    <Ionicons name="briefcase-outline" size={16} color="#98A2B3" />
                    <Text
                        className="flex-1 font-sans text-sm text-neutral-700 dark:text-dark-text"
                        numberOfLines={1}
                    >
                        {filterLabel}
                    </Text>
                    <Ionicons name="chevron-down" size={16} color="#98A2B3" />
                </Pressable>
                {canEdit ? (
                    <Button
                        title="Vincular"
                        icon="add"
                        variant="secondary"
                        size="sm"
                        fullWidth={false}
                        onPress={openNew}
                    />
                ) : null}
            </View>

            {isLoading ? (
                <View className="gap-3 p-4">
                    {[0, 1, 2].map((i) => (
                        <Skeleton key={i} width="100%" height={56} radius={16} />
                    ))}
                </View>
            ) : (
                <ScrollView
                    className="flex-1"
                    contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
                    }
                >
                    {items.length === 0 ? (
                        <EmptyState
                            icon="link-outline"
                            title="Nenhum vínculo"
                            description="Nenhum vínculo cadastrado."
                            actionLabel={canEdit ? 'Vincular EPI' : undefined}
                            onAction={canEdit ? openNew : undefined}
                        />
                    ) : (
                        <View className="gap-3">
                            {items.map((m) => (
                                <View
                                    key={m.id}
                                    className="flex-row items-center gap-3 rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface"
                                >
                                    <View className="flex-1">
                                        <Text
                                            className="font-sans-semibold text-base text-neutral-800 dark:text-dark-text"
                                            numberOfLines={1}
                                        >
                                            {m.cargo}
                                        </Text>
                                        <Text className="mt-0.5 font-sans text-sm text-neutral-500 dark:text-dark-text-muted">
                                            Exige: {m.epi_name}
                                        </Text>
                                    </View>
                                    {canDelete ? (
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel="Remover vínculo"
                                            onPress={() => confirmRemove(m)}
                                            hitSlop={8}
                                            className="h-10 w-10 items-center justify-center rounded-lg bg-neutral-50 active:opacity-70 dark:bg-dark-elevated"
                                        >
                                            <Ionicons name="trash-outline" size={18} color="#F04438" />
                                        </Pressable>
                                    ) : null}
                                </View>
                            ))}
                        </View>
                    )}
                </ScrollView>
            )}

            {/* Selects (fora do sheet do form; overlays independentes) */}
            <Select<string>
                ref={filterSelectRef}
                title="Filtrar por cargo"
                options={CARGO_FILTER_OPTIONS}
                value={filterCargo}
                onChange={setFilterCargo}
            />

            <Sheet ref={formSheetRef} title="Vincular EPI a um cargo">
                <View className="pb-2">
                    <SheetSelectField
                        title="Cargo"
                        label={cargoLabel}
                        placeholder={!cargo}
                        onPress={() => cargoSelectRef.current?.present()}
                    />
                    <SheetSelectField
                        title="EPI"
                        label={epiLabel}
                        placeholder={!epiId}
                        onPress={() => epiSelectRef.current?.present()}
                    />
                    <Button
                        title="Vincular"
                        icon="link"
                        loading={create.isPending}
                        disabled={!canSubmit}
                        onPress={submit}
                    />
                </View>
            </Sheet>

            <Select<string>
                ref={cargoSelectRef}
                title="Cargo"
                options={CARGO_OPTIONS}
                value={cargo}
                onChange={setCargo}
            />
            <Select<string>
                ref={epiSelectRef}
                title="EPI"
                options={epiOptions}
                value={epiId}
                onChange={setEpiId}
            />
        </View>
    );
}

// ─── subcomponente ──────────────────────────────────────────────────────────

function SheetSelectField({
    title,
    label,
    placeholder,
    onPress,
}: {
    title: string;
    label: string;
    placeholder: boolean;
    onPress: () => void;
}) {
    return (
        <View className="mb-4">
            <Text className="mb-1.5 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
                {title}
            </Text>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${title}: ${label}`}
                onPress={onPress}
                className="min-h-[48px] flex-row items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-3 active:opacity-70 dark:border-dark-border-strong dark:bg-dark-input"
            >
                <Text
                    className={`font-sans text-base ${
                        placeholder ? 'text-neutral-400' : 'text-neutral-900 dark:text-dark-text'
                    }`}
                >
                    {label}
                </Text>
                <Ionicons name="chevron-down" size={18} color="#98A2B3" />
            </Pressable>
        </View>
    );
}
