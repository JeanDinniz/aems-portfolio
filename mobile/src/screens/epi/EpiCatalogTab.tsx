import { useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useConfirm } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Sheet, type SheetRef } from '@/components/ui/Sheet';
import { TextField } from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';
import { useCanDelete, useCanEdit } from '@/hooks/useMyPermissions';
import { useEpiCatalog, useEpiCatalogMutations } from '@/hooks/useEpi';
import type { EPI } from '@/types/epi.types';

/**
 * Catálogo de EPIs (paridade com a web `EpiCatalogTab`).
 *
 * Lista todos os EPIs (ativos e inativos). Owner / `epi:can_edit` pode criar e
 * editar (nome + validade em dias) via bottom sheet; `epi:can_delete` pode
 * desativar (soft delete — o histórico de entregas é preservado no backend).
 */

export function EpiCatalogTab() {
    const canEdit = useCanEdit('epi');
    const canDelete = useCanDelete('epi');
    const { confirm } = useConfirm();
    const toast = useToast();
    const { data, isLoading, refetch, isRefetching } = useEpiCatalog(1, false);
    const { create, update, deactivate } = useEpiCatalogMutations();

    const [editing, setEditing] = useState<EPI | null>(null);
    const [name, setName] = useState('');
    const [dias, setDias] = useState('');
    const formSheetRef = useRef<SheetRef>(null);

    const openNew = () => {
        setEditing(null);
        setName('');
        setDias('');
        formSheetRef.current?.present();
    };
    const openEdit = (epi: EPI) => {
        setEditing(epi);
        setName(epi.name);
        setDias(String(epi.dias_validade));
        formSheetRef.current?.present();
    };

    const submit = () => {
        const payload = { name: name.trim(), dias_validade: Number(dias) };
        const onSuccess = () => formSheetRef.current?.dismiss();
        if (editing) {
            update.mutate({ id: editing.id, payload }, { onSuccess });
        } else {
            create.mutate(payload, { onSuccess });
        }
    };

    const confirmDeactivate = async (epi: EPI) => {
        const ok = await confirm({
            title: 'Desativar EPI?',
            message: `"${epi.name}" deixará de aparecer nas listas. O histórico de entregas é preservado.`,
            confirmLabel: 'Desativar',
            destructive: true,
        });
        if (ok) deactivate.mutate(epi.id);
    };

    const items = data?.items ?? [];
    const isMutating = create.isPending || update.isPending;
    const canSubmit = !!name.trim() && Number(dias) >= 1 && !isMutating;

    return (
        <View className="flex-1">
            {canEdit ? (
                <View className="px-4 pb-1 pt-3">
                    <Button
                        title="Novo EPI"
                        icon="add"
                        variant="secondary"
                        size="sm"
                        fullWidth={false}
                        onPress={openNew}
                    />
                </View>
            ) : null}

            {isLoading ? (
                <View className="gap-3 p-4">
                    {[0, 1, 2].map((i) => (
                        <Skeleton key={i} width="100%" height={64} radius={16} />
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
                            icon="construct-outline"
                            title="Nenhum EPI"
                            description="Nenhum EPI cadastrado."
                            actionLabel={canEdit ? 'Novo EPI' : undefined}
                            onAction={canEdit ? openNew : undefined}
                        />
                    ) : (
                        <View className="gap-3">
                            {items.map((epi) => (
                                <View
                                    key={epi.id}
                                    className="flex-row items-center gap-3 rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface"
                                >
                                    <View className="flex-1">
                                        <Text
                                            className="font-sans-semibold text-base text-neutral-800 dark:text-dark-text"
                                            numberOfLines={1}
                                        >
                                            {epi.name}
                                        </Text>
                                        <Text className="mt-0.5 font-sans text-sm text-neutral-500 dark:text-dark-text-muted">
                                            Validade: {epi.dias_validade} dias ·{' '}
                                            <Text
                                                style={{ color: epi.is_active ? '#067647' : '#98A2B3' }}
                                            >
                                                {epi.is_active ? 'Ativo' : 'Inativo'}
                                            </Text>
                                        </Text>
                                    </View>
                                    {canEdit ? (
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel={`Editar ${epi.name}`}
                                            onPress={() => openEdit(epi)}
                                            hitSlop={8}
                                            className="h-10 w-10 items-center justify-center rounded-lg bg-neutral-50 active:opacity-70 dark:bg-dark-elevated"
                                        >
                                            <Ionicons name="create-outline" size={18} color="#475467" />
                                        </Pressable>
                                    ) : null}
                                    {canDelete && epi.is_active ? (
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel={`Desativar ${epi.name}`}
                                            onPress={() => confirmDeactivate(epi)}
                                            hitSlop={8}
                                            className="h-10 w-10 items-center justify-center rounded-lg bg-neutral-50 active:opacity-70 dark:bg-dark-elevated"
                                        >
                                            <Ionicons name="power-outline" size={18} color="#F04438" />
                                        </Pressable>
                                    ) : null}
                                </View>
                            ))}
                        </View>
                    )}
                </ScrollView>
            )}

            <Sheet ref={formSheetRef} title={editing ? 'Editar EPI' : 'Novo EPI'}>
                <View className="pb-2">
                    <TextField
                        label="Nome"
                        value={name}
                        onChangeText={setName}
                        placeholder="Ex.: Protetor Auricular"
                    />
                    <TextField
                        label="Validade (dias)"
                        value={dias}
                        onChangeText={setDias}
                        placeholder="Ex.: 60"
                        keyboardType="number-pad"
                    />
                    <Button
                        title="Salvar"
                        icon="checkmark"
                        loading={isMutating}
                        disabled={!canSubmit}
                        onPress={submit}
                    />
                </View>
            </Sheet>
        </View>
    );
}
