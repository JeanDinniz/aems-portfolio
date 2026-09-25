import { render, waitFor } from '@testing-library/react-native';

import { ReturnOriginPicker } from '@/components/features/ReturnOriginPicker';

/**
 * O.S. de origem do Retorno é ESTRITA por departamento: o picker deve encaminhar
 * o `department` selecionado para a busca e re-buscar quando o departamento muda
 * (mesmo veículo pode ter O.S. finalizadas em departamentos distintos).
 */

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const mockSuggest = jest.fn();
jest.mock('@/services/api/service-orders.service', () => ({
    serviceOrdersService: {
        suggestReturnOrigin: (...args: unknown[]) => mockSuggest(...args),
    },
}));

const baseProps = {
    isReturn: true as const,
    plateOrChassi: 'ABC1D23',
    isValidPlateOrChassi: () => true,
    onChange: () => {},
    storeId: 1,
};

describe('ReturnOriginPicker — filtro por departamento', () => {
    beforeEach(() => {
        mockSuggest.mockReset();
        mockSuggest.mockResolvedValue(null);
    });

    it('encaminha o departamento na busca automática', async () => {
        await render(<ReturnOriginPicker {...baseProps} department="security_film" />);
        await waitFor(() =>
            expect(mockSuggest).toHaveBeenCalledWith('ABC1D23', undefined, 1, 'security_film')
        );
    });

    it('re-busca ao trocar o departamento', async () => {
        const { rerender } = await render(<ReturnOriginPicker {...baseProps} department="film" />);
        await waitFor(() =>
            expect(mockSuggest).toHaveBeenCalledWith('ABC1D23', undefined, 1, 'film')
        );
        rerender(<ReturnOriginPicker {...baseProps} department="security_film" />);
        await waitFor(() =>
            expect(mockSuggest).toHaveBeenCalledWith('ABC1D23', undefined, 1, 'security_film')
        );
    });
});
