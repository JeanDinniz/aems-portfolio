import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { downloadAndSharePdf } from '@/utils/exportShare';
import { getApiErrorMessage } from '@/lib/api-error';
import { formatDateTimeBR, formatTimeBR } from '@/utils/formatDate';
import type { TimeClockReceipt } from '@/types/time-clock.types';

/**
 * PunchReceipt — comprovante de registro de ponto (REP-A).
 *
 * Dois modos:
 *  - DEFINITIVO (`receipt`): comprovante gerado pelo SERVIDOR, com o NSR real
 *    atribuído no INSERT. Mostra os dados legais e, quando há `recordId`, um
 *    botão para baixar/compartilhar o PDF oficial
 *    (`GET /time-clock/records/{id}/receipt?format=pdf`).
 *  - PROVISÓRIO (`provisional` + `collectedAt`): recibo local de uma batida
 *    coletada OFFLINE. Ainda não há NSR (só sai após o sync), então exibimos o
 *    instante real da coleta e avisamos que o comprovante definitivo vem depois.
 */
export interface PunchReceiptProps {
    /** Comprovante definitivo (com NSR real do servidor). */
    receipt?: TimeClockReceipt | null;
    /** Id do registro — habilita o download do PDF oficial no modo definitivo. */
    recordId?: number;
    /** `true` para o recibo PROVISÓRIO (offline, antes da sincronização). */
    provisional?: boolean;
    /** Instante da coleta offline (ISO com fuso) — usado no recibo provisório. */
    collectedAt?: string;
}

export function PunchReceipt({
    receipt,
    recordId,
    provisional = false,
    collectedAt,
}: PunchReceiptProps) {
    const toast = useToast();
    const [downloading, setDownloading] = useState(false);

    const handleShare = useCallback(async () => {
        if (downloading || recordId == null || !receipt) return;
        setDownloading(true);
        try {
            await downloadAndSharePdf({
                path: `/time-clock/records/${recordId}/receipt`,
                params: { format: 'pdf' },
                filename: `comprovante_ponto_nsr${receipt.nsr}.pdf`,
            });
        } catch (err) {
            toast.error(getApiErrorMessage(err as Error, 'Não foi possível gerar o comprovante.'));
        } finally {
            setDownloading(false);
        }
    }, [downloading, recordId, receipt, toast]);

    // ─── Modo PROVISÓRIO (offline, sem NSR) ──────────────────────────────────
    if (provisional && !receipt) {
        const hora = formatTimeBR(collectedAt);
        return (
            <Card className="border-warning-light bg-warning-light/30">
                <View className="flex-row items-center gap-2">
                    <Ionicons name="cloud-offline-outline" size={18} color="#F79009" />
                    <Text className="font-sans-bold text-sm text-neutral-800 dark:text-dark-text">
                        Comprovante de registro
                    </Text>
                </View>
                <Text className="mt-2 font-sans text-xs leading-5 text-neutral-600 dark:text-dark-text-muted">
                    {`Registro offline capturado às ${hora} — comprovante definitivo após sincronização.`}
                </Text>
            </Card>
        );
    }

    if (!receipt) return null;

    // ─── Modo DEFINITIVO (NSR real do servidor) ──────────────────────────────
    const isIn = receipt.type === 'in';
    return (
        <Card>
            <View className="flex-row items-center gap-2">
                <Ionicons name="receipt-outline" size={18} color="#12B76A" />
                <Text className="font-sans-bold text-sm text-neutral-800 dark:text-dark-text">
                    Comprovante de registro
                </Text>
                {receipt.is_offline_record ? (
                    <Badge label="offline" variant="warning" size="sm" />
                ) : null}
            </View>

            <View className="mt-3 gap-1.5">
                <ReceiptRow label="NSR" value={`NSR: ${receipt.nsr}`} bare />
                <ReceiptRow label="Funcionário" value={receipt.employee_name || '—'} />
                <ReceiptRow label="Tipo" value={isIn ? 'Entrada' : 'Saída'} />
                <ReceiptRow label="Data/Hora" value={formatDateTimeBR(receipt.recorded_at)} />
                <ReceiptRow label="Empregador" value={receipt.employer_name || '—'} />
                {receipt.hash_short ? (
                    <ReceiptRow label="Conferência" value={`...${receipt.hash_short}`} />
                ) : null}
            </View>

            {recordId != null ? (
                <View className="mt-4">
                    <Button
                        title="Salvar / Compartilhar"
                        icon="download-outline"
                        variant="secondary"
                        size="sm"
                        loading={downloading}
                        disabled={downloading}
                        onPress={handleShare}
                    />
                </View>
            ) : null}
        </Card>
    );
}

interface ReceiptRowProps {
    label: string;
    value: string;
    /** Quando `true`, renderiza só o `value` (ex.: a linha do NSR já formatada). */
    bare?: boolean;
}

function ReceiptRow({ label, value, bare = false }: ReceiptRowProps) {
    if (bare) {
        return (
            <Text className="font-sans-bold text-sm text-neutral-900 dark:text-dark-text">
                {value}
            </Text>
        );
    }
    return (
        <View className="flex-row items-baseline gap-2">
            <Text className="font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                {`${label}:`}
            </Text>
            <Text className="flex-1 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
                {value}
            </Text>
        </View>
    );
}
