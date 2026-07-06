import { render, screen, fireEvent } from '@/test/utils';
import { PaginationControls } from './PaginationControls';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('PaginationControls', () => {
    const defaultProps = {
        currentPage: 1,
        totalPages: 5,
        onPageChange: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders pagination buttons correctly', () => {
        render(<PaginationControls {...defaultProps} />);

        expect(screen.getByRole('navigation')).toBeInTheDocument();
        expect(screen.getByText('1')).toBeInTheDocument();
        expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('calls onPageChange when a page number is clicked', () => {
        render(<PaginationControls {...defaultProps} />);

        fireEvent.click(screen.getByText('2'));
        expect(defaultProps.onPageChange).toHaveBeenCalledWith(2);
    });

    it('calls onPageChange when next button is clicked', () => {
        render(<PaginationControls {...defaultProps} />);

        const nextBtn = screen.getByRole('button', { name: /próxima/i });
        fireEvent.click(nextBtn);
        expect(defaultProps.onPageChange).toHaveBeenCalledWith(2);
    });

    it('disables previous button on first page', () => {
        render(<PaginationControls {...defaultProps} />);

        // "Ir para página anterior" or text "Anterior"
        const prevBtn = screen.getByRole('button', { name: /anterior/i });
        expect(prevBtn).toBeDisabled();
    });

    it('disables next button on last page', () => {
        render(<PaginationControls {...defaultProps} currentPage={5} />);

        const nextBtn = screen.getByRole('button', { name: /próxima/i });
        expect(nextBtn).toBeDisabled();
    });

    it('does not render if totalPages <= 1', () => {
        render(<PaginationControls {...defaultProps} totalPages={1} />);
        expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    });
});
