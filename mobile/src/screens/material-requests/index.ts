/**
 * Barrel do módulo "Pedidos de Material" (rota web /pedidos).
 *
 * Facilita o registro da navegação: importe as três telas + o ParamList local
 * daqui. Ver `navigation.ts` para a nota de integração ao AppStack.
 */
export { MaterialRequestsListScreen } from './MaterialRequestsListScreen';
export { CreateMaterialRequestScreen } from './CreateMaterialRequestScreen';
export { EditMaterialRequestScreen } from './EditMaterialRequestScreen';
export type {
    MaterialRequestsStackParamList,
    MaterialRequestsStackScreenProps,
} from './navigation';
