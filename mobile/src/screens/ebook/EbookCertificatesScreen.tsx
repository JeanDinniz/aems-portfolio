import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useConfirm } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Select, type SelectOption, type SelectRef } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { Sheet, type SheetRef } from '@/components/ui/Sheet';
import { useToast } from '@/components/ui/Toast';
import { GenerateCertificateSheet } from './GenerateCertificateSheet';
import { useCertificates, useDeleteCertificate } from '@/hooks/useEbook';
import { useStores } from '@/hooks/useStores';
import { useAuthStore } from '@/stores/auth.store';
import { downloadAndSharePdf } from '@/utils/exportShare';
import { getApiErrorMessage } from '@/lib/api-error';
import { formatDateBR } from '@/utils/formatDate';
import type { Certificate } from '@/types/ebook.types';
import type { AppStackScreenProps } from '@/navigation/types';

// Marcas que emitem certificado (paridade com o web CertificatesPage).
const BRAND_OPTIONS: { code: string; label: string }[] = [
    { code: 'toyota', label: 'Toyota' },
    { code: 'byd', label: 'BYD' },
    { code: 'fiat', label: 'Fiat' },
    { code: 'hyundai', label: 'Hyundai' },
];

/**
 * Certificados emitidos (paridade com o web `CertificatesPage`).
 *
 * Lista paginada (Anterior/Próxima, limit 50). Cards com cliente, placa, O.S.,
 * status da garantia (vigente/vencida), loja, serviço, garantia, data e emissor.
 * Ações: Baixar PDF (`downloadAndSharePdf`), Editar (abre o Sheet em modo edição)
 * e Excluir (só Owner, com confirmação). Botão "Gerar" no header abre o mesmo
 * Sheet em modo criação.
 *
 * Header próprio (preto) — o AppStack usa `headerShown: false`.
 */

const LIMIT = 50;

