import { render, fireEvent, act } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToolPendingTab } from '@/screens/epi/ToolPendingTab';
import { ToolReceivedTab } from '@/screens/epi/ToolReceivedTab';
import { ThemeProvider } from '@/theme';
import type { ToolCard, ToolReceiptConfirmPayload } from '@/types/materialRequest.types';

/**
 * Fase B — Recebimento de ferramentas com foto por item (Controle de EPIs).
 *
 * Cobre:
 *  - ToolPendingTab: o gate bloqueia confirmar sem 1 foto em TODOS os itens;
 *    quando todas as fotos estão prontas, monta `item_photos` corretamente e
 *    poda a fila (pruneUploaded).
 *  - ToolReceivedTab: "Ver comprovante" navega ao PhotoViewer com as fotos dos
 *    itens (resolvidas) + a assinatura ao final.
 */

// ─── Hooks de dados ──────────────────────────────────────────────────────────
let mockPendingCards: ToolCard[] = [];
let mockReceivedCards: ToolCard[] = [];
const mockConfirmMutate = jest.fn(
    (_payload: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.()
);
let mockConfirmPending = false;
jest.mock('@/hooks/useMaterialRequests', () => ({
    useToolCards: (params?: { status?: string }) => ({
        data: { items: params?.status === 'recebido' ? mockReceivedCards : mockPendingCards },
        isLoading: false,
        isError: false,
        refetch: jest.fn(),
        isRefetching: false,
    }),
    useConfirmToolReceipt: () => ({ mutate: mockConfirmMutate, isPending: mockConfirmPending }),
}));

// ─── Fila de upload ──────────────────────────────────────────────────────────
const mockPrune = jest.fn();
jest.mock('@/services/upload/uploadQueue', () => ({
    pruneUploaded: (...args: unknown[]) => mockPrune(...args),
}));

// ─── resolveMediaUrl ─────────────────────────────────────────────────────────
jest.mock('@/lib/resolveMediaUrl', () => ({
    resolveMediaUrl: (u?: string | null) => (u ? `resolved:${u}` : ''),
}));

// ─── Toast ───────────────────────────────────────────────────────────────────
const mockToastError = jest.fn();
const mockToastShow = jest.fn();
jest.mock('@/components/ui/Toast', () => {
    const actual = jest.requireActual('@/components/ui/Toast');
    return {
        ...actual,
        useToast: () => ({
            success: jest.fn(),
            error: mockToastError,
            show: mockToastShow,
            info: jest.fn(),
        }),
    };
});

// ─── PhotoCapture (test-double) ──────────────────────────────────────────────
// Um botão por instância; injeta 1 foto JÁ enviada (com url) derivada do
// osDraftId, para que o gate enxergue a foto pronta.
jest.mock('@/components/features/PhotoCapture', () => {
    const React = require('react');
    const { Pressable, Text } = require('react-native');
    return {
        __esModule: true,
        PhotoCapture: ({
            osDraftId,
            onChange,
        }: {
            osDraftId?: string;
            onChange: (v: unknown) => void;
        }) =>
            React.createElement(
                Pressable,
                {
                    accessibilityLabel: `add-photo:${osDraftId}`,
                    onPress: () =>
                        onChange([
                            {
                                id: `ph-${osDraftId}`,
                                url: `https://srv/${osDraftId}.jpg`,
                                uploaded: true,
                                uploadProgress: 100,
                                preview: '',
                            },
                        ]),
                },
                React.createElement(Text, null, `add-photo:${osDraftId}`)
            ),
    };
});

// ─── SignaturePad (test-double) ──────────────────────────────────────────────
jest.mock('@/components/features/epi/SignaturePad', () => {
    const React = require('react');
    const { Pressable, Text } = require('react-native');
    const SignaturePad = React.forwardRef(
        (props: { onEmptyChange?: (e: boolean) => void }, ref: React.Ref<unknown>) => {
            React.useImperativeHandle(ref, () => ({
                getDataUrl: () => 'data:image/png;base64,SIG',
                clear: jest.fn(),
                isEmpty: () => false,
            }));
            return React.createElement(
                Pressable,
                { accessibilityLabel: 'sign', onPress: () => props.onEmptyChange?.(false) },
                React.createElement(Text, null, 'sign')
            );
        }
    );
    SignaturePad.displayName = 'SignaturePad';
    return { __esModule: true, SignaturePad };
});

// ─── Providers ───────────────────────────────────────────────────────────────
const metrics = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
function Providers({ children }: { children: ReactNode }) {
    return (
        <SafeAreaProvider initialMetrics={metrics}>
            <ThemeProvider>{children}</ThemeProvider>
        </SafeAreaProvider>
    );
}

function makeCard(over: Partial<ToolCard> = {}): ToolCard {
    return {
        request_id: 5,
        request_date: '2026-08-20',
        store_id: 1,
        store_name: 'Loja Centro',
        employee_id: 7,
        employee_name: 'Ana Silva',
        items: [
            { id: 11, name: 'Furadeira', quantity: 1, notes: null, photo_url: null },
            { id: 12, name: 'Luvas', quantity: 2, notes: null, photo_url: null },
        ],
        status: 'pendente',
        received_at: null,
        signature_base64: null,
        ...over,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockPendingCards = [];
    mockReceivedCards = [];
    mockConfirmPending = false;
});

describe('ToolPendingTab — gate de foto por item', () => {
    it('bloqueia confirmar sem 1 foto em TODOS os itens', async () => {
        mockPendingCards = [makeCard()];
        const { getByRole, getByLabelText } = await render(
            <Providers>
                <ToolPendingTab />
            </Providers>
        );

        await act(async () => {
            fireEvent.press(getByRole('button', { name: 'Registrar recebimento' }));
        });
        // Assina + foto só no primeiro item (o segundo fica sem foto).
        await act(async () => {
            fireEvent.press(getByLabelText('sign'));
            fireEvent.press(getByLabelText('add-photo:tr-5-7-11'));
        });

        // Botão continua desabilitado → confirmar não dispara a mutation.
        await act(async () => {
            fireEvent.press(getByRole('button', { name: 'Confirmar recebimento' }));
        });
        expect(mockConfirmMutate).not.toHaveBeenCalled();
    });

    it('monta item_photos e poda a fila quando há foto em todos os itens', async () => {
        mockPendingCards = [makeCard()];
        const { getByRole, getByLabelText } = await render(
            <Providers>
                <ToolPendingTab />
            </Providers>
        );

        await act(async () => {
            fireEvent.press(getByRole('button', { name: 'Registrar recebimento' }));
        });
        await act(async () => {
            fireEvent.press(getByLabelText('sign'));
            fireEvent.press(getByLabelText('add-photo:tr-5-7-11'));
            fireEvent.press(getByLabelText('add-photo:tr-5-7-12'));
        });
        await act(async () => {
            fireEvent.press(getByRole('button', { name: 'Confirmar recebimento' }));
        });

        expect(mockConfirmMutate).toHaveBeenCalledTimes(1);
        const payload = mockConfirmMutate.mock.calls[0][0] as ToolReceiptConfirmPayload;
        expect(payload.request_id).toBe(5);
        expect(payload.employee_id).toBe(7);
        expect(payload.signature_base64).toBe('data:image/png;base64,SIG');
        expect(payload.item_photos).toEqual([
            { item_id: 11, photo_url: 'https://srv/tr-5-7-11.jpg' },
            { item_id: 12, photo_url: 'https://srv/tr-5-7-12.jpg' },
        ]);
        // onSuccess (do mock) poda os itens consumidos da fila.
        expect(mockPrune).toHaveBeenCalledWith(['ph-tr-5-7-11', 'ph-tr-5-7-12']);
    });
});

describe('ToolReceivedTab — comprovante', () => {
    it('navega ao PhotoViewer com as fotos dos itens + assinatura', async () => {
        mockReceivedCards = [
            makeCard({
                status: 'recebido',
                received_at: '2026-08-21T10:00:00',
                signature_base64: 'data:image/png;base64,SIG',
                items: [
                    { id: 11, name: 'Furadeira', quantity: 1, notes: null, photo_url: 'a.jpg' },
                    { id: 12, name: 'Luvas', quantity: 2, notes: null, photo_url: 'b.jpg' },
                ],
            }),
        ];
        const navigation = { navigate: jest.fn(), goBack: jest.fn() };
        const { getByRole } = await render(
            <Providers>
                <ToolReceivedTab navigation={navigation as never} />
            </Providers>
        );

        await act(async () => {
            fireEvent.press(getByRole('button', { name: 'Ver comprovante' }));
        });

        expect(navigation.navigate).toHaveBeenCalledWith('PhotoViewer', {
            photos: ['resolved:a.jpg', 'resolved:b.jpg', 'data:image/png;base64,SIG'],
            title: 'Ana Silva',
        });
    });
});
