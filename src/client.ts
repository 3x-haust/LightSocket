type IncomingPacket = {
  type: "event";
  event: string;
  payload?: unknown;
};

type OutgoingPacket = {
  type: "emit";
  event: string;
  payload?: unknown;
};

export type LightSocketClientEventMap = Record<string, unknown>;

type EventName<TEvents extends LightSocketClientEventMap> = Extract<keyof TEvents, string>;

type EventHandler<TPayload = unknown> = (payload: TPayload) => void;

export interface LightSocketClient<TEvents extends LightSocketClientEventMap = LightSocketClientEventMap> {
  emit<TKey extends EventName<TEvents>>(event: TKey, payload: TEvents[TKey]): void;
  emit<TPayload>(event: string, payload: TPayload): void;
  on<TKey extends EventName<TEvents>>(event: TKey, handler: EventHandler<TEvents[TKey]>): () => void;
  on<TPayload>(event: string, handler: EventHandler<TPayload>): () => void;
  disconnect(): void;
}

export interface LightSocketClientOptions {
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectInterval?: number;
  token?: string;
  WebSocketImpl?: typeof WebSocket;
}

function appendToken(url: string, token?: string): string {
  if (!token) {
    return url;
  }
  const resolved = new URL(url, typeof window !== "undefined" ? window.location.origin : "http://localhost");
  resolved.searchParams.set("token", token);
  return resolved.toString();
}

export function createClient<TEvents extends LightSocketClientEventMap = LightSocketClientEventMap>(
  url: string,
  options: LightSocketClientOptions = {}
): LightSocketClient<TEvents> {
  const listeners = new Map<string, Set<EventHandler<unknown>>>();
  const queue: OutgoingPacket[] = [];
  const autoReconnect = options.autoReconnect ?? true;
  const reconnectInterval = options.reconnectInterval ?? 1000;
  const maxReconnectInterval = options.maxReconnectInterval ?? 15000;
  const WebSocketCtor = options.WebSocketImpl ?? WebSocket;

  let ws: WebSocket | null = null;
  let manuallyClosed = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function dispatch<TPayload>(event: string, payload: TPayload): void {
    const handlers = listeners.get(event);
    if (!handlers) {
      return;
    }
    handlers.forEach((handler) => handler(payload));
  }

  function flushQueue(): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    while (queue.length > 0) {
      const packet = queue.shift();
      if (!packet) {
        return;
      }
      ws.send(JSON.stringify(packet));
    }
  }

  function scheduleReconnect(): void {
    if (!autoReconnect || manuallyClosed) {
      return;
    }
    const wait = Math.min(maxReconnectInterval, reconnectInterval * 2 ** reconnectAttempt);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      connectSocket();
    }, wait);
  }

  function clearReconnectTimer(): void {
    if (!reconnectTimer) {
      return;
    }
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function connectSocket(): void {
    clearReconnectTimer();
    const fullUrl = appendToken(url, options.token);
    ws = new WebSocketCtor(fullUrl);

    ws.addEventListener("open", () => {
      reconnectAttempt = 0;
      flushQueue();
    });

    ws.addEventListener("message", (event) => {
      try {
        const packet = JSON.parse(String(event.data)) as IncomingPacket;
        if (packet.type !== "event") {
          return;
        }
        dispatch(packet.event, packet.payload);
      } catch {
        return;
      }
    });

    ws.addEventListener("close", () => {
      ws = null;
      scheduleReconnect();
    });
  }

  function emit<TPayload>(event: string, payload: TPayload): void {
    const packet: OutgoingPacket = {
      type: "emit",
      event,
      payload,
    };

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      queue.push(packet);
      return;
    }

    ws.send(JSON.stringify(packet));
  }

  function on<TPayload>(event: string, handler: EventHandler<TPayload>): () => void {
    const existing = listeners.get(event) ?? new Set<EventHandler<unknown>>();
    const wrapped: EventHandler<unknown> = (payload) => {
      handler(payload as TPayload);
    };
    existing.add(wrapped);
    listeners.set(event, existing);

    return () => {
      const target = listeners.get(event);
      if (!target) {
        return;
      }
      target.delete(wrapped);
      if (target.size === 0) {
        listeners.delete(event);
      }
    };
  }

  function disconnect(): void {
    manuallyClosed = true;
    clearReconnectTimer();
    ws?.close();
    ws = null;
  }

  connectSocket();

  return {
    emit,
    on,
    disconnect,
  };
}