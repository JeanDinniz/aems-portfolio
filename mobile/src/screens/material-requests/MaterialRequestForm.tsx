import { useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { DateField } from '@/components/ui/DateField';
import { Select, type SelectRef } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { useFilmTypes } from '@/hooks/useInventory';
import { useSuppliers } from '@/hooks/useSuppliers';
import { useEmployees } from '@/hooks/useEmployees';
import { useStores } from '@/hooks/useStores';
import { useStoreStore } from '@/stores/store.store';
import { getTonalityOptionsForFilmType } from '@/constants/scheduling';
import type { FilmDepartment } from '@/services/api/inventory.service';
import type {
    MaterialRequest,
    MaterialRequestFilmLineCreate,
    MaterialRequestToolLineCreate,
} from '@/types/materialRequest.types';

/**
 * Formulário compartilhado de Pedido de Material (criação e edição).
 *
 * - CRIAÇÃO (`mode='create'`): loja + data + galpão + observações + linhas de
 *   película (viram bobinas no Estoque) + linhas de ferramentas (texto livre).
 * - EDIÇÃO (`mode='edit'`): loja é FIXA (só leitura); as linhas de película são
 *   READ-ONLY (o backend não permite editá-las — ajuste pela tela de Estoque);
 *   editam-se data, galpão, observações e as ferramentas.
 *
 * Estado local (sem react-hook-form) porque as listas dinâmicas de linhas são
 * mais simples de gerir com useState + validação leve no submit. Feedback via
 * Toast; a navegação de volta fica a cargo da tela chamadora (onSubmit).
 */

export type MaterialRequestFormMode = 'create' | 'edit';

export interface MaterialRequestFormPayload {
    store_id: number;
    request_date: string;
    is_galpon: boolean;
    notes: string | null;
    film_lines: MaterialRequestFilmLineCreate[];
    tool_lines: MaterialRequestToolLineCreate[];
}

export interface MaterialRequestFormProps {
    mode: MaterialRequestFormMode;
    /** Pedido existente (modo edição) para pré-preencher. */
    initial?: MaterialRequest;
    saving: boolean;
    onCancel: () => void;
    /** Recebe o payload já validado. */
    onSubmit: (payload: MaterialRequestFormPayload) => void;
}

interface FilmLineDraft {
    key: string;
    department: FilmDepartment;
    film_type_id?: number;
    tonality?: string;
    total_meters?: number;
    supplier_id?: number;
    nfe_number?: string;
    cost?: number;
    lot_number?: string;
}

interface ToolLineDraft {
    key: string;
    name: string;
    quantity?: number;
    notes?: string;
    employee_id?: number;
    cost?: number;
    nfe_number?: string;
}

function todayISO(): string {
    return new Date().toISOString().split('T')[0];
}

let seq = 0;
function nextKey(prefix: string): string {
    seq += 1;
    return `${prefix}-${seq}`;
}

export function MaterialRequestForm({
    mode,
    initial,
    saving,
    onCancel,
    onSubmit,
}: MaterialRequestFormProps) {
    const toast = useToast();
    const { stores } = useStores();
    const selectedStoreId = useStoreStore((s) => s.selectedStoreId);

    const defaultStoreId =
        initial?.store_id ?? selectedStoreId ?? stores[0]?.id ?? undefined;

    const [storeId, setStoreId] = useState<number | undefined>(defaultStoreId);
    const [requestDate, setRequestDate] = useState<string>(initial?.request_date ?? todayISO());
    const [isGalpon, setIsGalpon] = useState<boolean>(initial?.is_galpon ?? false);
    const [notes, setNotes] = useState<string>(initial?.notes ?? '');

    const [filmLines, setFilmLines] = useState<FilmLineDraft[]>([]);
    const [toolLines, setToolLines] = useState<ToolLineDraft[]>(() =>
        (initial?.tool_items ?? []).map((t) => ({
            key: nextKey('tool'),
            name: t.name,
            quantity: t.quantity,
            notes: t.notes ?? undefined,
            employee_id: t.employee_id ?? undefined,
            cost: t.cost != null && t.cost !== '' ? Number(t.cost) : undefined,
            nfe_number: t.nfe_number ?? undefined,
        }))
    );

    const storeSheetRef = useRef<SelectRef>(null);
    const storeOptions = useMemo(
        () => stores.map((s) => ({ value: s.id, label: s.name })),
        [stores]
    );
    const storeName = stores.find((s) => s.id === storeId)?.name;
    const storeLocked = mode === 'edit' || stores.length <= 1;

    const isEdit = mode === 'edit';

    const addFilmLine = () =>
        setFilmLines((prev) => [...prev, { key: nextKey('film'), department: 'film' }]);
    const updateFilmLine = (key: string, patch: Partial<FilmLineDraft>) =>
        setFilmLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    const removeFilmLine = (key: string) =>
        setFilmLines((prev) => prev.filter((l) => l.key !== key));

    const addToolLine = () =>
        setToolLines((prev) => [...prev, { key: nextKey('tool'), name: '' }]);
    const updateToolLine = (key: string, patch: Partial<ToolLineDraft>) =>
        setToolLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    const removeToolLine = (key: string) =>
        setToolLines((prev) => prev.filter((l) => l.key !== key));

    const submit = () => {
        Keyboard.dismiss();

        if (!storeId) {
            toast.error('Selecione a loja.');
            return;
        }
        if (!requestDate) {
            toast.error('Informe a data do pedido.');
            return;
        }

        // Validação das linhas de película (só na criação — não editáveis no update).
        const films: MaterialRequestFilmLineCreate[] = [];
        if (!isEdit) {
            for (const l of filmLines) {
                if (!l.film_type_id) {
                    toast.error('Selecione o tipo de película em todas as linhas de película.');
                    return;
                }
                if (!l.total_meters || l.total_meters <= 0) {
                    toast.error('Informe a metragem (> 0) em todas as linhas de película.');
                    return;
                }
                const needsTonality = l.department === 'film' || l.department === 'security_film';
                if (needsTonality && !l.tonality) {
                    toast.error('Informe a tonalidade nas películas (exceto PPF).');
                    return;
                }
                if (!l.supplier_id) {
                    toast.error('Selecione o fornecedor em todas as linhas de película.');
                    return;
                }
                films.push({
                    film_type_id: l.film_type_id,
                    tonality: needsTonality ? l.tonality : null,
                    total_meters: l.total_meters,
                    supplier_id: l.supplier_id,
                    nfe_number: l.nfe_number?.trim() || null,
                    cost: l.cost ?? null,
                    lot_number: l.lot_number?.trim() || null,
                });
            }
        }

        // Validação das ferramentas.
        const tools: MaterialRequestToolLineCreate[] = [];
        for (const l of toolLines) {
            const name = l.name.trim();
            if (!name) {
                toast.error('Informe o nome em todas as ferramentas/insumos.');
                return;
            }
            if (!l.quantity || l.quantity <= 0) {
                toast.error(`Informe a quantidade (> 0) de "${name}".`);
                return;
            }
            if (!l.cost || l.cost <= 0) {
                toast.error(`Informe o custo (> 0) de "${name}".`);
                return;
            }
            const nfe = l.nfe_number?.trim();
            if (!nfe) {
                toast.error(`Informe a nota fiscal de "${name}".`);
                return;
            }
            tools.push({
                name,
                quantity: l.quantity,
                notes: l.notes?.trim() || null,
                employee_id: l.employee_id ?? null,
                cost: l.cost,
                nfe_number: nfe,
            });
        }

        if (!isEdit && films.length === 0 && tools.length === 0) {
            toast.error('Informe ao menos uma película ou ferramenta no pedido.');
            return;
        }

        onSubmit({
            store_id: storeId,
            request_date: requestDate,
            is_galpon: isGalpon,
            notes: notes.trim() || null,
            film_lines: films,
            tool_lines: tools,
        });
    };

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader
                title={isEdit ? 'Editar pedido' : 'Novo pedido'}
                onBack={onCancel}
            />
            <ScrollView
                className="flex-1"
                contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
                keyboardShouldPersistTaps="handled"
                automaticallyAdjustKeyboardInsets
                keyboardDismissMode="interactive"
            >
                {/* Loja */}
                <FieldLabel>Loja *</FieldLabel>
                {storeLocked ? (
                    <View className="mb-4 min-h-[48px] justify-center rounded-lg border border-neutral-200 bg-neutral-100 px-4 dark:border-dark-border-strong dark:bg-dark-elevated">
                        <Text className="font-sans text-base text-neutral-700 dark:text-dark-text">
                            {storeName ?? 'Nenhuma loja disponível'}
                        </Text>
                    </View>
                ) : (
                    <PickerField
                        placeholder="Selecionar loja..."
                        value={storeName}
                        onPress={() => storeSheetRef.current?.present()}
                        disabled={saving}
                    />
                )}

                {/* Data */}
                <FieldLabel>Data do pedido *</FieldLabel>
                <View className="mb-4">
                    <DateField value={requestDate} onChange={setRequestDate} />
                </View>

                {/* Galpão */}
                <View className="mb-4 flex-row items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-3 dark:border-dark-border-strong dark:bg-dark-input">
                    <View className="flex-1 pr-3">
                        <Text className="font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
                            Pedido do galpão
                        </Text>
                        <Text className="mt-0.5 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                            Marca o pedido como pertencente ao galpão.
                        </Text>
                    </View>
                    <Switch
                        accessibilityLabel="Pedido do galpão"
                        value={isGalpon}
                        onValueChange={setIsGalpon}
                        disabled={saving}
                    />
                </View>

                {/* Observações */}
                <TextField
                    label="Observações"
                    placeholder="Notas do pedido (opcional)"
                    value={notes}
                    onChangeText={setNotes}
                    multiline
                    numberOfLines={3}
                    editable={!saving}
                    style={{ minHeight: 72, textAlignVertical: 'top' }}
                />

                {/* Películas */}
                <SectionHeader
                    title="Películas"
                    subtitle={
                        isEdit
                            ? 'Não editáveis aqui — ajuste as bobinas pelo Estoque.'
                            : 'Cada linha vira uma bobina no Estoque.'
                    }
                />
                {isEdit ? (
                    <ReadOnlyFilmList request={initial} />
                ) : (
                    <>
                        {filmLines.map((line, idx) => (
                            <FilmLineCard
                                key={line.key}
                                index={idx}
                                line={line}
                                disabled={saving}
                                onChange={(patch) => updateFilmLine(line.key, patch)}
                                onRemove={() => removeFilmLine(line.key)}
                            />
                        ))}
                        <AddLineButton label="Adicionar película" onPress={addFilmLine} disabled={saving} />
                    </>
                )}

                {/* Ferramentas / insumos */}
                <SectionHeader
                    title="Ferramentas / insumos"
                    subtitle="Texto livre. Vincule a um funcionário para gerar recebimento."
                />
                {toolLines.map((line, idx) => (
                    <ToolLineCard
                        key={line.key}
                        index={idx}
                        line={line}
                        storeId={storeId}
                        disabled={saving}
                        onChange={(patch) => updateToolLine(line.key, patch)}
                        onRemove={() => removeToolLine(line.key)}
                    />
                ))}
                <AddLineButton label="Adicionar ferramenta" onPress={addToolLine} disabled={saving} />

                {/* Ação */}
                <View className="mt-4">
                    <Button
                        title={saving ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Criar pedido'}
                        icon="checkmark"
                        loading={saving}
                        disabled={saving}
                        onPress={submit}
                    />
                </View>
            </ScrollView>

            {/* Sheet de loja */}
            <Select<number>
                ref={storeSheetRef}
                title="Selecionar loja"
                options={storeOptions}
                value={storeId ?? null}
                onChange={(v) => setStoreId(v)}
            />
        </View>
    );
}

// ─── Linha de película (criação) ─────────────────────────────────────────────

const FILM_DEPARTMENT_CHIPS: { value: FilmDepartment; label: string }[] = [
    { value: 'film', label: 'Película' },
    { value: 'security_film', label: 'Pel. Segurança' },
    { value: 'ppf', label: 'PPF' },
];

function FilmLineCard({
    index,
    line,
    disabled,
    onChange,
    onRemove,
}: {
    index: number;
    line: FilmLineDraft;
    disabled: boolean;
    onChange: (patch: Partial<FilmLineDraft>) => void;
    onRemove: () => void;
}) {
    const filmTypeSheetRef = useRef<SelectRef>(null);
    const tonalitySheetRef = useRef<SelectRef>(null);
    const supplierSheetRef = useRef<SelectRef>(null);

    const { data: filmTypes = [] } = useFilmTypes(line.department);
    const filmTypeOptions = useMemo(
        () => filmTypes.filter((ft) => ft.is_active).map((ft) => ({ value: ft.id, label: ft.name })),
        [filmTypes]
    );
    const selectedFilmType = filmTypes.find((ft) => ft.id === line.film_type_id);

    const { data: suppliers = [] } = useSuppliers();
    const supplierOptions = useMemo(
        () => suppliers.map((s) => ({ value: s.id, label: s.company_name })),
        [suppliers]
    );
    const selectedSupplierName = suppliers.find((s) => s.id === line.supplier_id)?.company_name;
    const isFilm = line.department === 'film' || line.department === 'security_film';
    const tonalityOptions = useMemo(
        () =>
            getTonalityOptionsForFilmType({
                department: line.department,
                availableTonalities: selectedFilmType?.available_tonalities,
            }),
        [line.department, selectedFilmType]
    );

    return (
        <View className="mb-3 rounded-2xl border border-neutral-200 bg-white p-3 dark:border-dark-border-strong dark:bg-dark-surface">
            <View className="mb-2 flex-row items-center justify-between">
                <Text className="font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
                    Película {index + 1}
                </Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remover película ${index + 1}`}
                    disabled={disabled}
                    onPress={onRemove}
                    hitSlop={8}
                    className="h-9 w-9 items-center justify-center rounded-full active:bg-error-light dark:active:bg-dark-elevated"
                >
                    <Ionicons name="close" size={18} color="#F04438" />
                </Pressable>
            </View>

            {/* Departamento */}
            <View className="mb-3 flex-row flex-wrap gap-2">
                {FILM_DEPARTMENT_CHIPS.map((opt) => (
                    <Chip
                        key={opt.value}
                        label={opt.label}
                        active={line.department === opt.value}
                        disabled={disabled}
                        onPress={() =>
                            onChange({
                                department: opt.value,
                                film_type_id: undefined,
                                tonality: undefined,
                            })
                        }
                    />
                ))}
            </View>

            <FieldLabel>Tipo *</FieldLabel>
            <PickerField
                placeholder={filmTypeOptions.length === 0 ? 'Nenhum tipo disponível' : 'Selecionar tipo...'}
                value={selectedFilmType?.name}
                disabled={disabled || filmTypeOptions.length === 0}
                onPress={() => filmTypeSheetRef.current?.present()}
            />

            {isFilm ? (
                <>
                    <FieldLabel>Tonalidade *</FieldLabel>
                    <PickerField
                        placeholder="Selecionar tonalidade..."
                        value={line.tonality}
                        disabled={disabled}
                        onPress={() => tonalitySheetRef.current?.present()}
                    />
                </>
            ) : null}

            <FieldLabel>Fornecedor *</FieldLabel>
            <PickerField
                placeholder={
                    supplierOptions.length === 0
                        ? 'Nenhum fornecedor cadastrado'
                        : 'Selecionar fornecedor...'
                }
                value={selectedSupplierName}
                disabled={disabled || supplierOptions.length === 0}
                onPress={() => supplierSheetRef.current?.present()}
            />

            <NumberField
                label="Metragem total (m) *"
                placeholder="Ex: 15"
                value={line.total_meters}
                onChange={(n) => onChange({ total_meters: n })}
                disabled={disabled}
            />
            <NumberField
                label="Custo (R$)"
                placeholder="Ex: 1200.00"
                value={line.cost}
                onChange={(n) => onChange({ cost: n })}
                disabled={disabled}
            />
            <TextField
                label="NFe / Nº pedido"
                placeholder="Ex: NF-001234"
                autoCorrect={false}
                value={line.nfe_number ?? ''}
                onChangeText={(t) => onChange({ nfe_number: t })}
                editable={!disabled}
            />
            <TextField
                label="Lote"
                placeholder="Ex: LOTE-2024-A"
                autoCorrect={false}
                value={line.lot_number ?? ''}
                onChangeText={(t) => onChange({ lot_number: t })}
                editable={!disabled}
            />

            <Select<number>
                ref={filmTypeSheetRef}
                title="Selecionar tipo"
                options={filmTypeOptions}
                value={line.film_type_id ?? null}
                onChange={(v) => onChange({ film_type_id: v, tonality: undefined })}
            />
            <Select<string>
                ref={tonalitySheetRef}
                title="Selecionar tonalidade"
                options={tonalityOptions}
                value={line.tonality ?? null}
                onChange={(v) => onChange({ tonality: v })}
            />
            <Select<number>
                ref={supplierSheetRef}
                title="Selecionar fornecedor"
                options={supplierOptions}
                value={line.supplier_id ?? null}
                onChange={(v) => onChange({ supplier_id: v })}
            />
        </View>
    );
}

/** Lista somente-leitura das películas de um pedido (modo edição). */
function ReadOnlyFilmList({ request }: { request?: MaterialRequest }) {
    const films = request?.film_items ?? [];
    if (films.length === 0) {
        return (
            <View className="mb-2 rounded-lg border border-dashed border-neutral-200 px-4 py-3 dark:border-dark-border-strong">
                <Text className="font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                    Sem películas neste pedido.
                </Text>
            </View>
        );
    }
    return (
        <View className="mb-2 gap-2">
            {films.map((f) => (
                <View
                    key={f.film_roll_id}
                    className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-dark-border-strong dark:bg-dark-elevated"
                >
                    <Text className="font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
                        {f.film_type_name}
                        {f.tonality ? ` · ${f.tonality}` : ''}
                    </Text>
                    <Text className="font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                        {f.total_meters}m {f.nfe_number ? `· NF: ${f.nfe_number}` : ''}
                    </Text>
                </View>
            ))}
        </View>
    );
}

// ─── Linha de ferramenta ─────────────────────────────────────────────────────

function ToolLineCard({
    index,
    line,
    storeId,
    disabled,
    onChange,
    onRemove,
}: {
    index: number;
    line: ToolLineDraft;
    storeId?: number;
    disabled: boolean;
    onChange: (patch: Partial<ToolLineDraft>) => void;
    onRemove: () => void;
}) {
    const employeeSheetRef = useRef<SelectRef>(null);
    const { employees } = useEmployees(storeId ? { store_id: storeId } : undefined);
    const employeeOptions = useMemo(
        () => [
            { value: 0, label: 'Nenhum (estoque geral)' },
            ...employees.map((e) => ({ value: e.id, label: e.name })),
        ],
        [employees]
    );
    const employeeName = employees.find((e) => e.id === line.employee_id)?.name;

    return (
        <View className="mb-3 rounded-2xl border border-neutral-200 bg-white p-3 dark:border-dark-border-strong dark:bg-dark-surface">
            <View className="mb-2 flex-row items-center justify-between">
                <Text className="font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
                    Ferramenta {index + 1}
                </Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remover ferramenta ${index + 1}`}
                    disabled={disabled}
                    onPress={onRemove}
                    hitSlop={8}
                    className="h-9 w-9 items-center justify-center rounded-full active:bg-error-light dark:active:bg-dark-elevated"
                >
                    <Ionicons name="close" size={18} color="#F04438" />
                </Pressable>
            </View>

            <TextField
                label="Nome *"
                placeholder="Ex: Espátula, Feltro..."
                value={line.name}
                onChangeText={(t) => onChange({ name: t })}
                editable={!disabled}
            />
            <NumberField
                label="Quantidade *"
                placeholder="Ex: 2"
                value={line.quantity}
                onChange={(n) => onChange({ quantity: n })}
                disabled={disabled}
                integer
            />
            <NumberField
                label="Custo (R$) *"
                placeholder="Ex: 120.00"
                value={line.cost}
                onChange={(n) => onChange({ cost: n })}
                disabled={disabled}
            />
            <TextField
                label="Nota Fiscal *"
                placeholder="Ex: NF-001234"
                autoCorrect={false}
                value={line.nfe_number ?? ''}
                onChangeText={(t) => onChange({ nfe_number: t })}
                editable={!disabled}
            />
            <TextField
                label="Observações"
                placeholder="Notas (opcional)"
                value={line.notes ?? ''}
                onChangeText={(t) => onChange({ notes: t })}
                editable={!disabled}
            />

            <FieldLabel>Funcionário (opcional)</FieldLabel>
            <PickerField
                placeholder="Nenhum (estoque geral)"
                value={employeeName}
                disabled={disabled}
                onPress={() => employeeSheetRef.current?.present()}
            />

            <Select<number>
                ref={employeeSheetRef}
                title="Vincular a funcionário"
                options={employeeOptions}
                value={line.employee_id ?? 0}
                onChange={(v) => onChange({ employee_id: v === 0 ? undefined : v })}
            />
        </View>
    );
}

