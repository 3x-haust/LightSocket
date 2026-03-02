import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WebSocketServer, WebSocket } from "ws";

type JsonObject = Record<string, unknown>;

type IncomingEmitPacket = {
  type: "emit";
  event: string;
  payload?: unknown;
};

type OutgoingEventPacket = {
  type: "event";
  event: string;
  payload?: unknown;
};

export type LightSocketEventMap = Record<string, unknown>;

type EventName<TEvents extends LightSocketEventMap> = Extract<keyof TEvents, string>;

type EventHandler<TUser, TEvents extends LightSocketEventMap> = (
  ctx: LightSocketContext<TUser, TEvents>,
  payload: TEvents[EventName<TEvents>]
) => unknown | Promise<unknown>;

type EventModule<TUser, TEvents extends LightSocketEventMap> = Record<string, EventHandler<TUser, TEvents>>;

export interface LightSocketClientState<TUser = unknown> {
  id: string;
  user: TUser | null;
  token: string | null;
}

export interface LightSocketContext<TUser = unknown, TEvents extends LightSocketEventMap = LightSocketEventMap> {
  clientId: string;
  user: TUser | null;
  event: string;
  joinRoom(room: string): void;
  leaveRoom(room: string): void;
  emit<TKey extends EventName<TEvents>>(event: TKey, payload: TEvents[TKey]): void;
  emit(event: string, payload?: unknown): void;
  emitToRoom<TKey extends EventName<TEvents>>(
    room: string,
    event: TKey,
    payload: TEvents[TKey],
    options?: { excludeSelf?: boolean }
  ): void;
  emitToRoom(room: string, event: string, payload?: unknown, options?: { excludeSelf?: boolean }): void;
  broadcast<TKey extends EventName<TEvents>>(event: TKey, payload: TEvents[TKey], options?: { excludeSelf?: boolean }): void;
  broadcast(event: string, payload?: unknown, options?: { excludeSelf?: boolean }): void;
}

export interface LightSocketServerSdkOptions {
  outFile: string;
  mode?: "esm" | "cjs";
}

export interface LightSocketServerOptions<
  TUser = unknown,
  TAuthResult extends TUser = TUser,
  THttpServer = unknown,
  TEvents extends LightSocketEventMap = LightSocketEventMap,
> {
  httpServer: THttpServer;
  eventsDir: string;
  namespace?: string;
  auth?: (token: string | null, client: LightSocketClientState<TUser>) => TAuthResult | Promise<TAuthResult>;
  sdk?: LightSocketServerSdkOptions;
}

interface ConnectedClient<TUser> {
  state: LightSocketClientState<TUser>;
  ws: WebSocket;
  rooms: Set<string>;
}

export interface LightSocketServer {
  build(): Promise<void>;
  start(): void;
  stop(): Promise<void>;
}

export interface DefinedEventModule<TUser, TEvents extends LightSocketEventMap> {
  __ls_namespace: string;
  handlers: EventModule<TUser, TEvents>;
}

export function defineEvents<TUser = unknown, TEvents extends LightSocketEventMap = LightSocketEventMap>(
  namespace: string,
  handlers: EventModule<TUser, TEvents>
): DefinedEventModule<TUser, TEvents> {
  return {
    __ls_namespace: namespace,
    handlers,
  };
}

export function createLightSocketServer<
  TUser = unknown,
  TAuthResult extends TUser = TUser,
  THttpServer = unknown,
  TEvents extends LightSocketEventMap = LightSocketEventMap,
