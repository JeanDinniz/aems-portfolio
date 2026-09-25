import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useForm, Controller } from 'react-hook-form';
import type { Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { useConfirm } from '@/components/ui';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Select, type SelectOption, type SelectRef } from '@/components/ui/Select';
import { Sheet, type SheetRef } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { TextField } from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';
import {
    useCreateHoliday,
    useDeleteHoliday,
    useHolidays,
    useUpdateHoliday,
} from '@/hooks/useHolidays';
import { useStores } from '@/hooks/useStores';
import { useCanEdit } from '@/hooks/useMyPermissions';
import { getApiErrorMessage } from '@/lib/api-error';
import type { Holiday, UpdateHolidayPayload } from '@/types/holiday.types';
import type { AdminStackScreenProps } from '@/navigation/types';

/**
 * Feriados (Admin) — paridade com o web `HolidaysManagementPage`.
 *
 * - Filtro de ANO (Select: ano atual −2..+2, default atual). A lista traz todas
 *   as lojas do ano (o web não filtra por loja aqui — só exibe a badge).
 * - Lista ordenada por data crescente: data DD/MM/AAAA (mono), nome, badge da
 *   loja (`store_name` ou "Todas as lojas").
 * - Criar/Editar via Sheet (Data AAAA-MM-DD + Nome + Loja). Excluir com
 *   confirmação (`Alert.alert`). Tudo gated por `useCanEdit('stores')` — regra do
 *   web: permissão de escrita de feriados = submódulo `stores`.
 *
 * Header próprio (preto) — o AdminStack usa `headerShown: false`.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENT_YEAR = new Date().getFullYear();
const ALL_STORES = 0; // sentinela p/ "Todas as lojas" no Select (store_id null)

const YEAR_OPTIONS: SelectOption<number>[] = Array.from({ length: 5 }, (_, i) => {
    const y = CURRENT_YEAR - 2 + i;
    return { value: y, label: String(y) };
});

function formatDateBR(dateStr: string): string {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
}

// ─── form ────────────────────────────────────────────────────────────────────

const holidaySchema = z.object({
    date: z.string().regex(DATE_RE, 'Use o formato AAAA-MM-DD'),
    name: z.string().trim().min(1, 'Nome é obrigatório'),
    store_id: z.number(), // ALL_STORES (0) = todas as lojas
});
type HolidayForm = z.infer<typeof holidaySchema>;

export function HolidaysAdminScreen({ navigation }: AdminStackScreenProps<'HolidaysAdmin'>) {
    const toast = useToast();
    const { confirm } = useConfirm();
    const canEdit = useCanEdit('stores');
    const { allStores } = useStores();

    const [year, setYear] = useState<number>(CURRENT_YEAR);
    const { data, isLoading, isError, refetch, isRefetching } = useHolidays(year);

    const createMutation = useCreateHoliday();
    const updateMutation = useUpdateHoliday();
    const deleteMutation = useDeleteHoliday();

    const holidays = useMemo(
        () => [...(data?.items ?? [])].sort((a, b) => a.date.localeCompare(b.date)),
        [data]
    );

    // ─── sheets ────────────────────────────────────────────────────────────────
    const formSheetRef = useRef<SheetRef>(null);
    const yearSheetRef = useRef<SelectRef>(null);
    const storeSheetRef = useRef<SelectRef>(null);
    const [editing, setEditing] = useState<Holiday | null>(null);

    const {
        control,
        handleSubmit,
        reset,
        formState: { errors },
    } = useForm<HolidayForm>({
        resolver: zodResolver(holidaySchema) as unknown as Resolver<HolidayForm>,
        defaultValues: { date: '', name: '', store_id: ALL_STORES },
    });

    const storeOptions = useMemo<SelectOption<number>[]>(
        () => [
            { value: ALL_STORES, label: 'Todas as lojas' },
            ...allStores.map((s) => ({ value: s.id, label: s.name })),
        ],
        [allStores]
    );

    const openCreate = useCallback(() => {
        setEditing(null);
        reset({ date: todayIso(), name: '', store_id: ALL_STORES });
        formSheetRef.current?.present();
    }, [reset]);

    const openEdit = useCallback(
        (holiday: Holiday) => {
            setEditing(holiday);
            reset({
                date: holiday.date,
                name: holiday.name,
                store_id: holiday.store_id ?? ALL_STORES,
            });
            formSheetRef.current?.present();
        },
        [reset]
    );

    const onSubmit = useCallback(
        (form: HolidayForm) => {
            const storeId = form.store_id === ALL_STORES ? null : form.store_id;

            if (editing) {
                const payload: UpdateHolidayPayload = {
                    date: form.date,
                    name: form.name.trim(),
                };
                if (storeId === null) {
                    // Mudou de loja específica para "todas": manda store_id=null + clear_store.
                    payload.store_id = null;
                    payload.clear_store = true;
                } else {
                    payload.store_id = storeId;
                }
                updateMutation.mutate(
                    { id: editing.id, payload },
                    {
                        onSuccess: () => {
                            toast.success('Feriado atualizado.');
                            formSheetRef.current?.dismiss();
                            setEditing(null);
                        },
                        onError: (err) =>
                            toast.error(
                                getApiErrorMessage(err as Error, 'Erro ao atualizar feriado.')
                            ),
                    }
                );
            } else {
                createMutation.mutate(
                    { date: form.date, name: form.name.trim(), store_id: storeId },
                    {
                        onSuccess: () => {
                            toast.success('Feriado criado.');
                            formSheetRef.current?.dismiss();
                        },
                        onError: (err) =>
                            toast.error(getApiErrorMessage(err as Error, 'Erro ao criar feriado.')),
                    }
                );
            }
        },
        [editing, createMutation, updateMutation, toast]
    );

    const confirmDelete = useCallback(
        async (holiday: Holiday) => {
            const ok = await confirm({
                title: 'Excluir feriado',
                message: `Excluir "${holiday.name}" (${formatDateBR(holiday.date)})? Esta ação é irreversível.`,
                confirmLabel: 'Excluir',
                destructive: true,
            });
            if (ok) {
                deleteMutation.mutate(holiday.id, {
                    onSuccess: () => toast.success('Feriado excluído.'),
                    onError: (err) =>
                        toast.error(
                            getApiErrorMessage(err as Error, 'Erro ao excluir feriado.')
                        ),
                });
            }
        },
        [confirm, deleteMutation, toast]
    );

    const subtitle = isLoading
        ? 'Carregando...'
        : `${holidays.length} ${holidays.length === 1 ? 'feriado' : 'feriados'} em ${year}`;

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            {/* Header preto */}
            <SafeAreaView edges={['top']} className="bg-brand-black">
                <View className="px-4 pb-3 pt-2">
                    <View className="flex-row items-center gap-3">
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Voltar"
                            onPress={() => navigation.goBack()}
                            hitSlop={8}
                            className="h-11 w-11 items-center justify-center rounded-full active:bg-white/10"
                        >
                            <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
                        </Pressable>
                        <View className="flex-1">
                            <Text className="font-display-bold text-xl text-white">Feriados</Text>
                            <Text className="mt-0.5 font-sans text-sm text-neutral-400">{subtitle}</Text>
                        </View>
                        {canEdit ? (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Novo feriado"
                                onPress={openCreate}
                                className="h-11 w-11 items-center justify-center rounded-full bg-white/10 active:opacity-70"
                            >
                                <Ionicons name="add" size={24} color="#FFFFFF" />
                            </Pressable>
                        ) : null}
                    </View>

                    {/* Filtro de ano */}
                    <View className="mt-3">
                        <Text className="mb-1 font-sans-medium text-xs uppercase tracking-wide text-neutral-400">
                            Ano
                        </Text>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Ano: ${year}`}
                            onPress={() => yearSheetRef.current?.present()}
                            className="min-h-[44px] w-[140px] flex-row items-center justify-between rounded-lg bg-white/10 px-3 py-2 active:opacity-70"
                        >
                            <Text className="font-sans text-base text-white">{year}</Text>
                            <Ionicons name="chevron-down" size={18} color="#98A2B3" />
                        </Pressable>
                    </View>
                </View>
            </SafeAreaView>

            {/* Conteúdo */}
            {isLoading ? (
                <ListSkeleton />
            ) : isError ? (
                <ErrorState onRetry={() => void refetch()} />
            ) : (
                <ScrollView
                    className="flex-1"
                    contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
                    }
                >
                    {holidays.length === 0 ? (
                        <EmptyState
                            icon="calendar-clear-outline"
                            title="Nenhum feriado"
                            description={`Nenhum feriado cadastrado para ${year}.`}
                        />
                    ) : (
                        <View className="gap-3">
                            {holidays.map((holiday) => (
                                <HolidayCard
                                    key={holiday.id}
                                    holiday={holiday}
                                    canEdit={canEdit}
                                    onEdit={() => openEdit(holiday)}
                                    onDelete={() => confirmDelete(holiday)}
                                />
                            ))}
                        </View>
                    )}
                </ScrollView>
            )}

            {/* Sheet: criar/editar feriado */}
            <Sheet ref={formSheetRef} title={editing ? 'Editar feriado' : 'Novo feriado'}>
                <ScrollView
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={{ paddingBottom: 24 }}
                    showsVerticalScrollIndicator={false}
                >
                    <Controller
                        control={control}
                        name="date"
                        render={({ field: { value, onChange } }) => (
                            <TextField
                                label="Data"
                                value={value}
                                onChangeText={onChange}
                                placeholder="AAAA-MM-DD"
                                autoCapitalize="none"
                                autoCorrect={false}
                                keyboardType="numbers-and-punctuation"
                                error={errors.date?.message}
                            />
                        )}
                    />

                    <Controller
                        control={control}
                        name="name"
                        render={({ field: { value, onChange } }) => (
                            <TextField
                                label="Nome"
                                value={value}
                                onChangeText={onChange}
                                placeholder="Ex.: Carnaval"
                                error={errors.name?.message}
                            />
                        )}
                    />

                    {/* Loja */}
                    <Text className="mb-1.5 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
                        Loja
                    </Text>
                    <Controller
                        control={control}
                        name="store_id"
                        render={({ field: { value, onChange } }) => {
                            const label =
                                storeOptions.find((o) => o.value === value)?.label ??
                                'Todas as lojas';
                            return (
                                <>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={`Loja: ${label}`}
                                        onPress={() => storeSheetRef.current?.present()}
                                        className="min-h-[48px] flex-row items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-3 active:opacity-70 dark:border-dark-border-strong dark:bg-dark-input"
                                    >
                                        <Text className="font-sans text-base text-neutral-900 dark:text-dark-text">
                                            {label}
                                        </Text>
                                        <Ionicons name="chevron-down" size={18} color="#98A2B3" />
                                    </Pressable>
                                    <Select<number>
                                        ref={storeSheetRef}
                                        title="Loja"
                                        options={storeOptions}
                                        value={value}
                                        onChange={onChange}
                                    />
                                </>
                            );
                        }}
                    />
                    <Text className="mb-4 mt-1 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                        &quot;Todas as lojas&quot; aplica o feriado a toda a rede.
                    </Text>

                    <Button
                        title={editing ? 'Salvar' : 'Criar feriado'}
                        loading={createMutation.isPending || updateMutation.isPending}
                        onPress={handleSubmit(onSubmit)}
                    />
                </ScrollView>
            </Sheet>

            {/* Sheet: filtro de ano */}
            <Select<number>
                ref={yearSheetRef}
                title="Ano"
                options={YEAR_OPTIONS}
                value={year}
                onChange={setYear}
            />
        </View>
    );
}

// ─── subcomponentes ──────────────────────────────────────────────────────────

interface HolidayCardProps {
    holiday: Holiday;
    canEdit: boolean;
    onEdit: () => void;
    onDelete: () => void;
}

function HolidayCard({ holiday, canEdit, onEdit, onDelete }: HolidayCardProps) {
    return (
        <View className="rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface">
            <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1">
                    <Text className="font-mono text-sm text-neutral-500 dark:text-dark-text-muted">
                        {formatDateBR(holiday.date)}
                    </Text>
                    <Text
                        className="mt-0.5 font-sans-semibold text-base text-neutral-800 dark:text-dark-text"
                        numberOfLines={2}
                    >
                        {holiday.name}
                    </Text>
                    <View className="mt-2 flex-row">
                        <Badge
                            label={
                                holiday.store_id !== null
                                    ? (holiday.store_name ?? `Loja ${holiday.store_id}`)
                                    : 'Todas as lojas'
                            }
                            variant={holiday.store_id !== null ? 'info' : 'neutral'}
                            size="sm"
                        />
                    </View>
                </View>
            </View>

            {canEdit ? (
                <View className="mt-3 flex-row justify-end gap-2 border-t border-neutral-100 pt-3 dark:border-dark-border-soft">
                    <ActionButton label="Editar" icon="create-outline" onPress={onEdit} />
                    <ActionButton
                        label="Excluir"
                        icon="trash-outline"
                        tone="error"
                        onPress={onDelete}
                    />
                </View>
            ) : null}
        </View>
    );
}

function ActionButton({
    label,
    icon,
    tone = 'neutral',
    onPress,
}: {
    label: string;
    icon: keyof typeof import('@expo/vector-icons').Ionicons.glyphMap;
    tone?: 'neutral' | 'error';
    onPress: () => void;
}) {
    const color = tone === 'error' ? '#F04438' : '#475467';
    const textClass =
        tone === 'error'
            ? 'text-error dark:text-error-dark'
            : 'text-neutral-600 dark:text-dark-text-muted';
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={onPress}
            className="min-h-[40px] flex-row items-center gap-1.5 rounded-lg bg-neutral-50 px-3 active:opacity-80 dark:bg-dark-elevated"
        >
            <Ionicons name={icon} size={16} color={color} />
            <Text className={`font-sans-semibold text-sm ${textClass}`}>{label}</Text>
        </Pressable>
    );
}

function ListSkeleton() {
    return (
        <View className="gap-3 p-4">
            {[0, 1, 2, 3, 4].map((i) => (
                <View
                    key={i}
                    className="rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface"
                >
                    <Skeleton width="30%" height={12} />
                    <Skeleton width="55%" height={16} className="mt-2" />
                    <Skeleton width={90} height={18} radius={999} className="mt-2" />
                </View>
            ))}
        </View>
    );
}
