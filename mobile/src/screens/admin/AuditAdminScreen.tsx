import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Select, type SelectOption, type SelectRef } from '@/components/ui/Select';
import { Sheet, type SheetRef } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { TextField } from '@/components/ui/TextField';
import { useAuditLogs } from '@/hooks/useAuditLogs';
import { useAuthStore } from '@/stores/auth.store';
import { AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES } from '@/types/audit';
import { AUDIT_ACTION_LABELS, AUDIT_RESOURCE_LABELS } from '@/constants/audit';
import type { AuditLog, AuditLogFilters } from '@/types/audit';
import type { AdminStackScreenProps } from '@/navigation/types';

/**
 * Auditoria (Admin, Owner-only) — paridade READ-ONLY com o web `AuditPage`.
 *
 * - Gate Owner-only: usuários sem role owner veem "Acesso restrito"; a query não
 *   é disparada (`enabled: isOwner`).
 * - Filtros num Sheet: ação, tipo de entidade, usuário (`user_name`), data
 *   início/fim (AAAA-MM-DD → ISO no submit). Botão "Limpar filtros".
 * - Lista de cards: badge da ação, entidade + #id, usuário, data/hora, IP.
 *   Diff expansível ("Ver alterações") com old/new como chave→valor.
 * - Paginação Anterior/Próxima (limit 50).
 *
 * Header próprio (preto) — o AdminStack usa `headerShown: false`.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LIMIT = 50;

const ACTION_OPTIONS: SelectOption<string>[] = [
    { value: '', label: 'Todas as ações' },
    ...AUDIT_ACTIONS.map((a) => ({ value: a, label: AUDIT_ACTION_LABELS[a] ?? a })),
];

const RESOURCE_OPTIONS: SelectOption<string>[] = [
    { value: '', label: 'Todas as entidades' },
    ...AUDIT_RESOURCE_TYPES.map((r) => ({ value: r, label: AUDIT_RESOURCE_LABELS[r] ?? r })),
];

interface DraftFilters {
    action: string;
    resource_type: string;
    user_name: string;
    start_date: string;
    end_date: string;
}

const EMPTY_DRAFT: DraftFilters = {
    action: '',
    resource_type: '',
    user_name: '',
    start_date: '',
    end_date: '',
};

function formatDateTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('pt-BR');
}

export function AuditAdminScreen({ navigation }: AdminStackScreenProps<'AuditAdmin'>) {
    const isOwner = useAuthStore((s) => s.isOwner)();

    const [draft, setDraft] = useState<DraftFilters>(EMPTY_DRAFT);
    const [applied, setApplied] = useState<DraftFilters>(EMPTY_DRAFT);
    const [page, setPage] = useState(1);

    const filterSheetRef = useRef<SheetRef>(null);
    const actionSelectRef = useRef<SelectRef>(null);
    const resourceSelectRef = useRef<SelectRef>(null);

    // Monta os filtros da query a partir dos aplicados (datas → ISO), como o web.
    const query = useMemo<AuditLogFilters>(() => {
        const f: AuditLogFilters = { limit: LIMIT, page };
        if (applied.action) f.action = applied.action;
        if (applied.resource_type) f.resource_type = applied.resource_type;
        if (applied.user_name.trim()) f.user_name = applied.user_name.trim();
        if (DATE_RE.test(applied.start_date))
            f.start_date = new Date(applied.start_date).toISOString();
        if (DATE_RE.test(applied.end_date)) f.end_date = new Date(applied.end_date).toISOString();
        return f;
    }, [applied, page]);

    const { data, isLoading, isError, refetch, isRefetching } = useAuditLogs(query, isOwner);

    const logs = data?.items ?? [];
    const pagination = data?.pagination;

    const activeFilterCount = useMemo(
        () =>
            [
                applied.action,
                applied.resource_type,
                applied.user_name.trim(),
                applied.start_date,
                applied.end_date,
            ].filter(Boolean).length,
        [applied]
    );

    const openFilters = useCallback(() => {
        setDraft(applied);
        filterSheetRef.current?.present();
    }, [applied]);

    const applyFilters = useCallback(() => {
        setApplied(draft);
        setPage(1);
        filterSheetRef.current?.dismiss();
    }, [draft]);

    const clearFilters = useCallback(() => {
        setDraft(EMPTY_DRAFT);
        setApplied(EMPTY_DRAFT);
        setPage(1);
        filterSheetRef.current?.dismiss();
    }, []);

    // ─── Gate Owner-only ────────────────────────────────────────────────────────
    if (!isOwner) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <AuditHeader subtitle="Acesso restrito" onBack={() => navigation.goBack()} />
                <View className="mx-4 mt-6 items-center rounded-2xl border border-neutral-100 bg-white px-6 py-10 dark:border-dark-border-soft dark:bg-dark-surface">
                    <Ionicons name="lock-closed-outline" size={32} color="#98A2B3" />
                    <Text className="mt-3 text-center font-sans-semibold text-base text-neutral-700 dark:text-dark-text">
                        Acesso restrito
                    </Text>
                    <Text className="mt-1 text-center font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
                        Apenas o proprietário (Owner) pode consultar a trilha de auditoria.
                    </Text>
                </View>
            </View>
        );
    }

    const subtitle = isLoading
        ? 'Carregando...'
        : pagination
          ? `${pagination.total} ${pagination.total === 1 ? 'registro' : 'registros'}`
          : 'Trilha de ações do sistema';

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <AuditHeader
                subtitle={subtitle}
                onBack={() => navigation.goBack()}
                filterCount={activeFilterCount}
                onFilter={openFilters}
            />

            {isLoading ? (
                <ListSkeleton />
            ) : isError ? (
                <ErrorState
                    title="Falha ao carregar"
                    description="Não foi possível carregar os registros de auditoria."
                    onRetry={() => void refetch()}
                />
            ) : (
                <ScrollView
                    className="flex-1"
                    contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
                    }
                >
                    {logs.length === 0 ? (
                        <EmptyState
                            icon="shield-checkmark-outline"
                            title="Nenhum registro"
                            description="Nenhuma ação encontrada para os filtros selecionados."
                        />
                    ) : (
                        <View className="gap-3">
                            {logs.map((log) => (
                                <AuditCard key={log.id} log={log} />
                            ))}
                        </View>
                    )}

                    {pagination && pagination.total_pages > 1 ? (
                        <View className="mt-4 flex-row items-center justify-between">
                            <Text className="font-sans text-sm text-neutral-500 dark:text-dark-text-muted">
                                Página {pagination.page} de {pagination.total_pages}
                            </Text>
                            <View className="flex-row gap-2">
                                <Button
                                    title="Anterior"
                                    variant="secondary"
                                    size="sm"
                                    disabled={pagination.page <= 1}
                                    onPress={() => setPage((p) => Math.max(1, p - 1))}
                                />
                                <Button
                                    title="Próxima"
                                    variant="secondary"
                                    size="sm"
                                    disabled={pagination.page >= pagination.total_pages}
                                    onPress={() => setPage((p) => p + 1)}
                                />
                            </View>
                        </View>
                    ) : null}
                </ScrollView>
            )}

            {/* Sheet: filtros */}
            <Sheet ref={filterSheetRef} title="Filtrar auditoria">
                <ScrollView
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={{ paddingBottom: 24 }}
                    showsVerticalScrollIndicator={false}
                >
                    {/* Ação */}
                    <Text className="mb-1.5 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
                        Ação
                    </Text>
                    <FilterSelectField
                        label={ACTION_OPTIONS.find((o) => o.value === draft.action)?.label ?? 'Todas as ações'}
                        placeholder={draft.action === ''}
                        onPress={() => actionSelectRef.current?.present()}
                    />
                    <Select<string>
                        ref={actionSelectRef}
                        title="Ação"
                        options={ACTION_OPTIONS}
                        value={draft.action}
                        onChange={(v) => setDraft((d) => ({ ...d, action: v }))}
                    />

                    <View className="h-3" />

                    {/* Tipo de entidade */}
                    <Text className="mb-1.5 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
                        Tipo de entidade
                    </Text>
                    <FilterSelectField
                        label={
                            RESOURCE_OPTIONS.find((o) => o.value === draft.resource_type)?.label ??
                            'Todas as entidades'
                        }
                        placeholder={draft.resource_type === ''}
                        onPress={() => resourceSelectRef.current?.present()}
                    />
                    <Select<string>
                        ref={resourceSelectRef}
                        title="Tipo de entidade"
                        options={RESOURCE_OPTIONS}
                        value={draft.resource_type}
                        onChange={(v) => setDraft((d) => ({ ...d, resource_type: v }))}
                    />

                    <View className="h-4" />

                    <TextField
                        label="Usuário"
                        value={draft.user_name}
                        onChangeText={(v) => setDraft((d) => ({ ...d, user_name: v }))}
                        placeholder="Nome do usuário"
                        autoCapitalize="none"
                        autoCorrect={false}
                    />

                    <TextField
                        label="Data início"
                        value={draft.start_date}
                        onChangeText={(v) => setDraft((d) => ({ ...d, start_date: v }))}
                        placeholder="AAAA-MM-DD"
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="numbers-and-punctuation"
                    />

                    <TextField
                        label="Data fim"
                        value={draft.end_date}
                        onChangeText={(v) => setDraft((d) => ({ ...d, end_date: v }))}
                        placeholder="AAAA-MM-DD"
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="numbers-and-punctuation"
                    />

                    <View className="mt-2 gap-2">
                        <Button title="Aplicar filtros" onPress={applyFilters} />
                        <Button title="Limpar filtros" variant="ghost" onPress={clearFilters} />
                    </View>
                </ScrollView>
            </Sheet>
        </View>
    );
}

