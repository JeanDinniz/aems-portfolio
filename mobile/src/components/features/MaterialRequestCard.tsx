import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Badge } from '@/components/ui/Badge';
import type { MaterialPurchaseLineItem, MaterialRequest } from '@/types/materialRequest.types';

/**
 * Card de um Pedido de Material (paridade com o `RequestCard` do web).
 *
 * Mostra data, loja, autor, selos (Galpão / Histórico), observações e as seções
 * de películas, ferramentas/insumos e linhas de compra histórica. Ações (editar/
 * excluir) só quando as permissões permitem — o card em si é tocável para editar
 * (quando `canEdit`).
 */

export interface MaterialRequestCardProps {
    request: MaterialRequest;
    canEdit: boolean;
    canDelete: boolean;
    busy: boolean;
    onEdit: () => void;
    onDelete: () => void;
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' sem criar Date (evita deslocamento de timezone). */
function formatRequestDate(iso: string): string {
    const [y, m, d] = iso.split('-');
    return y && m && d ? `${d}/${m}/${y}` : iso;
}

function formatBRL(v: string | null): string | null {
    if (v == null || v === '') return null;
    const n = Number(v);
    if (Number.isNaN(n)) return null;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function MaterialRequestCard({
    request,
    canEdit,
    canDelete,
    busy,
    onEdit,
    onDelete,
}: MaterialRequestCardProps) {
    const filmLines = request.purchase_lines.filter((p) => p.kind === 'film');
    const toolLines = request.purchase_lines.filter((p) => p.kind === 'tool');

    return (
        <Pressable
            accessibilityRole={canEdit ? 'button' : 'summary'}
            accessibilityLabel={`Pedido de ${formatRequestDate(request.request_date)}`}
            disabled={!canEdit}
            onPress={onEdit}
            className="overflow-hidden rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm active:opacity-90 dark:border-dark-border-soft dark:bg-dark-surface"
        >
            {/* Cabeçalho: data + selos + excluir */}
            <View className="flex-row items-start justify-between gap-2">
                <View className="flex-1">
                    <View className="flex-row flex-wrap items-center gap-2">
                        <Text className="font-display-bold text-base text-neutral-900 dark:text-dark-text">
                            {formatRequestDate(request.request_date)}
                        </Text>
                        {request.is_galpon ? (
                            <Badge label="Galpão" variant="purple" size="sm" />
                        ) : null}
                        {request.source === 'planilha' ? (
                            <Badge label="Histórico" variant="neutral" size="sm" />
                        ) : null}
                    </View>
                    <View className="mt-1 flex-row flex-wrap items-center gap-1.5">
                        <Ionicons name="storefront-outline" size={13} color="#98A2B3" />
                        <Text className="font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                            {request.store_name ?? `Loja ${request.store_id}`}
                        </Text>
                        {request.created_by_name ? (
                            <>
                                <Text className="text-neutral-300 dark:text-dark-text-muted">·</Text>
                                <Text className="font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                                    {request.created_by_name}
                                </Text>
                            </>
                        ) : null}
                    </View>
                </View>

                {canDelete ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Excluir pedido"
                        accessibilityState={{ busy, disabled: busy }}
                        disabled={busy}
                        onPress={onDelete}
                        hitSlop={8}
                        className={`h-10 w-10 items-center justify-center rounded-full active:bg-error-light dark:active:bg-dark-elevated ${
                            busy ? 'opacity-50' : ''
                        }`}
                    >
                        {busy ? (
                            <ActivityIndicator size="small" color="#F04438" />
                        ) : (
                            <Ionicons name="trash-outline" size={18} color="#F04438" />
                        )}
                    </Pressable>
                ) : null}
            </View>

            {/* Observações */}
            {request.notes ? (
                <Text className="mt-2 font-sans text-xs italic text-neutral-500 dark:text-dark-text-muted">
                    {request.notes}
                </Text>
            ) : null}

            {/* Películas (bobinas criadas no Estoque) */}
            {request.film_items.length > 0 ? (
                <Section label={`Películas (${request.film_items.length})`} icon="film-outline">
                    {request.film_items.map((item) => (
                        <LineRow
                            key={item.film_roll_id}
                            title={item.film_type_name}
                            parts={[
                                item.tonality ? `— ${item.tonality}` : null,
                                `· ${item.total_meters}m`,
                                item.nfe_number ? `· NF: ${item.nfe_number}` : null,
                            ]}
                        />
                    ))}
                </Section>
            ) : null}

            {/* Ferramentas / insumos (texto livre) */}
            {request.tool_items.length > 0 ? (
                <Section
                    label={`Ferramentas / Insumos (${request.tool_items.length})`}
                    icon="build-outline"
                >
                    {request.tool_items.map((item) => (
                        <LineRow
                            key={item.id}
                            title={item.name}
                            parts={[
                                `× ${item.quantity}`,
                                item.employee_name ? `· ${item.employee_name}` : null,
                                item.notes ? `— ${item.notes}` : null,
                            ]}
                        />
                    ))}
                </Section>
            ) : null}

            {/* Compras históricas (importadas da planilha) */}
            {filmLines.length > 0 ? (
                <Section label={`Películas (compra) (${filmLines.length})`} icon="film-outline">
                    {filmLines.map((p) => (
                        <PurchaseRow key={p.id} line={p} />
                    ))}
                </Section>
            ) : null}
            {toolLines.length > 0 ? (
                <Section
                    label={`Ferramentas (compra) (${toolLines.length})`}
                    icon="build-outline"
                >
                    {toolLines.map((p) => (
                        <PurchaseRow key={p.id} line={p} />
                    ))}
                </Section>
            ) : null}
        </Pressable>
    );
}

// ─── Subcomponentes ─────────────────────────────────────────────────────────

function Section({
    label,
    icon,
    children,
}: {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    children: React.ReactNode;
}) {
    return (
        <View className="mt-3">
            <View className="flex-row items-center gap-1.5">
                <Ionicons name={icon} size={13} color="#98A2B3" />
                <Text className="font-sans-semibold text-xs uppercase tracking-wide text-neutral-500 dark:text-dark-text-muted">
                    {label}
                </Text>
            </View>
            <View className="mt-1 gap-0.5 pl-4">{children}</View>
        </View>
    );
}

function LineRow({ title, parts }: { title: string; parts: (string | null)[] }) {
    const extras = parts.filter(Boolean).join(' ');
    return (
        <Text className="font-sans text-xs text-neutral-700 dark:text-dark-text" numberOfLines={2}>
            <Text className="font-sans-semibold">{title}</Text>
            {extras ? (
                <Text className="text-neutral-500 dark:text-dark-text-muted"> {extras}</Text>
            ) : null}
        </Text>
    );
}

function PurchaseRow({ line }: { line: MaterialPurchaseLineItem }) {
    const brl = formatBRL(line.cost);
    const qty = line.quantity != null ? Number(line.quantity) : null;
    return (
        <LineRow
            title={line.material_name}
            parts={[
                line.tonality ? `— ${line.tonality}` : null,
                qty != null ? `· ${qty}${line.kind === 'film' ? 'm' : ''}` : null,
                line.supplier ? `· ${line.supplier}` : null,
                line.nfe_number ? `· NF: ${line.nfe_number}` : null,
                brl ? `· ${brl}` : null,
            ]}
        />
    );
}
