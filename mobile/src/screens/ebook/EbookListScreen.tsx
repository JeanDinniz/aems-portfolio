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
import { Image } from 'expo-image';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Select, type SelectOption, type SelectRef } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useLibraryDocuments } from '@/hooks/useEbook';
import { resolveMediaUrl } from '@/lib/resolveMediaUrl';
import { mediaHeaders } from '@/lib/mediaSource';
import { downloadAndShareUrl } from '@/utils/exportShare';
import { getApiErrorMessage } from '@/lib/api-error';
import { LIBRARY_CATEGORIES, LIBRARY_CATEGORY_LABELS } from '@/constants/ebook';
import type { LibraryCategory, LibraryDocument } from '@/types/ebook.types';
import type { AppStackScreenProps } from '@/navigation/types';

/**
 * Biblioteca de Documentos (HML-237) — paridade com o web `EbookListPage`
 * (grid de cards do mobile HML-243).
 *
 * Lista paginada de documentos (Operacional / Apresentações). Cada card mostra
 * miniatura (imagem real ou placeholder por tipo de arquivo), badge do tipo
 * (PDF/PPT/...), badge da categoria, título e descrição, com uma ação em
 * destaque de abrir/baixar o arquivo. Imagens abrem no PhotoViewer; demais tipos
 * são baixados e compartilhados nativamente (`downloadAndShareUrl`).
 *
 * Header próprio (preto) — o AppStack usa `headerShown: false`.
 */

const LIMIT = 50;

const CATEGORY_OPTIONS: SelectOption<string>[] = [
    { value: 'all', label: 'Todas as categorias' },
    ...LIBRARY_CATEGORIES.map((c) => ({ value: c, label: LIBRARY_CATEGORY_LABELS[c] })),
];

// ── helpers de tipo de arquivo (espelham o web) ──────────────────────────────

function getFileTypeLabel(fileType: string | null, fileName: string): string {
    if (!fileType) {
        const ext = fileName.split('.').pop()?.toUpperCase();
        return ext ?? 'DOC';
    }
    if (fileType.includes('pdf')) return 'PDF';
    if (fileType.includes('powerpoint') || fileType.includes('presentation')) return 'PPT';
    if (fileType.includes('word') || fileType.includes('wordprocessing')) return 'DOCX';
    if (fileType.includes('excel') || fileType.includes('spreadsheet')) return 'XLSX';
    if (fileType.startsWith('image/')) return fileType.split('/').pop()?.toUpperCase() ?? 'IMG';
    return fileType.split('/').pop()?.toUpperCase() ?? 'DOC';
}

function isImage(fileType: string | null, fileName: string): boolean {
    if (fileType?.startsWith('image/')) return true;
    return /\.(png|jpe?g|webp|gif)$/i.test(fileName);
}

/** Cor do badge do tipo (fundo, texto) — leve, alto contraste. */
function fileTypeColors(label: string): { bg: string; fg: string } {
    if (label === 'PDF') return { bg: '#FEE4E2', fg: '#B42318' };
    if (label === 'PPT' || label === 'PPTX') return { bg: '#FFEAD5', fg: '#B54708' };
    if (label === 'DOCX' || label === 'DOC') return { bg: '#D1E9FF', fg: '#175CD3' };
    if (label === 'XLSX' || label === 'XLS') return { bg: '#DCFAE6', fg: '#067647' };
    return { bg: '#F2F4F7', fg: '#475467' };
}

