import * as React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ToolReceiptsTab } from '../ToolReceiptsTab';
import { useToolCards, useConfirmToolReceipt } from '@/hooks/useMaterialRequests';
import { uploadService } from '@/services/api/upload.service';
import type { ToolCard } from '@/types/materialRequest.types';
import type { Photo } from '@/types/photo.types';

vi.mock('@/hooks/useMaterialRequests', () => ({
    useToolCards: vi.fn(),
    useConfirmToolReceipt: vi.fn(),
}));

vi.mock('@/services/api/upload.service', () => ({
    uploadService: { uploadPhoto: vi.fn() },
}));

// SignaturePad usa react-signature-canvas (canvas real) — mock simples com um botão
// que simula "assinar", expondo getDataUrl via ref como o componente real faz.
vi.mock('@/components/features/epi/SignaturePad', () => ({
    SignaturePad: React.forwardRef(function MockSignaturePad(
        props: { onEmptyChange: (empty: boolean) => void },
        ref: React.Ref<{ clear: () => void; getDataUrl: () => string | null }>
    ) {
        const signedRef = React.useRef(false);
        React.useImperativeHandle(ref, () => ({
            clear: () => {
                signedRef.current = false;
            },
            getDataUrl: () => (signedRef.current ? 'data:image/png;base64,SIGNATURE' : null),
        }));
        return (
            <button
                type="button"
                onClick={() => {
                    signedRef.current = true;
                    props.onEmptyChange(false);
                }}
            >
                Assinar (mock)
            </button>
        );
    }),
}));

// CompactPhotoUploader vem de QuickCreateModal.tsx (componente grande, com muitos
// outros hooks/stores). Mockamos o módulo inteiro para isolar a lógica do
// ToolReceiptsTab (gate de foto por item + payload), sem re-testar a captura de
// câmera/galeria que já é responsabilidade daquele componente.
vi.mock('@/components/features/service-orders/QuickCreateModal', () => ({
    CompactPhotoUploader: ({
        photos,
        onChange,
        label,
    }: {
        photos: Photo[];
        onChange: (photos: Photo[]) => void;
        label?: string;
    }) => (
        <div>
            <span>{label}</span>
            {photos.length === 0 ? (
                <button
                    type="button"
                    onClick={() =>
                        onChange([
                            {
                                id: `photo-${label}`,
                                preview: 'blob:mock',
                                compressed: new Blob(['x'], { type: 'image/jpeg' }),
                                uploaded: false,
                                uploadProgress: 0,
                            },
                        ])
                    }
                >
                    Adicionar foto — {label}
                </button>
            ) : (
                <span>foto-anexada</span>
            )}
        </div>
    ),
}));

vi.mock('@/components/common/PhotoDialog', () => ({
    PhotoDialog: ({ url, open, onClose }: { url: string; open: boolean; onClose: () => void }) =>
        open ? (
            <div role="dialog" data-testid="photo-dialog" data-url={url}>
                <button type="button" onClick={onClose}>
                    Fechar
                </button>
            </div>
        ) : null,
}));

function makeCard(overrides: Partial<ToolCard> = {}): ToolCard {
    return {
        request_id: 1,
        request_date: '2026-08-20',
        store_id: 5,
        store_name: 'Loja Teste',
        employee_id: 10,
        employee_name: 'Fulano',
        items: [
            { id: 100, name: 'Chave de fenda', quantity: 1, notes: null, photo_url: null },
            { id: 101, name: 'Alicate', quantity: 2, notes: null, photo_url: null },
        ],
        status: 'pendente',
        received_at: null,
        signature_base64: null,
        ...overrides,
    };
}

const mockedUseToolCards = vi.mocked(useToolCards);
const mockedUseConfirmToolReceipt = vi.mocked(useConfirmToolReceipt);