>(options: LightSocketServerOptions<TUser, TAuthResult, THttpServer, TEvents>): LightSocketServer {
  const namespace = options.namespace ?? "/";
  const clients = new Map<string, ConnectedClient<TUser>>();
  const events = new Map<string, EventHandler<TUser, TEvents>>();
  const eventSpec: Record<string, string[]> = {};
  let wss: WebSocketServer | null = null;
  let started = false;

  async function walk(dirPath: string): Promise<string[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          return walk(fullPath);
        }

        const ext = path.extname(entry.name);
        if ([".js", ".mjs", ".cjs"].includes(ext)) {
          return [fullPath];
        }

        return [];
      })
    );
    return files.flat();
  }

  function toEventMap(mod: unknown): EventModule<TUser, TEvents> {
    const candidate = mod as Partial<DefinedEventModule<TUser, TEvents>> & EventModule<TUser, TEvents>;
    if (candidate && typeof candidate === "object" && typeof candidate.__ls_namespace === "string" && candidate.handlers) {
      const namespaced: EventModule<TUser, TEvents> = {};
      Object.entries(candidate.handlers).forEach(([name, handler]) => {
        if (typeof handler === "function") {
          namespaced[`${candidate.__ls_namespace}.${name}`] = handler;
        }
      });
      return namespaced;
    }

    const plain = mod as EventModule<TUser, TEvents>;
    const mapped: EventModule<TUser, TEvents> = {};
    Object.entries(plain).forEach(([key, handler]) => {
      if (typeof handler === "function") {
        mapped[key] = handler;
      }
    });
    return mapped;
  }

  function bucketByNamespace(eventNames: string[]): Record<string, string[]> {
    const buckets: Record<string, string[]> = {};
    eventNames.forEach((eventName) => {
      const [ns, ...rest] = eventName.split(".");
      if (!ns || rest.length === 0) {
        return;
      }
      if (!buckets[ns]) {
        buckets[ns] = [];
      }
      buckets[ns].push(rest.join("."));
    });
    return buckets;
  }

  async function loadEvents(): Promise<void> {
    events.clear();
    const files = await walk(path.resolve(process.cwd(), options.eventsDir));
    for (const file of files) {
      const url = `${pathToFileURL(file).href}?t=${Date.now()}`;
      const imported = (await import(url)) as { default?: unknown };
      const moduleValue = imported.default ?? imported;
      const eventMap = toEventMap(moduleValue);
      Object.entries(eventMap).forEach(([eventName, handler]) => {
        events.set(eventName, handler);
      });
    }
    const spec = bucketByNamespace(Array.from(events.keys()));
    Object.keys(eventSpec).forEach((key) => delete eventSpec[key]);
    Object.assign(eventSpec, spec);
  }

  async function writeSdk(): Promise<void> {
    if (!options.sdk) {
      return;
    }

    const outPath = path.resolve(process.cwd(), options.sdk.outFile);
    await fs.mkdir(path.dirname(outPath), { recursive: true });

    const namespaces = Object.entries(eventSpec).sort(([a], [b]) => a.localeCompare(b));
    const lines: string[] = [];
    lines.push("export interface LightSocketClient {");
    lines.push("  emit<TPayload>(event: string, payload: TPayload): void;");
    lines.push("  on<TPayload>(event: string, handler: (payload: TPayload) => void): () => void;");
    lines.push("  disconnect(): void;");
    lines.push("}");
    lines.push("");
    lines.push("export function createLightsocketSdk(client: LightSocketClient) {");
    lines.push("  return {");

    namespaces.forEach(([ns, actions], index) => {
      lines.push(`    ${ns}: {`);
      actions.sort().forEach((action) => {
        const sendName = action;
        const onName = `on${action.charAt(0).toUpperCase()}${action.slice(1)}`;
        lines.push(`      ${sendName}(payload: unknown) {`);
        lines.push(`        return client.emit(\"${ns}.${action}\", payload);`);
        lines.push("      },");
        lines.push(`      ${onName}(handler: (payload: unknown) => void) {`);
        lines.push(`        return client.on(\"${ns}.${action}\", handler);`);
        lines.push("      },");
      });
      lines.push(index === namespaces.length - 1 ? "    }" : "    },");
    });

    lines.push("  };\n}");
    await fs.writeFile(outPath, lines.join("\n"), "utf8");
  }

  function sendPacket(client: ConnectedClient<TUser>, packet: OutgoingEventPacket): void {
    if (client.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    client.ws.send(JSON.stringify(packet));
  }

  function emitToRoom(
    sender: ConnectedClient<TUser>,
    room: string,
    event: string,
    payload: unknown,
    optionsArg?: { excludeSelf?: boolean }
  ): void {
    const excludeSelf = optionsArg?.excludeSelf ?? false;
    clients.forEach((target) => {
      if (!target.rooms.has(room)) {
        return;
      }
      if (excludeSelf && target.state.id === sender.state.id) {
        return;
      }
      sendPacket(target, { type: "event", event, payload });
    });
  }

  function broadcast(
    sender: ConnectedClient<TUser>,
    event: string,
    payload: unknown,
    optionsArg?: { excludeSelf?: boolean }
  ): void {
    const excludeSelf = optionsArg?.excludeSelf ?? false;
    clients.forEach((target) => {
      if (excludeSelf && target.state.id === sender.state.id) {
        return;
      }
      sendPacket(target, { type: "event", event, payload });
    });
  }

  async function handleEmit(client: ConnectedClient<TUser>, packet: IncomingEmitPacket): Promise<void> {
    const handler = events.get(packet.event);
    if (!handler) {
      return;
    }
    const ctx: LightSocketContext<TUser, TEvents> = {
      clientId: client.state.id,
      user: client.state.user,
      event: packet.event,
      joinRoom(room: string) {
        client.rooms.add(room);
      },
      leaveRoom(room: string) {
        client.rooms.delete(room);
      },
      emit(event: string, payload?: unknown) {
        sendPacket(client, { type: "event", event, payload });
      },
      emitToRoom(room: string, event: string, payload?: unknown, optionsArg?: { excludeSelf?: boolean }) {
        emitToRoom(client, room, event, payload, optionsArg);
      },
      broadcast(event: string, payload?: unknown, optionsArg?: { excludeSelf?: boolean }) {
        broadcast(client, event, payload, optionsArg);
      },
    };

    await handler(ctx, packet.payload as TEvents[EventName<TEvents>]);
  }

  async function build(): Promise<void> {
    await loadEvents();
    await writeSdk();
  }

  function start(): void {
    if (started) {
      return;
    }
    started = true;

    wss = new WebSocketServer({
      server: options.httpServer,
      path: namespace,
    } as ConstructorParameters<typeof WebSocketServer>[0]);

    wss.on("connection", async (ws, request) => {
      const requestUrl = new URL(request.url ?? namespace, "http://localhost");
      const token = requestUrl.searchParams.get("token");
      const clientState: LightSocketClientState<TUser> = {
        id: crypto.randomUUID(),
        user: null,
        token,
      };

      if (options.auth) {
        const user = await options.auth(token, clientState);
        if (!user) {
          ws.close(1008, "Unauthorized");
          return;
        }
        clientState.user = user;
      }

      const client: ConnectedClient<TUser> = {
        state: clientState,
        ws,
        rooms: new Set(),
      };
      clients.set(client.state.id, client);

      sendPacket(client, {
        type: "event",
        event: "system.connected",
        payload: { clientId: client.state.id, user: client.state.user },
      });

      ws.on("message", async (raw) => {
        try {
          const parsed = JSON.parse(raw.toString()) as JsonObject;
          if (parsed.type !== "emit") {
            return;
          }
          await handleEmit(client, parsed as IncomingEmitPacket);
        } catch {
          return;
        }
      });

      ws.on("close", () => {
        clients.delete(client.state.id);
      });
    });
  }

  async function stop(): Promise<void> {
    if (!wss) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      wss?.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
    wss = null;
    started = false;
  }

  return {
    build,
    start,
    stop,
  };
}