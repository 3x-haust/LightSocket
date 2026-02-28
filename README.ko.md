# LightSocket

- English version: [README.md](README.md)

LightSocket은 이벤트 문자열을 서버/클라이언트에서 각각 수동으로 관리하는 대신, 백엔드 이벤트 정의를 기준으로 프론트 SDK를 생성해 사용하는 실시간 라이브러리입니다.

이 문서에서는 저장소에 포함된 실제 예제를 기준으로, 서버 이벤트 정의부터 SDK 생성, 클라이언트 연결까지 순서대로 설명합니다.

## 목차

- [LightSocket](#lightsocket)
  - [목차](#목차)
  - [설치](#설치)
  - [핵심 아이디어](#핵심-아이디어)
  - [시작하기](#시작하기)
    - [1) 서버 생성](#1-서버-생성)
    - [2) 이벤트 모듈 작성](#2-이벤트-모듈-작성)
    - [3) SDK 생성 후 서버 시작](#3-sdk-생성-후-서버-시작)
    - [4) 클라이언트 연결 및 SDK 사용](#4-클라이언트-연결-및-sdk-사용)
  - [예제 실행](#예제-실행)
  - [구현 방식 비교](#구현-방식-비교)
    - [1) 순수 ws로 구현하면](#1-순수-ws로-구현하면)
    - [2) socket.io로 구현하면](#2-socketio로-구현하면)
    - [3) LightSocket에서는](#3-lightsocket에서는)

## 설치

```bash
npm install @3xhaust/lightsocket
```

## 핵심 아이디어

- 서버에서 이벤트 핸들러를 파일 단위로 정의합니다.
- `build()`를 실행하면 이벤트를 분석해 SDK 파일을 생성합니다.
- 클라이언트에서는 `sdk.chat.sendMessage()`처럼 함수 형태로 이벤트를 호출합니다.

## 시작하기

### 1) 서버 생성

먼저 HTTP 서버를 만들고 `createLightSocketServer()`를 초기화합니다.

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

### 2) 이벤트 모듈 작성

다음으로 `defineEvents("네임스페이스", handlers)` 형식으로 이벤트 모듈을 작성합니다.

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

### 3) SDK 생성 후 서버 시작

이제 `build()`로 이벤트를 로드하고 SDK 파일을 생성합니다. 준비가 끝나면 `start()`로 WebSocket 서버를 시작합니다.

```ts
await ls.build();
ls.start();

httpServer.listen(3000);
```

### 4) 클라이언트 연결 및 SDK 사용

마지막으로 `createClient()`로 연결한 뒤, 생성된 SDK를 감싸서 사용합니다.

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

## 예제 실행

아래 순서로 실행하면 SDK 생성과 채팅 예제를 바로 확인할 수 있습니다. 먼저 백엔드를 실행해 SDK를 생성하고, 그다음 프론트엔드를 실행하세요.

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

## 구현 방식 비교

같은 채팅 기능을 구현할 때 `ws`, `socket.io`, LightSocket이 각각 어떻게 달라지는지 순서대로 살펴봅니다.

### 1) 순수 ws로 구현하면

같은 채팅 메시지 전송/수신을 순수 `ws`로 구현하면, 서버와 클라이언트에서 이벤트 문자열과 패킷 형식을 직접 맞춰야 합니다.

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

### 2) socket.io로 구현하면

`socket.io`는 이벤트 송수신 API를 제공하지만, 이벤트 이름과 payload 계약은 여전히 서버/클라이언트에서 함께 관리해야 합니다.

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

### 3) LightSocket에서는

같은 동작을 LightSocket에서는 함수 호출로 처리합니다. 이벤트 모듈을 기준으로 SDK가 생성되므로, 이벤트 문자열을 매번 직접 다루지 않아도 됩니다.

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