// ─── subcomponentes ──────────────────────────────────────────────────────────

function AuditHeader({
    subtitle,
    onBack,
    filterCount,
    onFilter,
}: {
    subtitle: string;
    onBack: () => void;
    filterCount?: number;
    onFilter?: () => void;
}) {
    return (
        <SafeAreaView edges={['top']} className="bg-brand-black">
            <View className="px-4 pb-3 pt-2">
                <View className="flex-row items-center gap-3">
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Voltar"
                        onPress={onBack}
                        hitSlop={8}
                        className="h-11 w-11 items-center justify-center rounded-full active:bg-white/10"
                    >
                        <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
                    </Pressable>
                    <View className="flex-1">
                        <Text className="font-display-bold text-xl text-white">Auditoria</Text>
                        <Text className="mt-0.5 font-sans text-sm text-neutral-400">{subtitle}</Text>
                    </View>
                    {onFilter ? (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Filtrar"
                            onPress={onFilter}
                            className="h-11 w-11 items-center justify-center rounded-full bg-white/10 active:opacity-70"
                        >
                            <Ionicons name="filter-outline" size={20} color="#FFFFFF" />
                            {filterCount ? (
                                <View className="absolute right-1.5 top-1.5 h-4 min-w-[16px] items-center justify-center rounded-full bg-brand px-1">
                                    <Text className="font-sans-bold text-[10px] text-brand-black">
                                        {filterCount}
                                    </Text>
                                </View>
                            ) : null}
                        </Pressable>
                    ) : null}
                </View>
            </View>
        </SafeAreaView>
    );
}

