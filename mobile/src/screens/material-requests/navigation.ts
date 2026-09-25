import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AppStackScreenProps } from '@/navigation/types';

/**
 * Tipagem LOCAL da stack "Pedidos de Material".
 *
 * Definida aqui (e não em navigation/types.ts) porque o registro da rota é feito
 * por quem integra o módulo. Quando o `MaterialRequestsStack` for adicionado ao
 * AppStack, basta mover este ParamList para navigation/types.ts e apontar o pai
 * correto. Assumimos que a stack é hospedada como uma rota do AppStack
 * (`MaterialRequests`), à semelhança de Admin — por isso o pai é
 * `AppStackScreenProps<'MaterialRequests'>`.
 *
 * NOTA para o integrador: adicione `MaterialRequests:
 * NavigatorScreenParams<MaterialRequestsStackParamList>` ao `AppStackParamList`
 * (ou registre estas telas na stack de sua preferência) e reaponte este arquivo
 * para o tipo oficial.
 */
export type MaterialRequestsStackParamList = {
    MaterialRequestsList: undefined;
    CreateMaterialRequest: undefined;
    EditMaterialRequest: { id: number };
};

export type MaterialRequestsStackScreenProps<
    T extends keyof MaterialRequestsStackParamList,
> = CompositeScreenProps<
    NativeStackScreenProps<MaterialRequestsStackParamList, T>,
    AppStackScreenProps<'MaterialRequests'>
>;
