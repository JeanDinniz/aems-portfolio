/**
 * Componentes de domínio (features) do app mobile AEMS.
 * Ponto único de importação: `import { OSCard, ... } from '@/components/features'`.
 */
export { OSCard } from './OSCard';
export type { OSCardProps } from './OSCard';

export { OSTimeline } from './OSTimeline';
export type { OSTimelineProps, OSTimelineItem } from './OSTimeline';

export { PhotoGrid } from './PhotoGrid';
export type { PhotoGridProps } from './PhotoGrid';

export { PhotoCapture } from './PhotoCapture';
export type { PhotoCaptureProps } from './PhotoCapture';

export { ServiceItemPicker } from './ServiceItemPicker';
export type { ServiceItemPickerProps, ServiceItemSelection } from './ServiceItemPicker';

export { FilmRollPicker } from './FilmRollPicker';
export type { FilmRollPickerProps } from './FilmRollPicker';

export { StatusChangeSheet } from './StatusChangeSheet';
export type { StatusChangeSheetRef, StatusChangeSheetProps } from './StatusChangeSheet';

export { CancelOSSheet } from './CancelOSSheet';
export type { CancelOSSheetRef, CancelOSSheetProps } from './CancelOSSheet';
