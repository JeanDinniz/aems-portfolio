import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    Linking,
    Pressable,
    ScrollView,
    Text,
    View,
} from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import type { Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Ionicons } from '@expo/vector-icons';

import { useConfirm } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { Select, type SelectOption, type SelectRef } from '@/components/ui/Select';
import { Sheet, type SheetRef } from '@/components/ui/Sheet';
import { TextField } from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';
import {
    useCreateCertificate,
    useUpdateCertificate,
    useVehicleHistorySearch,
} from '@/hooks/useEbook';
import { useStores } from '@/hooks/useStores';
import {
    captureFromCamera,
    pickFromLibrary,
    CaptureCancelled,
    PermissionDeniedError,
} from '@/services/camera/capturePhoto';
import { compressPhoto } from '@/services/camera/compressPhoto';
import { uploadPhoto } from '@/services/upload/uploadPhoto';
import { downloadAndSharePdf } from '@/utils/exportShare';
import { getApiErrorMessage } from '@/lib/api-error';
import { ymdLocal } from '@/utils/formatDate';
import type { Certificate } from '@/types/ebook.types';

/**
 * Sheet compartilhado de Certificado de Garantia — paridade com o web
 * `GenerateCertificateDialog`, adaptado ao mobile. Serve para GERAR e EDITAR
 * (quando recebe `certificate`).
 *
 * Fluxo: form (RHF + zod) → salva (create/update) → toast + oferece o
 * download/compartilhamento do PDF (`downloadAndSharePdf`). Não há preview de PDF
 * no mobile.
 *
 * Campos alinhados ao contrato do backend: marca, loja, placa, cliente, modelo,
 * cor, nota fiscal, chassi, serviço, garantia (meses), data de emissão, número
 * da O.S. (texto opcional), vínculo `service_order_id` e foto do certificado
 * assinado (`signed_photo_url`).
 *
 * Paridade completa com o web (HML-236):
 * - Busca de O.S. por placa/número (`useVehicleHistorySearch`): pré-preenche
 *   placa/serviço/os_number e resolve `service_order_id` da O.S. mais recente.
 * - Foto do certificado assinado: captura pela câmera OU galeria, comprime
 *   (`compressPhoto`, ~1600px/JPEG 0.7, limite 10 MB) e sobe via
 *   `uploadPhoto` (POST /upload/photo) — a `url` retornada vai em
 *   `signed_photo_url`. Miniatura com opção de trocar/remover.
 *
 * Lojas do Select filtradas pela marca escolhida (galpão e AEMS não
 * emitem). Ao trocar a marca, a loja é zerada.
 */

// Marcas com logo embutido no certificado.
const BRANDS = [
    { code: 'toyota', label: 'Toyota' },
    { code: 'byd', label: 'BYD' },
    { code: 'fiat', label: 'Fiat' },
    { code: 'hyundai', label: 'Hyundai' },
] as const;

const BRAND_OPTIONS: SelectOption<string>[] = BRANDS.map((b) => ({
    value: b.code,
    label: b.label,
}));

const certificateSchema = z.object({
    brand_code: z.string().min(1, 'Selecione a marca'),
    store_id: z.string().min(1, 'Selecione a loja'),
    plate: z.string().min(1, 'Placa é obrigatória'),
    customer_name: z.string().min(1, 'Nome do cliente é obrigatório'),
    model: z.string().optional(),
    color: z.string().optional(),
    invoice_number: z.string().min(1, 'Nota fiscal é obrigatória'),
    chassi: z.string().min(1, 'Chassi é obrigatório'),
    service_name: z.string().optional(),
    warranty_months: z.string().optional(),
    issue_date: z.string().optional(),
    // Campo único de "vincular O.S." (placa OU número). Espelha `os_search` do web;
    // ao salvar, seu valor final vira `os_number`.
    os_number: z.string().optional(),
});

type CertificateForm = z.infer<typeof certificateSchema>;

function emptyForm(): CertificateForm {
    return {
        brand_code: '',
        store_id: '',
        plate: '',
        customer_name: '',
        model: '',
        color: '',
        invoice_number: '',
        chassi: '',
        service_name: '',
        warranty_months: '12',
        issue_date: ymdLocal(),
        os_number: '',
    };
}