describe('ToolReceiptsTab', () => {
    let mutate: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        mutate = vi.fn();
        mockedUseConfirmToolReceipt.mockReturnValue({
            mutate,
            isPending: false,
        } as unknown as ReturnType<typeof useConfirmToolReceipt>);
    });

    it('não habilita "Confirmar recebimento" até assinatura + 1 foto por item', async () => {
        const card = makeCard();
        mockedUseToolCards.mockReturnValue({
            data: { items: [card] },
            isLoading: false,
        } as unknown as ReturnType<typeof useToolCards>);

        render(<ToolReceiptsTab />);

        fireEvent.click(screen.getByRole('button', { name: /registrar recebimento/i }));

        const confirmButton = screen.getByRole('button', { name: /confirmar recebimento/i });
        expect(confirmButton).toBeDisabled();

        // Assina, mas ainda falta foto dos 2 itens
        fireEvent.click(screen.getByRole('button', { name: /assinar \(mock\)/i }));
        expect(confirmButton).toBeDisabled();

        // Foto só do 1º item — ainda falta o 2º
        fireEvent.click(screen.getByRole('button', { name: /adicionar foto — foto — chave de fenda/i }));
        expect(confirmButton).toBeDisabled();

        // Foto do 2º item — agora libera
        fireEvent.click(screen.getByRole('button', { name: /adicionar foto — foto — alicate/i }));
        await waitFor(() => expect(confirmButton).not.toBeDisabled());
    });

    it('envia item_photos (1 por item) + signature_base64 ao confirmar', async () => {
        const card = makeCard();
        mockedUseToolCards.mockReturnValue({
            data: { items: [card] },
            isLoading: false,
        } as unknown as ReturnType<typeof useToolCards>);

        vi.mocked(uploadService.uploadPhoto)
            .mockResolvedValueOnce('http://minio/aems-files/photos/item-100.jpg')
            .mockResolvedValueOnce('http://minio/aems-files/photos/item-101.jpg');

        render(<ToolReceiptsTab />);

        fireEvent.click(screen.getByRole('button', { name: /registrar recebimento/i }));
        fireEvent.click(screen.getByRole('button', { name: /assinar \(mock\)/i }));
        fireEvent.click(screen.getByRole('button', { name: /adicionar foto — foto — chave de fenda/i }));
        fireEvent.click(screen.getByRole('button', { name: /adicionar foto — foto — alicate/i }));

        const confirmButton = await screen.findByRole('button', { name: /confirmar recebimento/i });
        await waitFor(() => expect(confirmButton).not.toBeDisabled());
        fireEvent.click(confirmButton);

        await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
        const [payload] = mutate.mock.calls[0];
        expect(payload).toMatchObject({
            request_id: 1,
            employee_id: 10,
            signature_base64: 'data:image/png;base64,SIGNATURE',
        });
        expect(payload.item_photos).toEqual(
            expect.arrayContaining([
                { item_id: 100, photo_url: 'http://minio/aems-files/photos/item-100.jpg' },
                { item_id: 101, photo_url: 'http://minio/aems-files/photos/item-101.jpg' },
            ])
        );
        expect(payload.item_photos).toHaveLength(2);
    });

    it('exibe foto de item e assinatura para cards já recebidos', () => {
        const card = makeCard({
            status: 'recebido',
            received_at: '2026-08-21T10:00:00Z',
            signature_base64: 'data:image/png;base64,ASSINATURA',
            items: [
                {
                    id: 100,
                    name: 'Chave de fenda',
                    quantity: 1,
                    notes: null,
                    photo_url: 'http://minio/aems-files/photos/item-100.jpg',
                },
            ],
        });
        mockedUseToolCards.mockReturnValue({
            data: { items: [card] },
            isLoading: false,
        } as unknown as ReturnType<typeof useToolCards>);

        render(<ToolReceiptsTab />);

        expect(screen.queryByRole('button', { name: /registrar recebimento/i })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /foto/i }));
        expect(screen.getByTestId('photo-dialog')).toHaveAttribute(
            'data-url',
            'http://minio/aems-files/photos/item-100.jpg'
        );
        fireEvent.click(screen.getByRole('button', { name: /fechar/i }));

        fireEvent.click(screen.getByRole('button', { name: /ver assinatura/i }));
        expect(screen.getByTestId('photo-dialog')).toHaveAttribute(
            'data-url',
            'data:image/png;base64,ASSINATURA'
        );
    });
});
