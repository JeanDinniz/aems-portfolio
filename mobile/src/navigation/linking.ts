import * as Linking from 'expo-linking';
import type { LinkingOptions } from '@react-navigation/native';

import type { AppStackParamList, AuthStackParamList } from './types';

/**
 * Deep linking. Um único `NavigationContainer` hospeda tanto o AuthStack
 * (deslogado) quanto o AppStack (logado); o React Navigation resolve apenas as
 * rotas presentes na árvore ativa. Por isso o config cobre os dois conjuntos:
 *
 * Deslogado (AuthStack):
 *  - `aems://reset-password?token=...`  → ResetPasswordScreen (AUTH-05)
 *
 * Logado (AppStack → Tabs → ServiceOrders):
 *  - `aems://service-orders/:id`        → ServiceOrderDetail (push)
 *  - `aems://scheduling/:id`            → AppointmentDetail (push)
 *  - `aems://inventory/:id`             → RollDetail (push)
 *
 * Tipamos contra a união dos dois param lists para manter segurança de tipos
 * sem quebrar nenhum dos fluxos.
 */
type DeepLinkParamList = AppStackParamList & AuthStackParamList;

export const linking: LinkingOptions<DeepLinkParamList> = {
    prefixes: [
        Linking.createURL('/'),
        'aems://',
        'https://aems.example.com',
        'https://www.aems.example.com',
    ],
    config: {
        screens: {
            // ── Fluxo deslogado (AuthStack) ──────────────────────────────
            Login: 'login',
            ForgotPassword: 'forgot-password',
            ResetPassword: 'reset-password',

            // ── Fluxo logado (AppStack) ──────────────────────────────────
            Tabs: {
                screens: {
                    ServiceOrders: {
                        screens: {
                            ServiceOrdersList: 'service-orders',
                            ServiceOrderDetail: {
                                path: 'service-orders/:id',
                                // Path params chegam como string; convertemos para number.
                                parse: { id: (value: string) => Number(value) },
                            },
                        },
                    },
                    Scheduling: {
                        screens: {
                            SchedulingList: 'scheduling',
                            AppointmentDetail: {
                                path: 'scheduling/:id',
                                parse: { id: (value: string) => Number(value) },
                            },
                        },
                    },
                    Inventory: {
                        screens: {
                            InventoryRolls: 'inventory',
                            RollDetail: {
                                path: 'inventory/:id',
                                parse: { id: (value: string) => Number(value) },
                            },
                        },
                    },
                },
            },
            Profile: 'profile',
            Notifications: 'notifications',
        },
    },
};
