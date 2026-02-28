# LightSocket

- Korean version: [README.ko.md](README.ko.md)

LightSocket is an event-first realtime library. Instead of manually managing event name strings on both sides, you define events on the backend and generate a frontend SDK from that contract.

This guide follows the code in this repository and walks through server setup, event modules, SDK generation, and client usage.

## Installation

```bash
npm install lightsocket
```

## Core idea

- Define event handlers in backend modules.
- Run `build()` to scan events and generate an SDK file.
- Call realtime events as functions, like `sdk.chat.sendMessage()`.

## Getting started

### 1) Create a server

Create an HTTP server and initialize `createLightSocketServer()`.

```ts
import express from "express";
import http from "node:http";
import { createLightSocketServer } from "lightsocket/server";

const app = express();
const httpServer = http.createServer(app);

const ls = createLightSocketServer({
	httpServer,
	eventsDir: new URL("./events", import.meta.url).pathname,
	namespace: "/realtime",
	sdk: {
		outFile: new URL("../frontend/src/generated/lightsocket-sdk.ts", import.meta.url).pathname,
	},
});
```

### 2) Define event modules

Define your namespace and handlers with `defineEvents(namespace, handlers)`.

```ts
import { defineEvents } from "lightsocket/server";

export default defineEvents("chat", {
	join(ctx, payload) {
		const roomId = typeof payload?.roomId === "string" ? payload.roomId : "room-1";
		const roomName = `room:${roomId}`;
		ctx.joinRoom(roomName);
		ctx.emit("chat.join", { roomId, clientId: ctx.clientId });
	},

	sendMessage(ctx, payload) {
		const roomId = typeof payload?.roomId === "string" ? payload.roomId : "room-1";
		const text = typeof payload?.text === "string" ? payload.text : "";
		if (!text.trim()) {
			return;
		}

		ctx.emitToRoom(`room:${roomId}`, "chat.sendMessage", {
			id: crypto.randomUUID(),
			roomId,
			text,
			sender: ctx.clientId,
			sentAt: Date.now(),
		});
	},
});
```

### 3) Build SDK and start server

`build()` loads event modules and writes the SDK file. Then `start()` opens the WebSocket server.

```ts
await ls.build();
ls.start();

httpServer.listen(3000);
```

### 4) Connect client and use SDK

Create a client with `createClient()`, then wrap it with the generated SDK.

```tsx
import { createClient } from "lightsocket/client";
import { createLightsocketSdk } from "./generated/lightsocket-sdk";

const client = createClient("ws://localhost:3000/realtime", {
	autoReconnect: true,
	reconnectInterval: 800,
	maxReconnectInterval: 6000,
});

const sdk = createLightsocketSdk(client);

sdk.chat.sendMessage({ roomId: "room-1", text: "hello", name: "user-a" });
const unsubscribe = sdk.chat.onSendMessage((payload) => {
	console.log(payload);
});

unsubscribe();
client.disconnect();
```

## Run the example

Start backend first (it generates the SDK for frontend), then start frontend.

```bash
cd example/backend
npm install
npm run start
```

```bash
cd example/frontend
npm install
npm run dev
```

## API summary

### Server API

- `createLightSocketServer(options)`
	- `httpServer`: HTTP server instance for WS upgrade
	- `eventsDir`: directory scanned for `.js/.mjs/.cjs` event files
	- `namespace`: WebSocket path (default `/`)
	- `auth(token, clientState)`: auth hook, connection closes if falsy
	- `sdk.outFile`: generated SDK output path
- Return value
	- `build()`: load events + generate SDK
	- `start()`: start WS server
	- `stop()`: stop WS server

### Event context API

- `ctx.clientId`, `ctx.user`, `ctx.event`
- `ctx.joinRoom(room)`, `ctx.leaveRoom(room)`
- `ctx.emit(event, payload)`
- `ctx.emitToRoom(room, event, payload, { excludeSelf })`
- `ctx.broadcast(event, payload, { excludeSelf })`

### Client API

- `createClient(url, options)`
	- `autoReconnect` (default `true`)
	- `reconnectInterval` (default `1000`)
	- `maxReconnectInterval` (default `15000`)
	- `token` (automatically appended as query string)
- Return value
	- `emit(event, payload)`
	- `on(event, handler) => unsubscribe`
	- `disconnect()`

## Difference from traditional socket usage

| Topic | Traditional approach | LightSocket approach |
| --- | --- | --- |
| Emit | `socket.emit("chat.send", payload)` | `sdk.chat.sendMessage(payload)` |
| Subscribe | `socket.on("chat.message", handler)` | `sdk.chat.onSendMessage(handler)` |
| Contract sync | Manual event-string management | Backend build generates SDK |
| Developer flow | Runtime string checks | Function-signature driven flow |
