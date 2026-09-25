import { useCallback, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    RefreshControl,
    ScrollView,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Resolver } from 'react-hook-form';
import { z } from 'zod';

import { useConfirm } from '@/components/ui';
import { StoreSelector } from '@/components/common/StoreSelector';
import { PhotoCapture } from '@/components/features/PhotoCapture';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Select, type SelectOption, type SelectRef } from '@/components/ui/Select';
import { Sheet, type SheetRef } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { TextField } from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';
import {
    useDayStatus,
    useDeleteFault,
    useMarkFault,
    useReturnFromAbsence,
} from '@/hooks/useEmployees';
import { useStoreStore } from '@/stores/store.store';
import { useCanEdit } from '@/hooks/useMyPermissions';
import { downloadAndSharePdf } from '@/utils/exportShare';
import { resolveMediaUrl } from '@/lib/resolveMediaUrl';
import { getApiErrorMessage } from '@/lib/api-error';
import { FAULT_TYPES } from '@/constants/employees';
import type { DayStatus, EmployeeDayStatusItem } from '@/types/employee.types';
import type { Photo } from '@/types/photo.types';
import type { AdminStackScreenProps } from '@/navigation/types';

/**
 * Faltas do Dia (Admin) — paridade com o web `DayAbsencesPage`.
 *
 * - Filtro de loja (StoreSelector global) + data (AAAA-MM-DD). O endpoint exige
 *   uma loja: sem loja selecionada, mostra estado de "selecione uma loja".
 * - Contadores presente/falta/férias/afastado e lista de funcionários com badge.
 * - Marcar falta (Sheet com tipo + dias + observação + foto opcional via
 *   PhotoCapture; sobe a foto e usa `attachment_url`), desfazer falta (destrutivo,
 *   com confirmação), registrar retorno (quando `needs_return`), ver anexo
 *   (PhotoViewer).
 * - Relatório de frequência do funcionário (PDF) via `downloadAndSharePdf`.
 *
 * Header próprio (preto) — o AdminStack usa `headerShown: false`.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
}

const STATUS_META: Record<DayStatus, { label: string; variant: BadgeVariant }> = {
    presente: { label: 'Presente', variant: 'success' },
    falta: { label: 'Falta', variant: 'error' },
    ferias: { label: 'Férias', variant: 'info' },
    afastado: { label: 'Afastado', variant: 'warning' },
};

// ─── mark-fault form ─────────────────────────────────────────────────────────

const markFaultSchema = z.object({
    fault_type: z.string().min(1, 'Selecione o tipo de falta'),
    days_count: z.string().optional(),
    notes: z.string().optional(),
});
type MarkFaultForm = z.infer<typeof markFaultSchema>;

const FAULT_TYPE_OPTIONS: SelectOption<string>[] = FAULT_TYPES.map((t) => ({
    value: t.value,
    label: t.label,
}));

export function DayAbsencesScreen({ navigation }: AdminStackScreenProps<'DayAbsencesAdmin'>) {
    const toast = useToast();
    const { confirm } = useConfirm();
    const selectedStoreId = useStoreStore((s) => s.selectedStoreId);
    const canEdit = useCanEdit('employees');

    const [date, setDate] = useState<string>(todayIso());
    const validDate = DATE_RE.test(date) ? date : undefined;

    const {
        data,
        isLoading,
        isError,
        refetch,
        isRefetching,
    } = useDayStatus(selectedStoreId ?? undefined, validDate ?? '');

    const markFaultMutation = useMarkFault(selectedStoreId ?? undefined, validDate ?? '');
    const deleteFaultMutation = useDeleteFault(selectedStoreId ?? undefined, validDate ?? '');
    const returnMutation = useReturnFromAbsence(selectedStoreId ?? undefined, validDate ?? '');

    // ─── mark-fault sheet ──────────────────────────────────────────────────────
    const markSheetRef = useRef<SheetRef>(null);
    const faultTypeSheetRef = useRef<SelectRef>(null);
    const [faultTarget, setFaultTarget] = useState<EmployeeDayStatusItem | null>(null);
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [submitting, setSubmitting] = useState(false);

    const {
        control,
        handleSubmit,
        reset,
        formState: { errors },
    } = useForm<MarkFaultForm>({
        resolver: zodResolver(markFaultSchema) as unknown as Resolver<MarkFaultForm>,
        defaultValues: { fault_type: '', days_count: '1', notes: '' },
    });

    const openMarkFault = useCallback(
        (item: EmployeeDayStatusItem) => {
            setFaultTarget(item);
            setPhotos([]);
            reset({ fault_type: '', days_count: '1', notes: '' });
            markSheetRef.current?.present();
        },
        [reset]
    );

    const onSubmitFault = useCallback(
        async (form: MarkFaultForm) => {
            if (!faultTarget || !validDate) return;

            // Anexo (opcional): exige que a foto já tenha subido (url pronta).
            const pending = photos.find((p) => !p.url && !p.error);
            if (pending) {
                toast.info('Aguarde o envio da foto terminar.');
                return;
            }
            const failed = photos.find((p) => p.error);
            if (failed) {
                toast.error('A foto falhou no envio. Remova-a ou tente novamente.');
                return;
            }
            const attachmentUrl = photos.find((p) => p.url)?.url ?? null;

            setSubmitting(true);
            markFaultMutation.mutate(
                {
                    employeeId: faultTarget.employee_id,
                    payload: {
                        type: 'fault',
                        movement_date: validDate,
                        movement_data: {
                            fault_type: form.fault_type,
                            date: validDate,
                            days_count: form.days_count ? Number(form.days_count) : 1,
                        },
                        notes: form.notes?.trim() ? form.notes.trim() : null,
                        attachment_url: attachmentUrl,
                    },
                },
                {
                    onSuccess: () => {
                        toast.success('Falta registrada.');
                        markSheetRef.current?.dismiss();
                        setFaultTarget(null);
                        setPhotos([]);
                        reset({ fault_type: '', days_count: '1', notes: '' });
                    },
                    onError: (err) => {
                        toast.error(getApiErrorMessage(err as Error, 'Erro ao registrar falta.'));
                    },
                    onSettled: () => setSubmitting(false),
                }
            );
        },
        [faultTarget, validDate, photos, markFaultMutation, reset, toast]
    );

    const confirmUndo = useCallback(
        async (item: EmployeeDayStatusItem) => {
            const movementId = item.fault_movement_id;
            if (!movementId) return;
            const ok = await confirm({
                title: 'Desfazer falta',
                message: `Remover a falta de ${item.name} em ${date}? Esta ação não pode ser desfeita.`,
                confirmLabel: 'Desfazer',
                destructive: true,
            });
            if (ok) {
                deleteFaultMutation.mutate(
                    {
                        employeeId: item.employee_id,
                        movementId,
                    },
                    {
                        onSuccess: () => toast.success('Falta desfeita.'),
                        onError: (err) =>
                            toast.error(
                                getApiErrorMessage(err as Error, 'Erro ao desfazer falta.')
                            ),
                    }
                );
            }
        },
        [confirm, date, deleteFaultMutation, toast]
    );

    const confirmReturn = useCallback(
        async (item: EmployeeDayStatusItem) => {
            const ok = await confirm({
                title: 'Registrar retorno',
                message: `Confirmar o retorno de ${item.name}? O status de RH será atualizado para Ativo.`,
                confirmLabel: 'Confirmar',
            });
            if (ok) {
                returnMutation.mutate(item.employee_id, {
                    onSuccess: () => toast.success('Retorno registrado.'),
                    onError: (err) =>
                        toast.error(
                            getApiErrorMessage(err as Error, 'Erro ao registrar retorno.')
                        ),
                });
            }
        },
        [confirm, returnMutation, toast]
    );

    const viewAttachment = useCallback(
        (item: EmployeeDayStatusItem) => {
            if (!item.attachment_url) return;
            navigation.navigate('PhotoViewer', {
                photos: [resolveMediaUrl(item.attachment_url)],
                title: `Anexo — ${item.name}`,
            });
        },
        [navigation]
    );

    // ─── frequency report sheet ────────────────────────────────────────────────
    const freqSheetRef = useRef<SelectRef>(null);
    const [exporting, setExporting] = useState(false);

    const items = useMemo(() => data?.items ?? [], [data]);
    const employeeOptions = useMemo<SelectOption<number>[]>(
        () =>
            [...items]
                .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
                .map((i) => ({
                    value: i.employee_id,
                    label: i.position ? `${i.name} — ${i.position}` : i.name,
                })),
        [items]
    );

    const handleFrequencyReport = useCallback(
        async (employeeId: number) => {
            if (!validDate || exporting) return;
            const employee = items.find((i) => i.employee_id === employeeId);
            const safeName = (employee?.name ?? String(employeeId))
                .replace(/\s+/g, '_')
                .replace(/[^a-zA-Z0-9_-]/g, '');
            const yyyymm = validDate.slice(0, 7).replace('-', '');
            setExporting(true);
            try {
                await downloadAndSharePdf({
                    path: `/employees/${employeeId}/frequency-report`,
                    params: { date: validDate },
                    filename: `frequencia_${safeName}_${yyyymm}.pdf`,
                });
            } catch (err) {
                toast.error(getApiErrorMessage(err as Error, 'Não foi possível gerar o PDF.'));
            } finally {
                setExporting(false);
            }
        },
        [validDate, exporting, items, toast]
    );

    const hasStore = selectedStoreId != null;
    const subtitle = !hasStore
        ? 'Selecione uma loja'
        : isLoading
          ? 'Carregando...'
          : `${items.length} ${items.length === 1 ? 'funcionário' : 'funcionários'}`;

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
                            <Text className="font-display-bold text-xl text-white">Faltas do Dia</Text>
                            <Text className="mt-0.5 font-sans text-sm text-neutral-400">{subtitle}</Text>
                        </View>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Relatório de frequência"
                            accessibilityState={{ busy: exporting, disabled: exporting || !hasStore }}
                            disabled={exporting || !hasStore}
                            onPress={() => freqSheetRef.current?.present()}
                            className={`h-11 w-11 items-center justify-center rounded-full bg-white/10 active:opacity-70 ${
                                exporting || !hasStore ? 'opacity-50' : ''
                            }`}
                        >
                            {exporting ? (
                                <ActivityIndicator color="#FFFFFF" />
                            ) : (
                                <Ionicons name="document-text-outline" size={20} color="#FFFFFF" />
                            )}
                        </Pressable>
                    </View>

                    {/* Filtros: loja (global) + data */}
                    <View className="mt-3 flex-row items-end gap-3">
                        <View className="flex-1">
                            <FilterLabel>Loja</FilterLabel>
                            <StoreSelector />
                        </View>
                        <View className="w-[150px]">
                            <FilterLabel>Data</FilterLabel>
                            <TextInput
                                accessibilityLabel="Data"
                                placeholder="AAAA-MM-DD"
                                value={date}
                                onChangeText={setDate}
                                autoCapitalize="none"
                                autoCorrect={false}
                                keyboardType="numbers-and-punctuation"
                                placeholderTextColor="#98A2B3"
                                className="min-h-[44px] rounded-lg bg-white/10 px-3 py-2 font-sans text-base text-white"
                                style={{ color: '#FFFFFF' }}
                            />
                        </View>
                    </View>
                </View>
            </SafeAreaView>

            {/* Conteúdo */}
            {!hasStore ? (
                <EmptyState
                    icon="storefront-outline"
                    title="Selecione uma loja"
                    description="Escolha uma loja no seletor acima para ver o status do dia."
                />
            ) : isLoading ? (
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
                    {/* Contadores */}
                    {data ? (
                        <View className="mb-4 flex-row flex-wrap gap-2">
                            <CounterCard label="Presentes" value={data.present} tone="text-success" />
                            <CounterCard label="Faltas" value={data.faults} tone="text-error" />
                            <CounterCard label="Férias" value={data.vacations} tone="text-info" />
                            <CounterCard label="Afastados" value={data.absences} tone="text-warning" />
                        </View>
                    ) : null}

                    {items.length === 0 ? (
                        <EmptyState
                            icon="people-outline"
                            title="Nenhum funcionário"
                            description="Nenhum funcionário encontrado para esta loja e data."
                        />
                    ) : (
                        <View className="gap-3">
                            {items.map((item) => (
                                <DayStatusCard
                                    key={item.employee_id}
                                    item={item}
                                    canEdit={canEdit}
                                    onMarkFault={() => openMarkFault(item)}
                                    onUndo={() => confirmUndo(item)}
                                    onReturn={() => confirmReturn(item)}
                                    onViewAttachment={() => viewAttachment(item)}
                                />
                            ))}
                        </View>
                    )}
                </ScrollView>
            )}

            {/* Sheet: marcar falta */}
            <Sheet ref={markSheetRef} title="Marcar falta">
                <ScrollView
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={{ paddingBottom: 24 }}
                    showsVerticalScrollIndicator={false}
                >
                    {faultTarget ? (
                        <View className="mb-4 rounded-xl border border-neutral-100 bg-neutral-50 p-3 dark:border-dark-border-soft dark:bg-dark-elevated">
                            <Text className="font-sans-semibold text-sm text-neutral-800 dark:text-dark-text">
                                {faultTarget.name}
                            </Text>
                            {faultTarget.position ? (
                                <Text className="font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                                    {faultTarget.position}
                                </Text>
                            ) : null}
                            <Text className="mt-0.5 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                                Data: {date}
                            </Text>
                        </View>
                    ) : null}

                    {/* Tipo de falta */}
                    <Text className="mb-1.5 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
                        Tipo de falta
                    </Text>
                    <Controller
                        control={control}
                        name="fault_type"
                        render={({ field: { value, onChange } }) => {
                            const label =
                                FAULT_TYPE_OPTIONS.find((o) => o.value === value)?.label ??
                                'Selecione o tipo';
                            return (
                                <>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={`Tipo de falta: ${label}`}
                                        onPress={() => faultTypeSheetRef.current?.present()}
                                        className={`min-h-[48px] flex-row items-center justify-between rounded-lg border px-4 py-3 active:opacity-70 ${
                                            errors.fault_type
                                                ? 'border-error'
                                                : 'border-neutral-200 dark:border-dark-border-strong'
                                        } bg-white dark:bg-dark-input`}
                                    >
                                        <Text
                                            className={`font-sans text-base ${
                                                value
                                                    ? 'text-neutral-900 dark:text-dark-text'
                                                    : 'text-neutral-400'
                                            }`}
                                        >
                                            {label}
                                        </Text>
                                        <Ionicons name="chevron-down" size={18} color="#98A2B3" />
                                    </Pressable>
                                    <Select<string>
                                        ref={faultTypeSheetRef}
                                        title="Tipo de falta"
                                        options={FAULT_TYPE_OPTIONS}
                                        value={value}
                                        onChange={onChange}
                                    />
                                </>
                            );
                        }}
                    />
                    {errors.fault_type ? (
                        <Text className="mb-2 mt-1 font-sans text-sm text-error">
                            {errors.fault_type.message}
                        </Text>
                    ) : (
                        <View className="mb-3" />
                    )}

                    {/* Dias */}
                    <Controller
                        control={control}
                        name="days_count"
                        render={({ field: { value, onChange } }) => (
                            <TextField
                                label="Quantidade de dias"
                                value={value ?? ''}
                                onChangeText={onChange}
                                keyboardType="number-pad"
                                placeholder="1"
                            />
                        )}
                    />

                    {/* Observação */}
                    <Controller
                        control={control}
                        name="notes"
                        render={({ field: { value, onChange } }) => (
                            <TextField
                                label="Observação (opcional)"
                                value={value ?? ''}
                                onChangeText={onChange}
                                placeholder="Ex.: atestado entregue no RH"
                                multiline
                                numberOfLines={2}
                                style={{ minHeight: 60, textAlignVertical: 'top' }}
                            />
                        )}
                    />

                    {/* Anexo (opcional): foto do atestado / print */}
                    <View className="mb-4">
                        <PhotoCapture
                            label="Anexo (opcional)"
                            value={photos}
                            onChange={setPhotos}
                            maxPhotos={1}
                            minPhotos={0}
                        />
                        <Text className="mt-1 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                            Ex.: foto do atestado ou print da conversa.
                        </Text>
                    </View>

                    <Button
                        title="Registrar falta"
                        loading={submitting || markFaultMutation.isPending}
                        onPress={handleSubmit(onSubmitFault)}
                    />
                </ScrollView>
            </Sheet>

            {/* Sheet: escolher funcionário p/ relatório de frequência */}
            <Select<number>
                ref={freqSheetRef}
                title="Relatório de frequência"
                options={employeeOptions}
                value={null}
                onChange={(id) => void handleFrequencyReport(id)}
            />
        </View>
    );
}

