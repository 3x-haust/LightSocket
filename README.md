# LightSocket

- Korean version: [README.ko.md](README.ko.md)

LightSocket is a real-time library that generates a frontend SDK from backend event definitions, so you don't have to manually manage event strings separately on the server and client.

This guide walks through the actual example in this repository, from server event definitions to SDK generation and client connection.

## Table of Contents

- [LightSocket](#lightsocket)
  - [Table of Contents](#table-of-contents)
  - [Installation](#installation)
  - [Core Idea](#core-idea)
  - [Getting Started](#getting-started)
    - [1) Create the Server](#1-create-the-server)
    - [2) Write an Event Module](#2-write-an-event-module)
    - [3) Generate SDK and Start the Server](#3-generate-sdk-and-start-the-server)
    - [4) Connect the Client and Use SDK](#4-connect-the-client-and-use-sdk)
  - [Run the Example](#run-the-example)
  - [Implementation Comparison](#implementation-comparison)
    - [1) If You Implement with Raw ws](#1-if-you-implement-with-raw-ws)
    - [2) If You Implement with socket.io](#2-if-you-implement-with-socketio)
    - [3) In LightSocket](#3-in-lightsocket)

## Installation

```bash
npm install @3xhaust/lightsocket
```

## Core Idea

- Define event handlers on the server in file-based modules.
- Run `build()` to analyze events and generate an SDK file.
- On the client, call events as functions like `sdk.chat.sendMessage()`.

## Getting Started

### 1) Create the Server

First, create an HTTP server and initialize `createLightSocketServer()`.

```ts
import express from "express";
import http from "node:http";
import { createLightSocketServer } from "@3xhaust/lightsocket/server";

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

### 2) Write an Event Module

Next, write an event module in the format `defineEvents("namespace", handlers)`.

```ts
import { defineEvents } from "@3xhaust/lightsocket/server";

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

### 3) Generate SDK and Start the Server

Now run `build()` to load events and generate the SDK file. Once ready, call `start()` to run the WebSocket server.

```ts
await ls.build();
ls.start();

httpServer.listen(3000);
```

### 4) Connect the Client and Use SDK

Finally, connect with `createClient()` and wrap it with the generated SDK.

```tsx
import { createClient } from "@3xhaust/lightsocket/client";
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

## Run the Example

Follow the steps below to quickly verify SDK generation and the chat example. Start the backend first to generate the SDK, then run the frontend.

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

## Implementation Comparison

Let's look at how the same chat feature differs when implemented with `ws`, `socket.io`, and LightSocket.

### 1) If You Implement with Raw ws

When implementing the same chat send/receive flow with raw `ws`, you need to manually keep event strings and packet formats aligned between server and client.

```ts
// server (ws)
import { WebSocketServer } from "ws";

const wss = new WebSocketServer({ server: httpServer, path: "/realtime" });

wss.on("connection", (ws) => {
	ws.on("message", (raw) => {
		const packet = JSON.parse(raw.toString());
		if (packet.type !== "emit") return;

		if (packet.event === "chat.sendMessage") {
			const message = {
				id: crypto.randomUUID(),
				roomId: packet.payload.roomId,
				text: packet.payload.text,
				sentAt: Date.now(),
			};

			for (const client of wss.clients) {
				if (client.readyState === 1) {
					client.send(JSON.stringify({
						type: "event",
						event: "chat.sendMessage",
						payload: message,
					}));
				}
			}
		}
	});
});
```

```ts
// client (ws)
const ws = new WebSocket("ws://localhost:3000/realtime");

ws.addEventListener("message", (event) => {
	const packet = JSON.parse(String(event.data));
	if (packet.type === "event" && packet.event === "chat.sendMessage") {
		console.log(packet.payload);
	}
});

ws.send(JSON.stringify({
	type: "emit",
	event: "chat.sendMessage",
	payload: { roomId: "room-1", text: "hello" },
}));
```

### 2) If You Implement with socket.io

`socket.io` provides event-based APIs, but event names and payload contracts still need to be managed on both server and client.

```ts
// server (socket.io)
import { Server } from "socket.io";

const io = new Server(httpServer, { path: "/socket.io" });

io.on("connection", (socket) => {
	socket.on("chat.join", ({ roomId }) => {
		socket.join(`room:${roomId}`);
	});

	socket.on("chat.sendMessage", ({ roomId, text }) => {
		if (!text?.trim()) return;

		io.to(`room:${roomId}`).emit("chat.sendMessage", {
			id: crypto.randomUUID(),
			roomId,
			text,
			sender: socket.id,
			sentAt: Date.now(),
		});
	});
});
```

```ts
// client (socket.io)
import { io } from "socket.io-client";

const socket = io("http://localhost:3000", { path: "/socket.io" });

socket.emit("chat.join", { roomId: "room-1" });
socket.emit("chat.sendMessage", { roomId: "room-1", text: "hello" });

socket.on("chat.sendMessage", (payload) => {
	console.log(payload);
});
```

### 3) In LightSocket

In LightSocket, the same behavior is handled through function calls. Since the SDK is generated from event modules, you don't need to manually handle event strings every time.

```ts
// client (LightSocket)
import { createClient } from "@3xhaust/lightsocket/client";
import { createLightsocketSdk } from "./generated/lightsocket-sdk";

const client = createClient("ws://localhost:3000/realtime");
const sdk = createLightsocketSdk(client);

sdk.chat.sendMessage({ roomId: "room-1", text: "hello" });
const unsubscribe = sdk.chat.onSendMessage((payload) => {
	console.log(payload);
});
```