function formFromCertificate(cert: Certificate): CertificateForm {
    return {
        brand_code: cert.brand_code,
        store_id: cert.store_id ? String(cert.store_id) : '',
        plate: cert.plate ?? '',
        customer_name: cert.customer_name ?? '',
        model: cert.model ?? '',
        color: cert.color ?? '',
        invoice_number: cert.invoice_number ?? '',
        chassi: cert.chassi ?? '',
        service_name: cert.service_name ?? '',
        warranty_months: String(cert.warranty_months ?? 12),
        issue_date: cert.issue_date ?? ymdLocal(),
        os_number: cert.os_number ?? '',
    };
}

export interface GenerateCertificateSheetProps {
    /** Se fornecido, o sheet abre em modo EDIÇÃO desse certificado. */
    certificate?: Certificate | null;
    /** Chamado após salvar com sucesso (ex.: atualizar a lista). */
    onSaved?: (cert: Certificate) => void;
    /** @deprecated use `onSaved`. Mantido por compat. */
    onCreated?: (cert: Certificate) => void;
}

export const GenerateCertificateSheet = forwardRef<SheetRef, GenerateCertificateSheetProps>(
    function GenerateCertificateSheet({ certificate, onSaved, onCreated }, ref) {
        const toast = useToast();
        const { alert } = useConfirm();
        const isEdit = !!certificate;
        const createCertificate = useCreateCertificate();
        const updateCertificate = useUpdateCertificate();
        const vehicleSearch = useVehicleHistorySearch();
        const { stores } = useStores();

        const brandSelectRef = useRef<SelectRef>(null);
        const storeSelectRef = useRef<SelectRef>(null);
        const [downloading, setDownloading] = useState(false);

        // Vínculo com a O.S. resolvido pela busca por placa/número.
        const [resolvedOsId, setResolvedOsId] = useState<number | null>(
            certificate?.service_order_id ?? null
        );

        // Foto do certificado assinado (signed_photo_url): captura → comprime →
        // sobe via /upload/photo; a `url` retornada é gravada aqui.
        const [signedPhotoUrl, setSignedPhotoUrl] = useState<string | null>(
            certificate?.signed_photo_url ?? null
        );
        const [uploadingPhoto, setUploadingPhoto] = useState(false);

        const {
            control,
            handleSubmit,
            watch,
            setValue,
            reset,
            formState: { errors },
        } = useForm<CertificateForm>({
            resolver: zodResolver(certificateSchema) as unknown as Resolver<CertificateForm>,
            defaultValues: certificate ? formFromCertificate(certificate) : emptyForm(),
        });

        // Reseta o form quando o certificado editado muda (o mesmo sheet é reusado).
        useEffect(() => {
            reset(certificate ? formFromCertificate(certificate) : emptyForm());
            setResolvedOsId(certificate?.service_order_id ?? null);
            setSignedPhotoUrl(certificate?.signed_photo_url ?? null);
        }, [certificate, reset]);

        const brandCode = watch('brand_code');

        // Lojas da marca (galpão e AEMS não emitem certificado).
        const storeOptions = useMemo<SelectOption<string>[]>(
            () =>
                stores
                    .filter(
                        (s) =>
                            s.brand?.code === brandCode &&
                            !s.is_galpon_store &&
                            !s.code?.startsWith('WC')
                    )
                    .map((s) => ({ value: String(s.id), label: s.name })),
            [stores, brandCode]
        );

        const isMutating = createCertificate.isPending || updateCertificate.isPending;

        // ── Busca de O.S. por placa/número (TODO 2) ────────────────────────────
        // Espelha o web: pega o histórico do veículo e usa a O.S. mais recente
        // para pré-preencher placa/serviço/os_number + resolver service_order_id.
        const handleSearchOs = useCallback(() => {
            const query = watch('os_number')?.trim();
            if (!query) return;
            vehicleSearch.mutate(query, {
                onSuccess: (history) => {
                    const latest = history.items[0];
                    if (!latest) {
                        toast.error('Nenhuma O.S. encontrada para essa placa ou número.');
                        return;
                    }
                    if (history.plate) setValue('plate', history.plate);
                    if (latest.service_names[0]) setValue('service_name', latest.service_names[0]);
                    setValue('os_number', latest.order_number);
                    setResolvedOsId(latest.id);
                    toast.success(
                        `O.S. ${latest.order_number}${history.plate ? ` — ${history.plate}` : ''}`
                    );
                },
                onError: (err) => {
                    toast.error(getApiErrorMessage(err as Error, 'Erro ao buscar a O.S.'));
                },
            });
        }, [watch, setValue, vehicleSearch, toast]);

        // ── Foto do certificado assinado (TODO 1) ──────────────────────────────
        // Captura/escolhe → comprime (serial, ~1600px/JPEG 0.7, valida 10 MB) →
        // sobe via POST /upload/photo → grava a url em signed_photo_url.
        const processSignedPhoto = useCallback(
            async (source: 'camera' | 'library') => {
                let asset;
                try {
                    asset =
                        source === 'camera'
                            ? await captureFromCamera()
                            : await pickFromLibrary();
                } catch (error) {
                    if (error instanceof CaptureCancelled) return; // silencioso
                    if (error instanceof PermissionDeniedError) {
                        Alert.alert(
                            'Permissão necessária',
                            `${error.message} Você pode habilitar nas configurações do aparelho.`,
                            error.canAskAgain
                                ? [{ text: 'OK' }]
                                : [
                                      { text: 'Cancelar', style: 'cancel' },
                                      {
                                          text: 'Abrir Ajustes',
                                          onPress: () => Linking.openSettings(),
                                      },
                                  ]
                        );
                        return;
                    }
                    await alert({ title: 'Erro', message: 'Não foi possível obter a foto.' });
                    return;
                }

                setUploadingPhoto(true);
                try {
                    const compressed = await compressPhoto(asset);
                    const url = await uploadPhoto(compressed);
                    setSignedPhotoUrl(url);
                } catch (error) {
                    toast.error(
                        getApiErrorMessage(
                            error as Error,
                            'Não foi possível enviar a foto do certificado.'
                        )
                    );
                } finally {
                    setUploadingPhoto(false);
                }
            },
            [toast, alert]
        );

        // Origem da foto via Alert nativo (Câmera/Galeria). Evita aninhar um
        // BottomSheetModal dentro deste Sheet — o picker nativo é aberto direto,
        // sem backdrop de sheet por cima.
        const promptPhotoSource = useCallback(() => {
            Alert.alert('Foto do certificado', 'Como deseja anexar a foto?', [
                { text: 'Tirar foto', onPress: () => void processSignedPhoto('camera') },
                {
                    text: 'Escolher da galeria',
                    onPress: () => void processSignedPhoto('library'),
                },
                { text: 'Cancelar', style: 'cancel' },
            ]);
        }, [processSignedPhoto]);

        const onSubmit = useCallback(
            (form: CertificateForm) => {
                const brand = BRANDS.find((b) => b.code === form.brand_code);
                const payload = {
                    brand_code: form.brand_code,
                    brand_name: brand?.label,
                    store_id: Number(form.store_id),
                    plate: form.plate.trim(),
                    model: form.model?.trim() || undefined,
                    color: form.color?.trim() || undefined,
                    customer_name: form.customer_name.trim(),
                    invoice_number: form.invoice_number.trim(),
                    chassi: form.chassi.trim(),
                    service_name: form.service_name?.trim() || undefined,
                    warranty_months: form.warranty_months
                        ? Number(form.warranty_months)
                        : undefined,
                    issue_date: form.issue_date?.trim() || undefined,
                    os_number: form.os_number?.trim() || undefined,
                    // Só enviados quando existem (não inventar campos vazios).
                    service_order_id: resolvedOsId ?? undefined,
                    signed_photo_url: signedPhotoUrl ?? undefined,
                };

                const afterSave = async (saved: Certificate) => {
                    toast.success(isEdit ? 'Certificado atualizado.' : 'Certificado gerado.');
                    (ref as React.RefObject<SheetRef>)?.current?.dismiss();
                    reset(emptyForm());
                    setResolvedOsId(null);
                    setSignedPhotoUrl(null);
                    onSaved?.(saved);
                    onCreated?.(saved);

                    // Oferece o download/compartilhamento do PDF salvo.
                    setDownloading(true);
                    try {
                        const label = (saved.plate ?? String(saved.id))
                            .replace(/\s+/g, '_')
                            .replace(/[^a-zA-Z0-9_-]/g, '');
                        await downloadAndSharePdf({
                            path: `/ebook/certificates/${saved.id}/pdf`,
                            filename: `certificado_${label}.pdf`,
                        });
                    } catch (err) {
                        toast.error(
                            getApiErrorMessage(
                                err as Error,
                                'Certificado salvo, mas não foi possível baixar o PDF.'
                            )
                        );
                    } finally {
                        setDownloading(false);
                    }
                };

                if (isEdit && certificate) {
                    updateCertificate.mutate(
                        { id: certificate.id, payload },
                        { onSuccess: afterSave }
                    );
                } else {
                    createCertificate.mutate(payload, { onSuccess: afterSave });
                }
            },
            [
                certificate,
                createCertificate,
                isEdit,
                onCreated,
                onSaved,
                ref,
                reset,
                resolvedOsId,
                signedPhotoUrl,
                toast,
                updateCertificate,
            ]
        );

        return (
            <Sheet
                ref={ref}
                title={isEdit ? 'Editar Certificado de Garantia' : 'Gerar Certificado de Garantia'}
            >
                <ScrollView
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={{ paddingBottom: 24 }}
                    showsVerticalScrollIndicator={false}
                >
                    <Text className="mb-3 font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
                        Certificado de Garantia
                    </Text>

                    {/* Vincular O.S. (opcional) — busca por placa/número */}
                    <Controller
                        control={control}
                        name="os_number"
                        render={({ field: { value, onChange } }) => (
                            <View className="mb-4">
                                <Text className="mb-1.5 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
                                    Vincular O.S. (opcional)
                                </Text>
                                <View className="flex-row items-start gap-2">
                                    <View className="flex-1">
                                        <TextField
                                            value={value ?? ''}
                                            onChangeText={(t) => {
                                                onChange(t);
                                                // Editar o campo desfaz o vínculo resolvido: o
                                                // usuário precisa buscar de novo para revincular.
                                                if (resolvedOsId != null) setResolvedOsId(null);
                                            }}
                                            placeholder="Placa ou número da O.S."
                                            autoCapitalize="characters"
                                            autoCorrect={false}
                                            returnKeyType="search"
                                            onSubmitEditing={handleSearchOs}
                                        />
                                    </View>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel="Buscar O.S."
                                        accessibilityState={{
                                            busy: vehicleSearch.isPending,
                                            disabled: vehicleSearch.isPending,
                                        }}
                                        disabled={vehicleSearch.isPending}
                                        onPress={handleSearchOs}
                                        className={`h-[52px] w-[52px] items-center justify-center rounded-lg border border-neutral-200 bg-white active:opacity-70 dark:border-dark-border-strong dark:bg-dark-input ${
                                            vehicleSearch.isPending ? 'opacity-60' : ''
                                        }`}
                                    >
                                        {vehicleSearch.isPending ? (
                                            <ActivityIndicator size="small" color="#98A2B3" />
                                        ) : (
                                            <Ionicons name="search" size={20} color="#98A2B3" />
                                        )}
                                    </Pressable>
                                </View>
                                <Text className="mt-1 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                                    {resolvedOsId != null
                                        ? 'O.S. vinculada. Buscar por placa pré-preenche o veículo.'
                                        : 'Buscar por placa pré-preenche os campos do veículo.'}
                                </Text>
                            </View>
                        )}
                    />

                    {/* Marca */}
                    <Controller
                        control={control}
                        name="brand_code"
                        render={({ field: { value, onChange } }) => {
                            const label =
                                BRAND_OPTIONS.find((o) => o.value === value)?.label ??
                                'Selecione a marca';
                            return (
                                <>
                                    <SheetSelectField
                                        title="Marca"
                                        required
                                        label={label}
                                        placeholder={!value}
                                        error={errors.brand_code?.message}
                                        onPress={() => brandSelectRef.current?.present()}
                                    />
                                    <Select<string>
                                        ref={brandSelectRef}
                                        title="Marca"
                                        options={BRAND_OPTIONS}
                                        value={value}
                                        onChange={(v) => {
                                            onChange(v);
                                            // Troca de marca invalida a loja escolhida.
                                            setValue('store_id', '');
                                        }}
                                    />
                                </>
                            );
                        }}
                    />

                    {/* Loja */}
                    <Controller
                        control={control}
                        name="store_id"
                        render={({ field: { value, onChange } }) => {
                            const label =
                                storeOptions.find((o) => o.value === value)?.label ??
                                (brandCode ? 'Selecione a loja' : 'Escolha a marca primeiro');
                            return (
                                <>
                                    <SheetSelectField
                                        title="Loja"
                                        required
                                        label={label}
                                        placeholder={!value}
                                        disabled={!brandCode}
                                        error={errors.store_id?.message}
                                        onPress={() => {
                                            if (brandCode) storeSelectRef.current?.present();
                                        }}
                                    />
                                    <Select<string>
                                        ref={storeSelectRef}
                                        title="Loja"
                                        options={storeOptions}
                                        value={value}
                                        onChange={onChange}
                                    />
                                </>
                            );
                        }}
                    />

                    <Controller
                        control={control}
                        name="plate"
                        render={({ field: { value, onChange } }) => (
                            <TextField
                                label="Placa *"
                                value={value}
                                onChangeText={onChange}
                                placeholder="ABC1D23"
                                autoCapitalize="characters"
                                autoCorrect={false}
                                error={errors.plate?.message}
                            />
                        )}
                    />

                    <Controller
                        control={control}
                        name="customer_name"
                        render={({ field: { value, onChange } }) => (
                            <TextField
                                label="Cliente *"
                                value={value}
                                onChangeText={onChange}
                                placeholder="Nome do cliente"
                                error={errors.customer_name?.message}
                            />
                        )}
                    />

                    <Controller
                        control={control}
                        name="model"
                        render={({ field: { value, onChange } }) => (
                            <TextField
                                label="Modelo"
                                value={value ?? ''}
                                onChangeText={onChange}
                                placeholder="Ex.: Corolla XEI"
                            />
                        )}
                    />

                    <Controller
                        control={control}
                        name="color"
                        render={({ field: { value, onChange } }) => (
                            <TextField
                                label="Cor"
                                value={value ?? ''}
                                onChangeText={onChange}
                                placeholder="Ex.: Prata"
                            />
                        )}
                    />

                    <Controller
                        control={control}
                        name="invoice_number"
                        render={({ field: { value, onChange } }) => (
                            <TextField
                                label="Nota Fiscal *"
                                value={value}
                                onChangeText={onChange}
                                placeholder="Nº da NF"
                                error={errors.invoice_number?.message}
                            />
                        )}
                    />

                    <Controller
                        control={control}
                        name="chassi"
                        render={({ field: { value, onChange } }) => (
                            <TextField
                                label="Chassi *"
                                value={value}
                                onChangeText={onChange}
                                placeholder="Chassi"
                                autoCapitalize="characters"
                                autoCorrect={false}
                                error={errors.chassi?.message}
                            />
                        )}
                    />

                    <Controller
                        control={control}
                        name="service_name"
                        render={({ field: { value, onChange } }) => (
                            <TextField
                                label="Serviço"
                                value={value ?? ''}
                                onChangeText={onChange}
                                placeholder="Ex.: Vitrificação de Pintura"
                            />
                        )}
                    />

                    <Controller
                        control={control}
                        name="warranty_months"
                        render={({ field: { value, onChange } }) => (
                            <TextField
                                label="Garantia (meses)"
                                value={value ?? ''}
                                onChangeText={onChange}
                                placeholder="12"
                                keyboardType="number-pad"
                            />
                        )}
                    />

                    <Controller
                        control={control}
                        name="issue_date"
                        render={({ field: { value, onChange } }) => (
                            <TextField
                                label="Data de Emissão (AAAA-MM-DD)"
                                value={value ?? ''}
                                onChangeText={onChange}
                                placeholder="2026-08-19"
                                autoCapitalize="none"
                                autoCorrect={false}
                            />
                        )}
                    />

                    {/* Foto do Certificado Assinado (opcional) — signed_photo_url */}
                    <View className="mb-4">
                        <Text className="mb-1.5 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
                            Foto do Certificado Assinado
                        </Text>
                        {signedPhotoUrl ? (
                            <View className="flex-row items-center gap-3">
                                <View className="h-24 w-24 overflow-hidden rounded-xl bg-neutral-100 dark:bg-dark-elevated">
                                    <Image
                                        source={{ uri: signedPhotoUrl }}
                                        style={{ width: '100%', height: '100%' }}
                                        resizeMode="cover"
                                        accessibilityLabel="Miniatura do certificado assinado"
                                    />
                                </View>
                                <View className="flex-1 gap-2">
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel="Trocar foto"
                                        accessibilityState={{ disabled: uploadingPhoto }}
                                        disabled={uploadingPhoto}
                                        onPress={promptPhotoSource}
                                        className={`min-h-[40px] flex-row items-center gap-1.5 self-start rounded-lg bg-neutral-50 px-3 active:opacity-80 dark:bg-dark-elevated ${
                                            uploadingPhoto ? 'opacity-50' : ''
                                        }`}
                                    >
                                        {uploadingPhoto ? (
                                            <ActivityIndicator size="small" color="#475467" />
                                        ) : (
                                            <Ionicons name="swap-horizontal" size={16} color="#475467" />
                                        )}
                                        <Text className="font-sans-semibold text-sm text-neutral-600 dark:text-dark-text">
                                            {uploadingPhoto ? 'Enviando...' : 'Trocar'}
                                        </Text>
                                    </Pressable>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel="Remover foto"
                                        disabled={uploadingPhoto}
                                        onPress={() => setSignedPhotoUrl(null)}
                                        className="min-h-[40px] flex-row items-center gap-1.5 self-start rounded-lg bg-neutral-50 px-3 active:opacity-80 dark:bg-dark-elevated"
                                    >
                                        <Ionicons name="trash-outline" size={16} color="#F04438" />
                                        <Text className="font-sans-semibold text-sm text-error dark:text-error-dark">
                                            Remover
                                        </Text>
                                    </Pressable>
                                </View>
                            </View>
                        ) : (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Adicionar foto do certificado assinado"
                                accessibilityState={{ busy: uploadingPhoto, disabled: uploadingPhoto }}
                                disabled={uploadingPhoto}
                                onPress={promptPhotoSource}
                                className={`min-h-[48px] flex-row items-center gap-2 rounded-lg border border-dashed border-neutral-300 px-4 py-3 active:opacity-70 dark:border-dark-border ${
                                    uploadingPhoto ? 'opacity-60' : ''
                                }`}
                            >
                                {uploadingPhoto ? (
                                    <ActivityIndicator size="small" color="#98A2B3" />
                                ) : (
                                    <Ionicons name="image-outline" size={18} color="#98A2B3" />
                                )}
                                <Text className="font-sans-medium text-sm text-neutral-500 dark:text-dark-text-muted">
                                    {uploadingPhoto ? 'Enviando...' : 'Adicionar foto (opcional)'}
                                </Text>
                            </Pressable>
                        )}
                        <Text className="mt-1 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                            Foto da via física do certificado assinada pelo cliente.
                        </Text>
                    </View>

                    <Text className="mb-3 mt-1 rounded-lg bg-neutral-50 px-3 py-2 font-sans text-xs text-neutral-400 dark:bg-dark-elevated dark:text-dark-text-muted">
                        {isEdit
                            ? 'As alterações são salvas no histórico e o PDF atualizado é aberto para compartilhar/salvar.'
                            : 'Ao gerar, o certificado é salvo no histórico e o PDF é aberto para compartilhar/salvar.'}
                    </Text>

                    <Button
                        title={isEdit ? 'Salvar Alterações' : 'Gerar Certificado'}
                        icon="shield-checkmark-outline"
                        loading={isMutating || downloading}
                        onPress={handleSubmit(onSubmit)}
                    />
                </ScrollView>
            </Sheet>
        );
    }
);

// ─── subcomponentes ───────────────────────────────────────────────────────────

function SheetSelectField({
    title,
    label,
    placeholder,
    required,
    disabled,
    error,
    onPress,
}: {
    title: string;
    label: string;
    placeholder: boolean;
    required?: boolean;
    disabled?: boolean;
    error?: string;
    onPress: () => void;
}) {
    return (
        <View className="mb-4">
            <Text className="mb-1.5 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
                {title}
                {required ? ' *' : ''}
            </Text>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${title}: ${label}`}
                accessibilityState={{ disabled: !!disabled }}
                disabled={disabled}
                onPress={onPress}
                className={`min-h-[48px] flex-row items-center justify-between rounded-lg border px-4 py-3 active:opacity-70 ${
                    error ? 'border-error' : 'border-neutral-200 dark:border-dark-border-strong'
                } bg-white dark:bg-dark-input ${disabled ? 'opacity-60' : ''}`}
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
            {error ? <Text className="mt-1 font-sans text-sm text-error">{error}</Text> : null}
        </View>
    );
}