export function EbookListScreen({ navigation }: AppStackScreenProps<'EbookList'>) {
    const toast = useToast();
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState<LibraryCategory | 'all'>('all');
    const [page, setPage] = useState(1);
    const [busyId, setBusyId] = useState<number | null>(null);
    const categorySelectRef = useRef<SelectRef>(null);

    const { data, isLoading, isError, refetch, isRefetching } = useLibraryDocuments({
        page,
        limit: LIMIT,
        is_active: true,
        ...(category !== 'all' && { category }),
        ...(search.trim() && { search: search.trim() }),
    });

    const items = useMemo(() => data?.items ?? [], [data]);
    const pagination = data?.pagination;
    const hasFilters = !!search.trim() || category !== 'all';

    const categoryLabel =
        CATEGORY_OPTIONS.find((o) => o.value === category)?.label ?? 'Todas as categorias';

    const subtitle = isLoading
        ? 'Carregando...'
        : pagination
          ? `${pagination.total} ${pagination.total === 1 ? 'documento' : 'documentos'}`
          : 'Documentos e apresentações';

    const openDocument = useCallback(
        async (doc: LibraryDocument) => {
            // Imagens abrem no visualizador global (zoom/pan). Demais tipos são
            // baixados/compartilhados nativamente.
            if (isImage(doc.file_type, doc.file_name)) {
                navigation.navigate('PhotoViewer', {
                    photos: [resolveMediaUrl(doc.file_url)],
                    title: doc.title,
                });
                return;
            }
            if (busyId != null) return;
            setBusyId(doc.id);
            try {
                await downloadAndShareUrl({
                    url: doc.file_url,
                    filename: doc.file_name || `documento_${doc.id}`,
                    fileType: doc.file_type,
                });
            } catch (err) {
                toast.error(getApiErrorMessage(err as Error, 'Não foi possível abrir o arquivo.'));
            } finally {
                setBusyId(null);
            }
        },
        [busyId, navigation, toast]
    );

    // Ao trocar filtro/busca, volta para a primeira página.
    const applyCategory = (v: LibraryCategory | 'all') => {
        setCategory(v);
        setPage(1);
    };
    const applySearch = (v: string) => {
        setSearch(v);
        setPage(1);
    };

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
                            <Text className="font-display-bold text-xl text-white">Biblioteca</Text>
                            <Text className="mt-0.5 font-sans text-sm text-neutral-400">
                                {subtitle}
                            </Text>
                        </View>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Certificados emitidos"
                            onPress={() => navigation.navigate('EbookCertificates')}
                            className="h-11 w-11 items-center justify-center rounded-full bg-white/10 active:opacity-70"
                        >
                            <Ionicons name="shield-checkmark-outline" size={20} color="#FFFFFF" />
                        </Pressable>
                    </View>

                    {/* Busca */}
                    <View className="mt-3 min-h-[48px] flex-row items-center rounded-xl bg-white/10 px-3">
                        <Ionicons name="search" size={18} color="#98A2B3" />
                        <TextInput
                            accessibilityLabel="Buscar documento"
                            placeholder="Buscar documento..."
                            value={search}
                            onChangeText={applySearch}
                            autoCapitalize="none"
                            autoCorrect={false}
                            returnKeyType="search"
                            className="ml-2 flex-1 py-3 font-sans text-base text-white"
                            placeholderTextColor="#98A2B3"
                            style={{ color: '#FFFFFF' }}
                        />
                        {search.length > 0 ? (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Limpar busca"
                                onPress={() => applySearch('')}
                                hitSlop={8}
                                className="p-1 active:opacity-70"
                            >
                                <Ionicons name="close-circle" size={18} color="#98A2B3" />
                            </Pressable>
                        ) : null}
                    </View>

                    {/* Filtro de categoria */}
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Categoria: ${categoryLabel}`}
                        onPress={() => categorySelectRef.current?.present()}
                        className="mt-3 min-h-[44px] flex-row items-center justify-between rounded-xl bg-white/10 px-3 active:opacity-70"
                    >
                        <Text className="font-sans text-base text-white">{categoryLabel}</Text>
                        <Ionicons name="chevron-down" size={18} color="#98A2B3" />
                    </Pressable>
                </View>
            </SafeAreaView>

            {isLoading ? (
                <ListSkeleton />
            ) : isError ? (
                <ErrorState
                    title="Falha ao carregar"
                    description="Não foi possível carregar a biblioteca."
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
                    {items.length === 0 ? (
                        <EmptyState
                            icon="document-text-outline"
                            title="Nenhum documento"
                            description={
                                hasFilters
                                    ? 'Nenhum documento encontrado para os filtros aplicados.'
                                    : 'Nenhum documento cadastrado.'
                            }
                        />
                    ) : (
                        <View className="gap-3">
                            {items.map((doc) => (
                                <DocumentCard
                                    key={doc.id}
                                    doc={doc}
                                    busy={busyId === doc.id}
                                    onOpen={() => void openDocument(doc)}
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

            <Select<string>
                ref={categorySelectRef}
                title="Categoria"
                options={CATEGORY_OPTIONS}
                value={category}
                onChange={(v) => applyCategory(v as LibraryCategory | 'all')}
            />
        </View>
    );
}

// ─── subcomponentes ──────────────────────────────────────────────────────────

function DocumentCard({
    doc,
    busy,
    onOpen,
}: {
    doc: LibraryDocument;
    busy: boolean;
    onOpen: () => void;
}) {
    const image = isImage(doc.file_type, doc.file_name);
    const typeLabel = getFileTypeLabel(doc.file_type, doc.file_name);
    const typeColor = fileTypeColors(typeLabel);
    const actionLabel = image ? 'Ver' : 'Abrir';

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${actionLabel} ${doc.title}`}
            accessibilityState={{ busy, disabled: busy }}
            disabled={busy}
            onPress={onOpen}
            className={`overflow-hidden rounded-2xl border border-neutral-100 bg-white active:opacity-80 dark:border-dark-border-soft dark:bg-dark-surface ${
                busy ? 'opacity-60' : ''
            }`}
        >
            {/* Miniatura */}
            <View className="relative h-36 w-full bg-neutral-100 dark:bg-dark-elevated">
                {image ? (
                    <Image
                        source={{ uri: resolveMediaUrl(doc.file_url), headers: mediaHeaders() }}
                        accessibilityLabel={doc.title}
                        style={{ width: '100%', height: '100%' }}
                        contentFit="cover"
                        transition={150}
                    />
                ) : (
                    <View className="h-full w-full items-center justify-center">
                        <Ionicons name="document-text-outline" size={44} color="#98A2B3" />
                    </View>
                )}
                {/* Badge do tipo — canto superior direito */}
                <View
                    className="absolute right-2 top-2 rounded px-1.5 py-0.5"
                    style={{ backgroundColor: typeColor.bg }}
                >
                    <Text
                        className="font-sans-bold text-[11px]"
                        style={{ color: typeColor.fg }}
                    >
                        {typeLabel}
                    </Text>
                </View>
            </View>

            {/* Corpo */}
            <View className="gap-2 p-4">
                <View className="self-start rounded-full px-2 py-0.5" style={{ backgroundColor: '#F5B800' }}>
                    <Text className="font-sans-semibold text-[11px] text-brand-black">
                        {LIBRARY_CATEGORY_LABELS[doc.category]}
                    </Text>
                </View>
                <Text
                    className="font-sans-semibold text-base text-neutral-900 dark:text-dark-text"
                    numberOfLines={2}
                >
                    {doc.title}
                </Text>
                {doc.description ? (
                    <Text
                        className="font-sans text-sm text-neutral-500 dark:text-dark-text-muted"
                        numberOfLines={2}
                    >
                        {doc.description}
                    </Text>
                ) : null}

                {/* Ação em destaque */}
                <View className="mt-1 flex-row items-center justify-end border-t border-neutral-100 pt-3 dark:border-dark-border-soft">
                    <View
                        className="min-h-[40px] flex-row items-center gap-1.5 rounded-lg px-4"
                        style={{ backgroundColor: '#F5B800' }}
                    >
                        {busy ? (
                            <ActivityIndicator size="small" color="#0A0A0A" />
                        ) : (
                            <Ionicons
                                name={image ? 'eye-outline' : 'download-outline'}
                                size={16}
                                color="#0A0A0A"
                            />
                        )}
                        <Text className="font-sans-semibold text-sm text-brand-black">
                            {actionLabel}
                        </Text>
                    </View>
                </View>
            </View>
        </Pressable>
    );
}

function ListSkeleton() {
    return (
        <View className="gap-3 p-4">
            {[0, 1, 2, 3].map((i) => (
                <View
                    key={i}
                    className="overflow-hidden rounded-2xl border border-neutral-100 bg-white dark:border-dark-border-soft dark:bg-dark-surface"
                >
                    <Skeleton width="100%" height={144} />
                    <View className="gap-2 p-4">
                        <Skeleton width={90} height={16} radius={999} />
                        <Skeleton width="80%" height={16} />
                        <Skeleton width="60%" height={12} />
                        <Skeleton width={72} height={40} radius={10} className="mt-2 self-end" />
                    </View>
                </View>
            ))}
        </View>
    );
}