export function EbookCertificatesScreen({
    navigation,
}: AppStackScreenProps<'EbookCertificates'>) {
    const toast = useToast();
    const { confirm } = useConfirm();
    const isOwner = useAuthStore((s) => s.isOwner)();
    const { stores } = useStores();
    const [page, setPage] = useState(1);
    const [downloadingId, setDownloadingId] = useState<number | null>(null);
    const [editingCert, setEditingCert] = useState<Certificate | null>(null);

    // Filtros (paridade com o web): loja e marca. `null` = todas.
    const [storeFilter, setStoreFilter] = useState<number | null>(null);
    const [brandFilter, setBrandFilter] = useState<string | null>(null);

    const { data, isLoading, isError, refetch, isRefetching } = useCertificates({
        page,
        limit: LIMIT,
        ...(storeFilter != null && { store_id: storeFilter }),
        ...(brandFilter != null && { brand_code: brandFilter }),
    });
    const deleteCertificate = useDeleteCertificate();
    const certSheetRef = useRef<SheetRef>(null);
    const filterSheetRef = useRef<SheetRef>(null);
    const storeSelectRef = useRef<SelectRef>(null);
    const brandSelectRef = useRef<SelectRef>(null);

    // Só mostra o filtro de loja quando o usuário tem acesso a mais de uma (web faz igual).
    const showStoreFilter = stores.length > 1;
    const activeFilterCount = (storeFilter != null ? 1 : 0) + (brandFilter != null ? 1 : 0);

    const storeOptions = useMemo<SelectOption<number>[]>(
        () => stores.map((s) => ({ value: s.id, label: s.name })),
        [stores]
    );

    const setStoreFilterReset = useCallback((v: number | null) => {
        setStoreFilter(v);
        setPage(1);
    }, []);
    const setBrandFilterReset = useCallback((v: string | null) => {
        setBrandFilter(v);
        setPage(1);
    }, []);

    const openCreate = useCallback(() => {
        setEditingCert(null);
        certSheetRef.current?.present();
    }, []);

    const openEdit = useCallback((cert: Certificate) => {
        setEditingCert(cert);
        certSheetRef.current?.present();
    }, []);

    const items = data?.items ?? [];
    const pagination = data?.pagination;

    const handleDownload = useCallback(
        async (cert: Certificate) => {
            if (downloadingId != null) return;
            setDownloadingId(cert.id);
            try {
                const label = (cert.plate ?? String(cert.id))
                    .replace(/\s+/g, '_')
                    .replace(/[^a-zA-Z0-9_-]/g, '');
                await downloadAndSharePdf({
                    path: `/ebook/certificates/${cert.id}/pdf`,
                    filename: `certificado_${label}.pdf`,
                });
            } catch (err) {
                toast.error(getApiErrorMessage(err as Error, 'Não foi possível gerar o PDF.'));
            } finally {
                setDownloadingId(null);
            }
        },
        [downloadingId, toast]
    );

    const confirmDelete = useCallback(
        async (cert: Certificate) => {
            const ok = await confirm({
                title: 'Excluir certificado',
                message: `Remover o certificado de ${cert.customer_name ?? 'cliente'}${
                    cert.plate ? ` (${cert.plate.toUpperCase()})` : ''
                }? Esta ação não pode ser desfeita.`,
                confirmLabel: 'Excluir',
                destructive: true,
            });
            if (ok) {
                deleteCertificate.mutate(cert.id, {
                    onSuccess: () => toast.success('Certificado excluído.'),
                });
            }
        },
        [confirm, deleteCertificate, toast]
    );

    const subtitle = isLoading
        ? 'Carregando...'
        : pagination
          ? `${pagination.total} ${pagination.total === 1 ? 'certificado' : 'certificados'}`
          : 'Histórico de certificados';

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <SafeAreaView edges={['top']} className="bg-brand-black">
                <View className="flex-row items-center gap-3 px-4 pb-3 pt-2">
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
                        <Text className="font-display-bold text-xl text-white">Certificados</Text>
                        <Text className="mt-0.5 font-sans text-sm text-neutral-400">{subtitle}</Text>
                    </View>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={
                            activeFilterCount > 0
                                ? `Filtros (${activeFilterCount} ativo${activeFilterCount > 1 ? 's' : ''})`
                                : 'Filtros'
                        }
                        onPress={() => filterSheetRef.current?.present()}
                        className="h-11 w-11 items-center justify-center rounded-full bg-white/10 active:opacity-70"
                    >
                        <Ionicons name="filter" size={20} color="#FFFFFF" />
                        {activeFilterCount > 0 ? (
                            <View className="absolute right-1.5 top-1.5 h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1">
                                <Text className="font-sans-bold text-[10px] text-brand-black">
                                    {activeFilterCount}
                                </Text>
                            </View>
                        ) : null}
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Gerar certificado"
                        onPress={openCreate}
                        className="h-11 w-11 items-center justify-center rounded-full bg-white/10 active:opacity-70"
                    >
                        <Ionicons name="add" size={22} color="#FFFFFF" />
                    </Pressable>
                </View>
            </SafeAreaView>

            {isLoading ? (
                <ListSkeleton />
            ) : isError ? (
                <ErrorState
                    title="Falha ao carregar"
                    description="Não foi possível carregar os certificados."
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
                    {activeFilterCount > 0 ? (
                        <View className="mb-3 flex-row flex-wrap items-center gap-2">
                            {storeFilter != null ? (
                                <FilterChip
                                    label={
                                        storeOptions.find((o) => o.value === storeFilter)?.label ??
                                        'Loja'
                                    }
                                    onClear={() => setStoreFilterReset(null)}
                                />
                            ) : null}
                            {brandFilter != null ? (
                                <FilterChip
                                    label={
                                        BRAND_OPTIONS.find((b) => b.code === brandFilter)?.label ??
                                        brandFilter
                                    }
                                    onClear={() => setBrandFilterReset(null)}
                                />
                            ) : null}
                        </View>
                    ) : null}

                    {items.length === 0 ? (
                        <EmptyState
                            icon="shield-checkmark-outline"
                            title="Nenhum certificado"
                            description={
                                activeFilterCount > 0
                                    ? 'Nenhum certificado para os filtros aplicados.'
                                    : 'Nenhum certificado emitido ainda.'
                            }
                            actionLabel={activeFilterCount > 0 ? undefined : 'Gerar certificado'}
                            onAction={activeFilterCount > 0 ? undefined : openCreate}
                        />
                    ) : (
                        <View className="gap-3">
                            {items.map((cert) => (
                                <CertificateCard
                                    key={cert.id}
                                    cert={cert}
                                    isOwner={isOwner}
                                    downloading={downloadingId === cert.id}
                                    onDownload={() => void handleDownload(cert)}
                                    onEdit={() => openEdit(cert)}
                                    onDelete={() => confirmDelete(cert)}
                                />
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
                                    fullWidth={false}
                                    disabled={pagination.page <= 1}
                                    onPress={() => setPage((p) => Math.max(1, p - 1))}
                                />
                                <Button
                                    title="Próxima"
                                    variant="secondary"
                                    size="sm"
                                    fullWidth={false}
                                    disabled={pagination.page >= pagination.total_pages}
                                    onPress={() => setPage((p) => p + 1)}
                                />
                            </View>
                        </View>
                    ) : null}
                </ScrollView>
            )}

            <GenerateCertificateSheet
                ref={certSheetRef}
                certificate={editingCert}
                onSaved={() => {
                    // Edição mantém a página; criação volta à primeira.
                    if (!editingCert) setPage(1);
                    setEditingCert(null);
                    void refetch();
                }}
            />

            {/* Filtros (loja/marca) — paridade com o web CertificatesPage */}
            <Sheet ref={filterSheetRef} title="Filtrar certificados">
                <View className="gap-4 pb-2">
                    {showStoreFilter ? (
                        <FilterField
                            label="Loja"
                            value={
                                storeFilter != null
                                    ? (storeOptions.find((o) => o.value === storeFilter)?.label ??
                                      'Loja')
                                    : 'Todas as lojas'
                            }
                            placeholder={storeFilter == null}
                            onPress={() => storeSelectRef.current?.present()}
                        />
                    ) : null}

                    <FilterField
                        label="Marca"
                        value={
                            brandFilter != null
                                ? (BRAND_OPTIONS.find((b) => b.code === brandFilter)?.label ??
                                  brandFilter)
                                : 'Todas as marcas'
                        }
                        placeholder={brandFilter == null}
                        onPress={() => brandSelectRef.current?.present()}
                    />

                    {activeFilterCount > 0 ? (
                        <Button
                            title="Limpar filtros"
                            variant="secondary"
                            icon="close-circle-outline"
                            onPress={() => {
                                setStoreFilterReset(null);
                                setBrandFilterReset(null);
                            }}
                        />
                    ) : null}
                </View>
            </Sheet>

            {/* Select de loja: "Todas" (value 0 = sentinela) + lojas acessíveis */}
            <Select<number>
                ref={storeSelectRef}
                title="Loja"
                options={[{ value: 0, label: 'Todas as lojas' }, ...storeOptions]}
                value={storeFilter ?? 0}
                onChange={(v) => setStoreFilterReset(v === 0 ? null : v)}
            />

            {/* Select de marca: "Todas" ('' = sentinela) + marcas */}
            <Select<string>
                ref={brandSelectRef}
                title="Marca"
                options={[
                    { value: '', label: 'Todas as marcas' },
                    ...BRAND_OPTIONS.map((b) => ({ value: b.code, label: b.label })),
                ]}
                value={brandFilter ?? ''}
                onChange={(v) => setBrandFilterReset(v === '' ? null : v)}
            />
        </View>
    );
}

// ─── subcomponentes ──────────────────────────────────────────────────────────

/** Chip de filtro ativo, com botão para limpar. */
function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
    return (
        <View className="flex-row items-center gap-1.5 rounded-full bg-neutral-100 py-1 pl-3 pr-1.5 dark:bg-dark-elevated">
            <Text
                className="max-w-[160px] font-sans-medium text-xs text-neutral-600 dark:text-dark-text"
                numberOfLines={1}
            >
                {label}
            </Text>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remover filtro ${label}`}
                hitSlop={6}
                onPress={onClear}
                className="h-5 w-5 items-center justify-center rounded-full bg-neutral-200 active:opacity-70 dark:bg-dark-surface"
            >
                <Ionicons name="close" size={12} color="#667085" />
            </Pressable>
        </View>
    );
}

/** Linha de seleção de filtro dentro do Sheet (abre um Select ao tocar). */
function FilterField({
    label,
    value,
    placeholder,
    onPress,
}: {
    label: string;
    value: string;
    placeholder: boolean;
    onPress: () => void;
}) {
    return (
        <View>
            <Text className="mb-1.5 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
                {label}
            </Text>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${label}: ${value}`}
                onPress={onPress}
                className="min-h-[48px] flex-row items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-3 active:opacity-70 dark:border-dark-border-strong dark:bg-dark-input"
            >
                <Text
                    className={`font-sans text-base ${
                        placeholder
                            ? 'text-neutral-400'
                            : 'text-neutral-900 dark:text-dark-text'
                    }`}
                >
                    {value}
                </Text>
                <Ionicons name="chevron-down" size={18} color="#98A2B3" />
            </Pressable>
        </View>
    );
}

