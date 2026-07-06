import { Ionicons } from '@expo/vector-icons';

import { STATUS_LABELS } from '@/constants/service-orders';
import type { ServiceOrderStatus } from '@/types/service-order.types';

import { Badge, type BadgeVariant } from './Badge';

interface StatusVisual {
  variant: BadgeVariant;
  icon: keyof typeof Ionicons.glyphMap;
}

/**
 * Convenção de cor/ícone por status (Figma doc 06 §11.2):
 * - waiting  → neutro (aguardando)
 * - doing    → âmbar/warning (em andamento)
 * - ready    → verde/success (finalizada)
 * - wrong    → vermelho/error (lançado errado)
 * - cancelled→ neutro (cancelada)
 * - duplicate→ roxo/purple (duplicado — web usa roxo + ícone "Copy")
 *
 * Status nunca é só cor — sempre acompanha rótulo + ícone.
 */
const STATUS_VISUAL: Record<ServiceOrderStatus, StatusVisual> = {
  waiting: { variant: 'neutral', icon: 'time-outline' },
  doing: { variant: 'warning', icon: 'sync-outline' },
  ready: { variant: 'success', icon: 'checkmark-circle-outline' },
  wrong: { variant: 'error', icon: 'alert-circle-outline' },
  cancelled: { variant: 'neutral', icon: 'close-circle-outline' },
  duplicate: { variant: 'purple', icon: 'copy-outline' },
};

export interface OSStatusBadgeProps {
  status: ServiceOrderStatus;
  size?: 'sm' | 'md';
}

/**
 * Pílula de status de O.S. (DS-03): cor + rótulo + ícone.
 * Rótulos vêm de `STATUS_LABELS`.
 */
export function OSStatusBadge({ status, size = 'md' }: OSStatusBadgeProps) {
  const visual = STATUS_VISUAL[status];
  return (
    <Badge label={STATUS_LABELS[status]} variant={visual.variant} icon={visual.icon} size={size} />
  );
}
