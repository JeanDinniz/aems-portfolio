import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';

import { Sheet, type SheetRef } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useTheme } from '@/theme';
import { useCreateFilmType, useUpdateFilmType } from '@/hooks/useInventory';
import { FILM_DEPARTMENT_OPTIONS } from '@/constants/inventory';
import type {
    CreateFilmTypePayload,
    FilmDepartment,
    FilmType,
} from '@/services/api/inventory.service';

/**
 * INV-06 — FilmTypeFormSheet: cria/edita os dados gerais de um tipo de película
 * (nome, departamento, limiares amarelo/vermelho).
 *
 * Validações espelham o web (FilmTypesPage.handleSaveGeral): nome obrigatório,
 * limiares > 0 e vermelho < amarelo. Ao criar, `onSaved(created)` permite a tela
 * abrir os serviços do tipo recém-criado. Ao editar, `onSaved(undefined)`.
 */

export interface FilmTypeFormSheetRef {
    present: (editing?: FilmType | null) => void;
    dismiss: () => void;
}

export interface FilmTypeFormSheetProps {
    /** Chamado após salvar — recebe o tipo criado (modo create) ou undefined (edit). */
    onSaved?: (created?: FilmType) => void;
}

export const FilmTypeFormSheet = forwardRef<FilmTypeFormSheetRef, FilmTypeFormSheetProps>(
    function FilmTypeFormSheet({ onSaved }, ref) {
        const sheetRef = useRef<SheetRef>(null);
        const { colors } = useTheme();
        const toast = useToast();
        const createFilmType = useCreateFilmType();
        const updateFilmType = useUpdateFilmType();

        const [editingId, setEditingId] = useState<number | null>(null);
        const [name, setName] = useState('');
        const [department, setDepartment] = useState<FilmDepartment>('film');
        const [yellow, setYellow] = useState('');
        const [red, setRed] = useState('');

        const reset = useCallback(() => {
            setEditingId(null);
            setName('');
            setDepartment('film');
            setYellow('');
            setRed('');
        }, []);

        useImperativeHandle(ref, () => ({
            present: (editing?: FilmType | null) => {
                if (editing) {
                    setEditingId(editing.id);
                    setName(editing.name);
                    setDepartment(editing.department);
                    setYellow(String(editing.yellow_threshold_meters));
                    setRed(String(editing.red_threshold_meters));
                } else {
                    reset();
                }
                sheetRef.current?.present();
            },
            dismiss: () => sheetRef.current?.dismiss(),
        }));

        const isBusy = createFilmType.isPending || updateFilmType.isPending;

        const apply = useCallback(async () => {
            const yellowNum = Number(yellow.replace(',', '.'));
            const redNum = Number(red.replace(',', '.'));
            if (!name.trim()) {
                toast.error('Informe o nome do tipo.');
                return;
            }
            if (!yellowNum || yellowNum <= 0) {
                toast.error('Informe o limiar amarelo (metros).');
                return;
            }
            if (!redNum || redNum <= 0) {
                toast.error('Informe o limiar vermelho (metros).');
                return;
            }
            if (redNum >= yellowNum) {
                toast.error('Limiar vermelho deve ser menor que o amarelo.');
                return;
            }
            const payload: CreateFilmTypePayload = {
                name: name.trim(),
                department,
                yellow_threshold_meters: yellowNum,
                red_threshold_meters: redNum,
            };
            try {
                if (editingId) {
                    await updateFilmType.mutateAsync({ id: editingId, payload });
                    sheetRef.current?.dismiss();
                    onSaved?.(undefined);
                } else {
                    const created = await createFilmType.mutateAsync(payload);
                    sheetRef.current?.dismiss();
                    onSaved?.(created);
                }
            } catch {
                // Toast de erro já é exibido pelo hook (onError).
            }
        }, [name, department, yellow, red, editingId, createFilmType, updateFilmType, toast, onSaved]);

        return (
            <Sheet ref={sheetRef} title={editingId ? 'Editar tipo' : 'Novo tipo'} onDismiss={reset}>
                <View className="gap-3 pb-1">
                    <View>
                        <FieldLabel>Nome</FieldLabel>
                        <BottomSheetTextInput
                            placeholder="Ex: Poliéster, Fumê, PPF Transparente..."
                            placeholderTextColor={colors.placeholder}
                            value={name}
                            onChangeText={setName}
                            editable={!isBusy}
                            className={inputClasses(isBusy)}
                        />
                    </View>

                    <View>
                        <FieldLabel>Departamento</FieldLabel>
                        <View className="flex-row flex-wrap gap-2">
                            {FILM_DEPARTMENT_OPTIONS.map((opt) => (
                                <Chip
                                    key={opt.value}
                                    label={opt.label}
                                    active={department === opt.value}
                                    disabled={isBusy}
                                    onPress={() => setDepartment(opt.value)}
                                />
                            ))}
                        </View>
                    </View>

                    <View className="flex-row gap-3">
                        <View className="flex-1">
                            <FieldLabel>Limiar amarelo (m)</FieldLabel>
                            <BottomSheetTextInput
                                placeholder="Ex: 10"
                                placeholderTextColor={colors.placeholder}
                                keyboardType="numeric"
                                value={yellow}
                                onChangeText={setYellow}
                                editable={!isBusy}
                                className={inputClasses(isBusy)}
                            />
                        </View>
                        <View className="flex-1">
                            <FieldLabel>Limiar vermelho (m)</FieldLabel>
                            <BottomSheetTextInput
                                placeholder="Ex: 5"
                                placeholderTextColor={colors.placeholder}
                                keyboardType="numeric"
                                value={red}
                                onChangeText={setRed}
                                editable={!isBusy}
                                className={inputClasses(isBusy)}
                            />
                        </View>
                    </View>

                    <Button
                        title={editingId ? 'Salvar alterações' : 'Criar tipo'}
                        icon="checkmark"
                        loading={isBusy}
                        disabled={isBusy}
                        onPress={apply}
                    />
                    <Button
                        title="Cancelar"
                        variant="ghost"
                        disabled={isBusy}
                        onPress={() => sheetRef.current?.dismiss()}
                    />
                </View>
            </Sheet>
        );
    }
);

function inputClasses(busy: boolean): string {
    return [
        'rounded-lg border px-4 py-3 font-sans text-base',
        'text-neutral-900 dark:text-dark-text',
        'bg-white dark:bg-dark-input',
        'border-neutral-200 dark:border-dark-border-strong',
        busy ? 'opacity-60' : '',
    ].join(' ');
}

function FieldLabel({ children }: { children: string }) {
    return (
        <Text className="mb-1.5 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
            {children}
        </Text>
    );
}

function Chip({
    label,
    active,
    onPress,
    disabled,
}: {
    label: string;
    active: boolean;
    onPress: () => void;
    disabled?: boolean;
}) {
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
