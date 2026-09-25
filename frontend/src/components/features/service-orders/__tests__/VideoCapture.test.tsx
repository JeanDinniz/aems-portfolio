import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VideoCapture } from '../VideoCapture';
import { uploadService } from '@/services/api/upload.service';

vi.mock('@/services/api/upload.service', () => ({
    uploadService: { uploadVideo: vi.fn() },
}));

function makeFile(name: string, type: string, sizeMB: number): File {
    const file = new File(['x'], name, { type });
    Object.defineProperty(file, 'size', { value: sizeMB * 1024 * 1024 });
    return file;
}

describe('VideoCapture', () => {
    beforeEach(() => vi.clearAllMocks());

    it('rejeita vídeo acima de 50MB e não faz upload', async () => {
        const onChange = vi.fn();
        render(<VideoCapture videoUrl={null} onChange={onChange} />);
        const input = screen.getByLabelText(/selecionar v[ií]deo/i) as HTMLInputElement;

        fireEvent.change(input, { target: { files: [makeFile('big.mp4', 'video/mp4', 51)] } });

        await waitFor(() => expect(screen.getByText(/50 ?mb/i)).toBeInTheDocument());
        expect(uploadService.uploadVideo).not.toHaveBeenCalled();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('faz upload e emite a URL quando o vídeo é válido', async () => {
        (uploadService.uploadVideo as any).mockResolvedValue('http://minio/aems-files/videos/x.mp4');
        const onChange = vi.fn();
        render(<VideoCapture videoUrl={null} onChange={onChange} />);
        const input = screen.getByLabelText(/selecionar v[ií]deo/i) as HTMLInputElement;

        fireEvent.change(input, { target: { files: [makeFile('ok.mp4', 'video/mp4', 10)] } });

        await waitFor(() =>
            expect(onChange).toHaveBeenCalledWith('http://minio/aems-files/videos/x.mp4')
        );
    });
});