// ─── Primitivos locais ───────────────────────────────────────────────────────

function FieldLabel({ children }: { children: string }) {
    return (
        <Text className="mb-1.5 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
            {children}
        </Text>
    );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
    return (
        <View className="mb-3 mt-5 border-t border-neutral-100 pt-4 dark:border-dark-border-soft">
            <Text className="font-display-bold text-base text-neutral-900 dark:text-dark-text">
                {title}
            </Text>
            {subtitle ? (
                <Text className="mt-0.5 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                    {subtitle}
                </Text>
            ) : null}
        </View>
    );
}

function AddLineButton({
    label,
    onPress,
    disabled,
}: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            disabled={disabled}
            onPress={onPress}
            className={`min-h-[48px] flex-row items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-300 active:opacity-70 dark:border-dark-border-strong ${
                disabled ? 'opacity-50' : ''
            }`}
        >
            <Ionicons name="add" size={18} color="#98A2B3" />
            <Text className="font-sans-semibold text-sm text-neutral-600 dark:text-dark-text">
                {label}
            </Text>
        </Pressable>
    );
}

function NumberField({
    label,
    placeholder,
    value,
    onChange,
    disabled,
    integer,
}: {
    label: string;
    placeholder: string;
    value?: number;
    onChange: (n: number | undefined) => void;
    disabled?: boolean;
    integer?: boolean;
}) {
    return (
        <TextField
            label={label}
            placeholder={placeholder}
            keyboardType="numeric"
            value={value != null && !Number.isNaN(value) ? String(value) : ''}
            onChangeText={(t) => {
                if (t === '') {
                    onChange(undefined);
                    return;
                }
                const n = integer ? parseInt(t.replace(/[^\d]/g, ''), 10) : Number(t.replace(',', '.'));
                onChange(Number.isNaN(n) ? undefined : n);
            }}
            editable={!disabled}
        />
    );
}