function WarrantyStatusBadge({ status }: { status: 'vigente' | 'vencida' }) {
    const vigente = status === 'vigente';
    return (
        <View
            className="self-start rounded-full px-2 py-0.5"
            style={{ backgroundColor: vigente ? '#DCFAE6' : '#FEE4E2' }}
        >
            <Text
                className="font-sans-semibold text-[11px]"
                style={{ color: vigente ? '#067647' : '#B42318' }}
            >
                {vigente ? 'Vigente' : 'Vencida'}
            </Text>
        </View>
    );
}

function CertificateCard({
    cert,
    isOwner,
    downloading,
    onDownload,
    onEdit,
    onDelete,
}: {
    cert: Certificate;
    isOwner: boolean;
    downloading: boolean;
    onDownload: () => void;
    onEdit: () => void;
    onDelete: () => void;
}) {
    return (
        <View className="rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface">
            <View className="flex-row items-start justify-between gap-2">
                <View className="flex-1">
                    <Text
                        className="font-sans-semibold text-base text-neutral-800 dark:text-dark-text"
                        numberOfLines={1}
                    >
                        {cert.customer_name ?? '—'}
                    </Text>
                    <Text className="mt-0.5 font-mono text-sm uppercase tracking-wider text-neutral-500 dark:text-dark-text-muted">
                        {cert.plate ?? '—'}
                    </Text>
                </View>
                <View className="items-end gap-1.5">
                    <View className="self-end rounded-full bg-neutral-100 px-2 py-0.5 dark:bg-dark-elevated">
                        <Text className="font-sans-medium text-[11px] text-neutral-500 dark:text-dark-text-muted">
                            {cert.brand_name ?? cert.brand_code}
                        </Text>
                    </View>
                    <WarrantyStatusBadge status={cert.warranty_status} />
                </View>
            </View>

            <View className="mt-3 flex-row flex-wrap">
                <Field label="O.S." value={cert.os_number ?? '—'} />
                <Field label="Loja" value={cert.store_name ?? '—'} />
                <Field label="Serviço" value={cert.service_name} />
                <Field label="Garantia" value={`${cert.warranty_months} meses`} />
                <Field label="Emissão" value={formatDateBR(cert.issue_date ?? cert.created_at)} />
                <Field label="Válido até" value={formatDateBR(cert.valid_until)} />
                <Field label="Emitido por" value={cert.created_by_name ?? '—'} full />
            </View>

            <View className="mt-3 flex-row justify-end gap-2 border-t border-neutral-100 pt-3 dark:border-dark-border-soft">
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Baixar PDF"
                    accessibilityState={{ busy: downloading, disabled: downloading }}
                    disabled={downloading}
                    onPress={onDownload}
                    className={`min-h-[40px] flex-row items-center gap-1.5 rounded-lg bg-neutral-50 px-3 active:opacity-80 dark:bg-dark-elevated ${
                        downloading ? 'opacity-50' : ''
                    }`}
                >
                    {downloading ? (
                        <ActivityIndicator size="small" color="#475467" />
                    ) : (
                        <Ionicons name="download-outline" size={16} color="#475467" />
                    )}
                    <Text className="font-sans-semibold text-sm text-neutral-600 dark:text-dark-text">
                        Baixar PDF
                    </Text>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Editar certificado"
                    onPress={onEdit}
                    className="min-h-[40px] flex-row items-center gap-1.5 rounded-lg bg-neutral-50 px-3 active:opacity-80 dark:bg-dark-elevated"
                >
                    <Ionicons name="create-outline" size={16} color="#475467" />
                    <Text className="font-sans-semibold text-sm text-neutral-600 dark:text-dark-text">
                        Editar
                    </Text>
                </Pressable>
                {isOwner ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Excluir certificado"
                        onPress={onDelete}
                        className="min-h-[40px] flex-row items-center gap-1.5 rounded-lg bg-neutral-50 px-3 active:opacity-80 dark:bg-dark-elevated"
                    >
                        <Ionicons name="trash-outline" size={16} color="#F04438" />
                        <Text className="font-sans-semibold text-sm text-error dark:text-error-dark">
                            Excluir
                        </Text>
                    </Pressable>
                ) : null}
            </View>
        </View>
    );
}

function Field({
    label,
    value,
    full = false,
}: {
    label: string;
    value: string;
    full?: boolean;
}) {
    return (
        <View className={full ? 'mt-2 w-full' : 'mt-2 w-1/2 pr-2'}>
            <Text className="font-sans text-[11px] uppercase tracking-wide text-neutral-400 dark:text-dark-text-muted">
                {label}
            </Text>
            <Text
                className="font-sans-semibold text-sm text-neutral-800 dark:text-dark-text"
                numberOfLines={1}
            >
                {value}
            </Text>
        </View>
    );
}

function ListSkeleton() {
    return (
        <View className="gap-3 p-4">
            {[0, 1, 2, 3].map((i) => (
                <View
                    key={i}
                    className="rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface"
                >
                    <View className="flex-row justify-between">
                        <Skeleton width="45%" height={16} />
                        <Skeleton width={64} height={18} radius={999} />
                    </View>
                    <Skeleton width="30%" height={12} className="mt-2" />
                    <Skeleton width="100%" height={40} radius={10} className="mt-4" />
                </View>
            ))}
        </View>
    );
}
