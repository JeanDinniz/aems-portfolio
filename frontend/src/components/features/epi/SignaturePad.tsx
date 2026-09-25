import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import SignatureCanvas from 'react-signature-canvas';

import { Button } from '@/components/ui/button';

export interface SignaturePadHandle {
    clear: () => void;
    getDataUrl: () => string | null;
}

interface Props {
    onEmptyChange: (isEmpty: boolean) => void;
}

export const SignaturePad = forwardRef<SignaturePadHandle, Props>(function SignaturePad(
    { onEmptyChange },
    ref,
) {
    const padRef = useRef<SignatureCanvas | null>(null);
    const [empty, setEmpty] = useState(true);

    const updateEmpty = () => {
        const isEmpty = padRef.current?.isEmpty() ?? true;
        setEmpty(isEmpty);
        onEmptyChange(isEmpty);
    };

    useImperativeHandle(ref, () => ({
        clear: () => {
            padRef.current?.clear();
            updateEmpty();
        },
        getDataUrl: () => {
            const pad = padRef.current;
            if (!pad || pad.isEmpty()) return null;
            return pad.getCanvas().toDataURL('image/png');
        },
    }));

    const handleClear = () => {
        padRef.current?.clear();
        updateEmpty();
    };

    return (
        <div className="space-y-2">
            <div className="rounded-md border bg-white">
                <SignatureCanvas
                    ref={padRef}
                    onEnd={updateEmpty}
                    penColor="#111827"
                    canvasProps={{ className: 'w-full h-48 touch-none rounded-md' }}
                />
            </div>
            <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                    {empty ? 'Assine no quadro acima' : 'Assinatura capturada'}
                </span>
                <Button type="button" variant="outline" size="sm" onClick={handleClear}>
                    Limpar
                </Button>
            </div>
        </div>
    );
});
