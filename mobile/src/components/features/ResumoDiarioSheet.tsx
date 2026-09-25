import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@/components/ui/Button';
import { Select, type SelectOption, type SelectRef } from '@/components/ui/Select';
import { Sheet, type SheetRef } from '@/components/ui/Sheet';
import { TextField } from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';
import { useStores } from '@/hooks/useStores';
import { useAuthStore } from '@/stores/auth.store';
import { downloadAndSharePdf } from '@/utils/exportShare';
import { ymdLocal } from '@/utils/formatDate';
import { getApiErrorMessage } from '@/lib/api-error';

/**
 * Resumo Diário (PDF) — paridade com o web `ResumoDiarioDialog`.
 *
 * Sheet inline (sem rota nova) com: loja (obrigatória, default = loja global
 * selecionada), data (AAAA-MM-DD, default hoje LOCAL) e toggle "Apenas
 * finalizadas" (`only_completed`). Ao confirmar, baixa o PDF do backend e abre o
 * compartilhamento nativo. `store_id` é obrigatório: se "Todas as lojas" estiver
 * selecionada, exige escolher uma loja aqui.
 *
 * Perfil galpão só gera o relatório do galpão (mesma regra do web).
 * Use via ref: `const ref = useRef<ResumoDiarioSheetRef>(null); ref.current?.present()`.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ResumoDiarioSheetRef {
    present: () => void;
    dismiss: () => void;
}

export const ResumoDiarioSheet = forwardRef<ResumoDiarioSheetRef>(function ResumoDiarioSheet(
    _props,
    ref
) {
    const toast = useToast();
    const { stores, selectedStoreId: globalStoreId } = useStores();
    const isGalponProfile =
        useAuthStore((s) => s.effectivePermissions)?.is_galpon_profile === true;

    const sheetRef = useRef<SheetRef>(null);
    const storeSelectRef = useRef<SelectRef>(null);

    // Perfil galpão só enxerga a(s) loja(s) de galpão.
    const visibleStores = useMemo(
        () => (isGalponProfile ? stores.filter((s) => s.is_galpon_store) : stores),
        [isGalponProfile, stores]
    );

    const storeOptions = useMemo<SelectOption<number>[]>(
        () => visibleStores.map((s) => ({ value: s.id, label: s.name })),
        [visibleStores]
    );

    const [storeId, setStoreId] = useState<number | null>(null);
    const [date, setDate] = useState<string>(ymdLocal());
    const [onlyCompleted, setOnlyCompleted] = useState(false);
    const [exporting, setExporting] = useState(false);

    useImperativeHandle(ref, () => ({
        present: () => {
            // Reseta ao abrir (espelha o web): pré-seleciona a loja global (se
            // específica) ou a única loja disponível.
            const preselect =
                globalStoreId != null
                    ? globalStoreId
                    : visibleStores.length === 1
                      ? visibleStores[0].id
                      : null;
            setStoreId(preselect);
            setDate(ymdLocal());
            setOnlyCompleted(false);
            sheetRef.current?.present();
        },
        dismiss: () => sheetRef.current?.dismiss(),
    }));

    const storeLabel =
        storeOptions.find((o) => o.value === storeId)?.label ?? 'Selecione uma loja';

    const handleGenerate = async () => {
        if (exporting) return;
        if (storeId == null) {
            toast.error('Selecione uma loja antes de gerar o PDF.');
            return;
        }
        if (!DATE_RE.test(date)) {
            toast.error('Informe a data no formato AAAA-MM-DD.');
            return;
        }

        setExporting(true);
        try {
            await downloadAndSharePdf({
                path: '/service-orders/export/resumo-diario',
                params: {
                    store_id: storeId,
                    date,
                    only_completed: onlyCompleted || undefined,
                },
                filename: `${
                    onlyCompleted ? 'resumo-diario-finalizados' : 'resumo-diario'
                }-${date}.pdf`,
            });
            sheetRef.current?.dismiss();
        } catch (err) {
            toast.error(getApiErrorMessage(err as Error, 'Não foi possível gerar o PDF.'));
        } finally {
            setExporting(false);
        }
    };

    return (
        <>
            <Sheet ref={sheetRef} title="Resumo Diário (PDF)">
                <ScrollView
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={{ paddingBottom: 8 }}
                    showsVerticalScrollIndicator={false}
                >
                    {/* Loja (obrigatória) */}
                    <Text className="mb-1.5 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
                        Loja <Text className="text-error">*</Text>
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Loja: ${storeLabel}`}
                        onPress={() => storeSelectRef.current?.present()}
                        className="min-h-[48px] flex-row items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-3 active:opacity-70 dark:border-dark-border-strong dark:bg-dark-input"
                    >
                        <Text
                            className={`font-sans text-base ${
                                storeId != null
                                    ? 'text-neutral-900 dark:text-dark-text'
                                    : 'text-neutral-400'
                            }`}
                        >
                            {storeLabel}
                        </Text>
                        <Ionicons name="chevron-down" size={18} color="#98A2B3" />
                    </Pressable>
                    <Text className="mb-4 mt-1 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                        O relatório é gerado por loja específica.
                    </Text>

                    {/* Data */}
                    <TextField
                        label="Data"
                        placeholder="AAAA-MM-DD"
                        value={date}
                        onChangeText={setDate}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="numbers-and-punctuation"
                    />

                    {/* Apenas finalizadas */}
                    <Pressable
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: onlyCompleted }}
                        accessibilityLabel="Apenas finalizadas"
                        onPress={() => setOnlyCompleted((v) => !v)}
                        className="mb-5 mt-1 min-h-[44px] flex-row items-center gap-2.5 active:opacity-70"
                    >
                        <View
                            className={`h-6 w-6 items-center justify-center rounded-md border-2 ${
                                onlyCompleted
                                    ? 'border-brand bg-brand'
                                    : 'border-neutral-300 dark:border-neutral-500'
                            }`}
                        >
                            {onlyCompleted ? (
                                <Ionicons name="checkmark" size={16} color="#1A1A1A" />
                            ) : null}
                        </View>
                        <Text className="font-sans-medium text-base text-neutral-800 dark:text-dark-text">
                            Apenas finalizadas
                        </Text>
                    </Pressable>

                    <Button
                        title="Gerar PDF"
                        icon="document-text-outline"
                        loading={exporting}
                        disabled={storeId == null || !DATE_RE.test(date)}
                        onPress={() => void handleGenerate()}
                    />
                </ScrollView>
            </Sheet>

            {/* Sheet de seleção de loja (aninhado) */}
            <Select<number>
                ref={storeSelectRef}
                title="Selecionar loja"
                options={storeOptions}
                value={storeId}
                onChange={setStoreId}
            />
        </>
    );
});
