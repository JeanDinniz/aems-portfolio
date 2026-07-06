import { useEffect, useState } from 'react';

import { wsService, type WsStatus } from '@/services/websocket/websocket.service';

/**
 * Expõe o status atual da conexão WebSocket, reagindo a `onStatusChange`.
 * Portado de frontend/src/hooks/useWsStatus.ts. Opcional na UI (ex.: badge
 * "tempo real" no header), mas útil para diagnóstico.
 */
export function useWsStatus(): WsStatus {
    const [status, setStatus] = useState<WsStatus>(wsService.status);

    useEffect(() => {
        // Sincroniza com o status atual no mount (pode ter mudado antes do efeito).
        setStatus(wsService.status);
        return wsService.onStatusChange(setStatus);
    }, []);

    return status;
}