// ─── subcomponentes ──────────────────────────────────────────────────────────

function FilterLabel({ children }: { children: string }) {
    return (
        <Text className="mb-1 font-sans-medium text-xs uppercase tracking-wide text-neutral-400">
            {children}
        </Text>
    );
}

function CounterCard({ label, value, tone }: { label: string; value: number; tone: string }) {
    return (
        <View className="min-w-[76px] flex-1 rounded-xl border border-neutral-100 bg-white px-3 py-2.5 dark:border-dark-border-soft dark:bg-dark-surface">
            <Text className={`font-display-bold text-xl ${tone}`}>{value}</Text>
            <Text className="font-sans text-[11px] text-neutral-400 dark:text-dark-text-muted">
                {label}
            </Text>
        </View>
    );
}

interface DayStatusCardProps {
    item: EmployeeDayStatusItem;
    canEdit: boolean;
    onMarkFault: () => void;
    onUndo: () => void;
    onReturn: () => void;
    onViewAttachment: () => void;
}

function DayStatusCard({
    item,
    canEdit,
    onMarkFault,
    onUndo,
    onReturn,
    onViewAttachment,
}: DayStatusCardProps) {
    const meta = STATUS_META[item.status];
    return (
        <View className="rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface">
            <View className="flex-row items-start justify-between gap-2">
                <View className="flex-1">
                    <Text
                        className="font-sans-semibold text-base text-neutral-800 dark:text-dark-text"
                        numberOfLines={1}
                    >
                        {item.name}
                    </Text>
                    <Text
                        className="mt-0.5 font-sans text-xs text-neutral-400 dark:text-dark-text-muted"
                        numberOfLines={1}
                    >
                        {item.position || '—'}
                    </Text>
                </View>
                <Badge label={meta.label} variant={meta.variant} size="sm" />
            </View>

            {/* Motivo + anexo */}
            {item.reason || item.attachment_url || item.needs_return ? (
                <View className="mt-2 flex-row flex-wrap items-center gap-2">
                    {item.reason ? (
                        <Text className="font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                            {item.reason}
                        </Text>
                    ) : null}
                    {item.needs_return ? (
                        <Badge label="Cadastro desatualizado" variant="warning" size="sm" />
                    ) : null}
                    {item.attachment_url ? (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Ver anexo da falta"
                            onPress={onViewAttachment}
                            hitSlop={6}
                            className="flex-row items-center gap-1 active:opacity-70"
                        >
                            <Ionicons name="attach-outline" size={14} color="#2E90FA" />
                            <Text className="font-sans-semibold text-xs text-info">anexo</Text>
                        </Pressable>
                    ) : null}
                </View>
            ) : null}

            {/* Ações (só com can_edit) */}
            {canEdit ? (
                <View className="mt-3 flex-row flex-wrap justify-end gap-2 border-t border-neutral-100 pt-3 dark:border-dark-border-soft">
                    {item.status === 'presente' ? (
                        <ActionButton
                            label="Marcar falta"
                            icon="close-circle-outline"
                            tone="error"
                            onPress={onMarkFault}
                        />
                    ) : null}
                    {item.status === 'falta' && item.fault_movement_id ? (
                        <ActionButton label="Desfazer" icon="arrow-undo-outline" onPress={onUndo} />
                    ) : null}
                    {item.needs_return ? (
                        <ActionButton
                            label="Registrar retorno"
                            icon="refresh-outline"
                            tone="warning"
                            onPress={onReturn}
                        />
                    ) : null}
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
    tone?: 'neutral' | 'error' | 'warning';
    onPress: () => void;
}) {
    const color = tone === 'error' ? '#F04438' : tone === 'warning' ? '#F79009' : '#475467';
    const textClass =
        tone === 'error'
            ? 'text-error dark:text-error-dark'
            : tone === 'warning'
              ? 'text-warning dark:text-warning-dark'
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
                    <View className="flex-row justify-between">
                        <Skeleton width="45%" height={16} />
                        <Skeleton width={64} height={18} radius={999} />
                    </View>
                    <Skeleton width="30%" height={12} className="mt-2" />
                </View>
            ))}
        </View>
    );
}
