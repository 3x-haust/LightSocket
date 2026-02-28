export interface LightSocketClient {
  emit<TPayload>(event: string, payload: TPayload): void;
  on<TPayload>(event: string, handler: (payload: TPayload) => void): () => void;
  disconnect(): void;
}

export function createLightsocketSdk(client: LightSocketClient) {
  return {
    system: {
      onConnected(handler: (payload: unknown) => void) {
        return client.on("system.connected", handler);
      },
    },
    chat: {
      join(payload: unknown) {
        return client.emit("chat.join", payload);
      },
      onJoin(handler: (payload: unknown) => void) {
        return client.on("chat.join", handler);
      },
      onRoomState(handler: (payload: unknown) => void) {
        return client.on("chat.roomState", handler);
      },
      sendMessage(payload: unknown) {
        return client.emit("chat.sendMessage", payload);
      },
      onSendMessage(handler: (payload: unknown) => void) {
        return client.on("chat.sendMessage", handler);
      },
      typing(payload: unknown) {
        return client.emit("chat.typing", payload);
      },
      onTyping(handler: (payload: unknown) => void) {
        return client.on("chat.typing", handler);
      },
    }
  };
}