function FilterSelectField({
    label,
    placeholder,
    onPress,
}: {
    label: string;
    placeholder: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
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
    );
}

function AuditCard({ log }: { log: AuditLog }) {
    const [expanded, setExpanded] = useState(false);

    const actionLabel = AUDIT_ACTION_LABELS[log.action] ?? log.action;
    const resourceLabel = AUDIT_RESOURCE_LABELS[log.resource_type] ?? log.resource_type;
    const hasDiff = !!log.old_value || !!log.new_value;

    return (
        <View className="rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface">
            <View className="flex-row items-start justify-between gap-2">
                <View className="flex-1">
                    <Text
                        className="font-sans-semibold text-base text-neutral-800 dark:text-dark-text"
                        numberOfLines={1}
                    >
                        {resourceLabel}
                        {log.resource_id != null ? (
                            <Text className="font-sans text-neutral-400 dark:text-dark-text-muted">
                                {' '}
                                #{log.resource_id}
                            </Text>
                        ) : null}
                    </Text>
                    <Text className="mt-0.5 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                        {log.user_name ?? '—'}
                    </Text>
                </View>
                <Badge label={actionLabel} variant="neutral" size="sm" />
            </View>

            <View className="mt-2 flex-row flex-wrap items-center gap-x-3 gap-y-1">
                <Text className="font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                    {formatDateTime(log.created_at)}
                </Text>
                {log.ip_address ? (
                    <Text className="font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                        IP {log.ip_address}
                    </Text>
                ) : null}
            </View>

            {hasDiff ? (
                <>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={expanded ? 'Ocultar alterações' : 'Ver alterações'}
                        onPress={() => setExpanded((e) => !e)}
                        hitSlop={6}
                        className="mt-3 flex-row items-center gap-1 active:opacity-70"
                    >
                        <Ionicons
                            name={expanded ? 'chevron-up' : 'chevron-down'}
                            size={14}
                            color="#2E90FA"
                        />
                        <Text className="font-sans-semibold text-xs text-info">
                            {expanded ? 'Ocultar alterações' : 'Ver alterações'}
                        </Text>
                    </Pressable>

                    {expanded ? (
                        <View className="mt-2 gap-3 border-t border-neutral-100 pt-3 dark:border-dark-border-soft">
                            {log.old_value ? (
                                <DiffBlock title="Antes" value={log.old_value} />
                            ) : null}
                            {log.new_value ? (
                                <DiffBlock title="Depois" value={log.new_value} />
                            ) : null}
                        </View>
                    ) : null}
                </>
            ) : null}
        </View>
    );
}

function DiffBlock({ title, value }: { title: string; value: Record<string, unknown> }) {
    const entries = Object.entries(value);
    return (
        <View>
            <Text className="mb-1 font-sans-semibold text-xs uppercase tracking-wide text-neutral-400">
                {title}
            </Text>
            {entries.length === 0 ? (
                <Text className="font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                    (vazio)
                </Text>
            ) : (
                <View className="gap-1">
                    {entries.map(([key, val]) => (
                        <View key={key} className="flex-row flex-wrap gap-1">
                            <Text className="font-sans-semibold text-xs text-neutral-600 dark:text-dark-text-muted">
                                {key}:
                            </Text>
                            <Text className="flex-1 font-sans text-xs text-neutral-700 dark:text-dark-text">
                                {formatValue(val)}
                            </Text>
                        </View>
                    ))}
                </View>
            )}
        </View>
    );
}

function formatValue(val: unknown): string {
    if (val === null || val === undefined) return '—';
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        return String(val);
    }
    return JSON.stringify(val);
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
                        <Skeleton width={72} height={18} radius={999} />
                    </View>
                    <Skeleton width="30%" height={12} className="mt-2" />
                    <Skeleton width="55%" height={12} className="mt-2" />
                </View>
            ))}
        </View>
    );
}
