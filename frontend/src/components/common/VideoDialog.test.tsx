import { render, screen } from '@/test/utils';
import { VideoDialog } from './VideoDialog';
import { describe, it, expect, vi } from 'vitest';

describe('VideoDialog', () => {
    it('renderiza o vídeo com a URL informada quando aberto', () => {
        render(
            <VideoDialog url="http://minio/aems-files/videos/x.mp4" open onClose={vi.fn()} />
        );

        const video = document.querySelector('video');
        expect(video).toBeInTheDocument();
        expect(video).toHaveAttribute('src', 'http://minio/aems-files/videos/x.mp4');
        expect(video).toHaveAttribute('controls');
    });

    it('exibe a legenda quando informada', () => {
        render(
            <VideoDialog
                url="http://minio/aems-files/videos/x.mp4"
                open
                onClose={vi.fn()}
                caption="ABC1D23 · OS 8891"
            />
        );

        expect(screen.getByText('ABC1D23 · OS 8891')).toBeInTheDocument();
    });

    it('não renderiza conteúdo quando fechado', () => {
        render(
            <VideoDialog url="http://minio/aems-files/videos/x.mp4" open={false} onClose={vi.fn()} />
        );

        expect(document.querySelector('video')).not.toBeInTheDocument();
    });
});
