import { useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';

/**
 * Office live board via SSE. Falls back silently when the stream cannot open —
 * callers keep their existing poll as a safety net.
 *
 * Events: hello | ping | position | exception | exception_ack | exception_resolved | eta | pod
 */
export function useTelematicsStream({ enabled = true, onEvent } = {}) {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState(null);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return undefined;

    let source;
    let closed = false;
    let retryTimer;

    const open = () => {
      if (closed) return;
      try {
        source = new EventSource(api.telematics.streamUrl());
      } catch {
        setConnected(false);
        retryTimer = setTimeout(open, 8_000);
        return;
      }

      source.onopen = () => setConnected(true);
      source.onerror = () => {
        setConnected(false);
        source.close();
        if (!closed) retryTimer = setTimeout(open, 8_000);
      };

      const forward = (type) => (ev) => {
        let data = null;
        try {
          data = ev.data ? JSON.parse(ev.data) : null;
        } catch {
          data = ev.data;
        }
        const packet = { type, data, at: Date.now() };
        setLastEvent(packet);
        handlerRef.current?.(packet);
      };

      for (const type of [
        'hello', 'ping', 'position', 'exception',
        'exception_ack', 'exception_resolved', 'eta', 'pod',
      ]) {
        source.addEventListener(type, forward(type));
      }
    };

    open();

    return () => {
      closed = true;
      clearTimeout(retryTimer);
      source?.close();
      setConnected(false);
    };
  }, [enabled]);

  return { connected, lastEvent };
}