interface PickerFieldProps {
    placeholder: string;
    value?: string;
    onPress: () => void;
    disabled?: boolean;
}

function PickerField({ placeholder, value, onPress, disabled }: PickerFieldProps) {
    return (
        <View className="mb-4">
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={value ?? placeholder}
                disabled={disabled}
                onPress={onPress}
                className={[
                    'min-h-[48px] flex-row items-center justify-between rounded-lg border px-4 py-3 active:opacity-80',
                    'border-neutral-200 dark:border-dark-border-strong',
                    'bg-white dark:bg-dark-input',
                    disabled ? 'opacity-60' : '',
                ].join(' ')}
            >
                <Text
                    className={[
                        'flex-1 font-sans text-base',
                        value
                            ? 'text-neutral-900 dark:text-dark-text'
                            : 'text-neutral-400 dark:text-dark-text-muted',
                    ].join(' ')}
                    numberOfLines={1}
                >
                    {value || placeholder}
                </Text>
                <Ionicons name="chevron-down" size={20} color="#98A2B3" />
            </Pressable>
        </View>
    );
}

interface ChipProps {
    label: string;
    active: boolean;
    onPress: () => void;
    disabled?: boolean;
}

function Chip({ label, active, onPress, disabled }: ChipProps) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled: !!disabled }}
            accessibilityLabel={label}
            disabled={disabled}
            onPress={onPress}
            className={[
                'min-h-[40px] items-center justify-center rounded-full px-4 py-2 active:opacity-80',
                active ? 'bg-brand' : 'bg-neutral-100 dark:bg-dark-elevated',
                disabled ? 'opacity-50' : '',
            ].join(' ')}
        >
            <Text
                className={[
                    'font-sans-semibold text-sm',
                    active ? 'text-brand-black' : 'text-neutral-600 dark:text-dark-text',
                ].join(' ')}
            >
                {label}
            </Text>
        </Pressable>
    );
}
