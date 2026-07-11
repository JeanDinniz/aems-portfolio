import type { NavigatorScreenParams } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { OSCopyPrefill } from '@/types/service-order.types';

/**
 * Tipagem das rotas. O RootNavigator alterna entre AuthStack (deslogado) e
 * AppStack (logado), reagindo ao auth store. Quando `must_change_password`, o
 * RootNavigator monta apenas a tela bloqueante de troca de senha.
 *
 * AppStack (Sprint 2 — HOME-01) hospeda o AppTabs (barra inferior híbrida) +
 * telas/modais globais (Profile, ChangePassword, PhotoViewer).
 */

export type AuthStackParamList = {
    Login: undefined;
    ForgotPassword: undefined;
    ResetPassword: { token?: string } | undefined;
};

/** Stack do módulo Ordens de Serviço (dentro da aba O.S.). */
export type ServiceOrdersStackParamList = {
    ServiceOrdersList: undefined;
    ServiceOrderDetail: { id: number };
    /** `copyFrom` pré-preenche a criação a partir de uma O.S. (Gerar cópia). */
    CreateServiceOrder: { copyFrom?: OSCopyPrefill } | undefined;
    EditServiceOrder: { id: number };
    FinalizeOS: { id: number };
};

/** Stack do módulo Agendamentos (dentro da aba Agendamentos). */
export type SchedulingStackParamList = {
    SchedulingList: undefined;
    AppointmentDetail: { id: number };
    /** Stubs "Em breve" — substituídos na próxima ronda (AGD-03/05). */
    CreateAppointment: undefined;
    EditAppointment: { id: number };
    GenerateOS: { id: number };
};

/** Stack do módulo Estoque (dentro da aba Estoque). */
export type InventoryStackParamList = {
    InventoryRolls: undefined;
    RollDetail: { id: number };
    CreateRoll: undefined;
    FilmTypes: undefined;
    /** Serviços vinculados a um tipo de película (INV-06). */
    FilmTypeServices: { id: number };
    /** Transferência de bobina para outra loja (INV-05) — tela cheia. */
    TransferRoll: { id: number; currentStoreId: number };
    /** Bobinas em nível crítico (INV-07). */
    CriticalRolls: undefined;
    /** Previsão de consumo por tipo de película (INV-07). */
    Forecast: undefined;
};

/**
 * Stack do módulo Administração (acessível pelo menu Mais → Administração).
 *
 * Contém as 10 telas admin (Fatia 5a + 5b). A 5a registra AdminHub, Users/User,
 * Employees/Employee, Consultants, Stores, AccessProfiles/AccessProfile; a 5b
 * acrescenta os catálogos (Brands, VehicleModels, Services, Suppliers, Dealerships).
 * Escopo: leitura + ações essenciais (sem formulários de criar/editar).
 */
export type AdminStackParamList = {
    AdminHub: undefined;
    UsersAdmin: undefined;
    UserDetail: { id: number };
    EmployeesAdmin: undefined;
    EmployeeDetail: { id: number };
    ConsultantsAdmin: undefined;
    StoresAdmin: undefined;
    AccessProfilesAdmin: undefined;
    AccessProfileDetail: { id: string };
    /** Telas da Fatia 5b (ainda não implementadas). */
    BrandsAdmin: undefined;
    VehicleModelsAdmin: undefined;
    ServicesAdmin: undefined;
    SuppliersAdmin: undefined;
    DealershipsAdmin: undefined;
};

/** Barra inferior (navegação híbrida — doc 03 §1). Itens condicionais por permissão. */
export type AppTabsParamList = {
    Inicio: undefined;
    ServiceOrders: NavigatorScreenParams<ServiceOrdersStackParamList> | undefined;
    Scheduling: NavigatorScreenParams<SchedulingStackParamList> | undefined;
    Inventory: NavigatorScreenParams<InventoryStackParamList> | undefined;
    More: undefined;
};

export type AppStackParamList = {
    Tabs: NavigatorScreenParams<AppTabsParamList> | undefined;
    Profile: undefined;
    ChangePassword: undefined;
    /** Conferência de O.S. (auditoria — is_verified), acessível pelo menu Mais. */
    Conference: undefined;
    /** Fechamento mensal (agrupamento por departamento + exports), menu Mais. */
    Fechamento: undefined;
    /** Notificações in-app (sino da Home / aba Mais). */
    Notifications: undefined;
    /** Dashboard executivo (Owner/galpão) — KPIs, SLA, fila e rankings. */
    Dashboard: undefined;
    /** Módulo de Administração (hub + telas de leitura/ações essenciais). */
    Admin: NavigatorScreenParams<AdminStackParamList>;
    /** Configurações do app (tema, notificações, loja padrão, sobre). */
    Settings: undefined;
    /** Visualizador de fotos global (zoom/pan). */
    PhotoViewer: { photos: string[]; index?: number; title?: string };
};

export type AuthStackScreenProps<T extends keyof AuthStackParamList> = NativeStackScreenProps<
    AuthStackParamList,
    T
>;

export type AppStackScreenProps<T extends keyof AppStackParamList> = NativeStackScreenProps<
    AppStackParamList,
    T
>;

/** Props de uma aba: combina o tab navigator com o AppStack pai (permite navegar p/ Profile/PhotoViewer). */
export type AppTabScreenProps<T extends keyof AppTabsParamList> = CompositeScreenProps<
    BottomTabScreenProps<AppTabsParamList, T>,
    AppStackScreenProps<keyof AppStackParamList>
>;

/** Props de uma tela do ServiceOrdersStack: combina com o tab + o AppStack pai. */
export type ServiceOrdersStackScreenProps<T extends keyof ServiceOrdersStackParamList> =
    CompositeScreenProps<
        NativeStackScreenProps<ServiceOrdersStackParamList, T>,
        AppTabScreenProps<'ServiceOrders'>
    >;

/** Props de uma tela do SchedulingStack: combina com o tab + o AppStack pai. */
export type SchedulingStackScreenProps<T extends keyof SchedulingStackParamList> =
    CompositeScreenProps<
        NativeStackScreenProps<SchedulingStackParamList, T>,
        AppTabScreenProps<'Scheduling'>
    >;

/** Props de uma tela do InventoryStack: combina com o tab + o AppStack pai. */
export type InventoryStackScreenProps<T extends keyof InventoryStackParamList> =
    CompositeScreenProps<
        NativeStackScreenProps<InventoryStackParamList, T>,
        AppTabScreenProps<'Inventory'>
    >;

/**
 * Props de uma tela do AdminStack: combina com o AppStack pai.
 *
 * Diferente das stacks de aba, `Admin` é uma rota do AppStack (não de tab), logo
 * o pai é `AppStackScreenProps<'Admin'>` — permite navegar p/ Profile/PhotoViewer.
 */
export type AdminStackScreenProps<T extends keyof AdminStackParamList> = CompositeScreenProps<
    NativeStackScreenProps<AdminStackParamList, T>,
    AppStackScreenProps<'Admin'>
>;
