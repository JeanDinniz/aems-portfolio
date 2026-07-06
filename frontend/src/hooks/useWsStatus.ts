import { useEffect, useState } from 'react';
import { wsService, type WsStatus } from '@/services/websocket/websocket.service';

export function useWsStatus(): WsStatus {
  const [status, setStatus] = useState<WsStatus>(wsService.status);

  useEffect(() => {
    return wsService.onStatusChange(setStatus);
  }, []);

  return status;
}
