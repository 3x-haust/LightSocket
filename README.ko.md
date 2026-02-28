# LightSocket

- English version: [README.md](README.md)

LightSocket은 이벤트 이름을 문자열로 직접 다루기보다, 백엔드 이벤트 정의를 기준으로 프론트 SDK를 생성해 사용하는 실시간 라이브러리입니다.

이번 문서에서는 실제 저장소 코드 기준으로, 서버 이벤트 정의부터 SDK 생성, 클라이언트 연결까지 한 번에 구성하는 방법을 설명합니다.

## 설치

```bash
npm install @3xhaust/lightsocket
```

## 핵심 개념

- 서버는 이벤트 핸들러를 파일로 정의합니다.
- `build()` 단계에서 이벤트 목록을 분석해 SDK 파일을 생성합니다.
- 클라이언트는 `sdk.chat.sendMessage()` 같은 함수 형태로 이벤트를 호출합니다.

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

이벤트는 `defineEvents("네임스페이스", handlers)` 형식으로 작성합니다.

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

`build()`는 이벤트를 로드하고 SDK 파일을 생성합니다. 서버 소켓은 `start()`로 시작합니다.

```ts
await ls.build();
ls.start();

httpServer.listen(3000);
```

### 4) 클라이언트 연결 및 SDK 사용

클라이언트는 `createClient()`로 연결하고, 생성된 SDK를 감싸서 사용합니다.

```tsx
import { useMemo } from "react";
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

아래 순서로 실행하면 SDK 생성과 채팅 예제를 바로 확인할 수 있습니다.

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

## API 요약

### 서버 API

- `createLightSocketServer(options)`
  - `httpServer`: WebSocket 서버를 붙일 HTTP 서버
  - `eventsDir`: 이벤트 모듈 디렉터리 (`.js/.mjs/.cjs` 파일 탐색)
  - `namespace`: WebSocket 경로 (기본값 `/`)
  - `auth(token, clientState)`: 인증 훅, falsy 반환 시 연결 거부
  - `sdk.outFile`: 생성할 SDK 파일 경로
- 반환값
  - `build()`: 이벤트 로드 + SDK 파일 생성
  - `start()`: WebSocket 서버 시작
  - `stop()`: WebSocket 서버 종료

### 이벤트 컨텍스트 API

- `ctx.clientId`, `ctx.user`, `ctx.event`
- `ctx.joinRoom(room)`, `ctx.leaveRoom(room)`
- `ctx.emit(event, payload)`
- `ctx.emitToRoom(room, event, payload, { excludeSelf })`
- `ctx.broadcast(event, payload, { excludeSelf })`

### 클라이언트 API

- `createClient(url, options)`
  - `autoReconnect` (기본 `true`)
  - `reconnectInterval` (기본 `1000`)
  - `maxReconnectInterval` (기본 `15000`)
  - `token` (쿼리스트링으로 자동 부착)
- 반환값
  - `emit(event, payload)`
  - `on(event, handler) => unsubscribe`
  - `disconnect()`

## 기존 소켓 사용 방식과 차이

| 항목 | 기존 방식 | LightSocket 방식 |
| --- | --- | --- |
| 이벤트 전송 | `socket.emit("chat.send", payload)` | `sdk.chat.sendMessage(payload)` |
| 이벤트 수신 | `socket.on("chat.message", handler)` | `sdk.chat.onSendMessage(handler)` |
| 계약 동기화 | 문자열/타입 수동 관리 | 백엔드 빌드 결과로 SDK 자동 동기화 |
| 개발 흐름 | 런타임 중심 점검 | 함수 시그니처 중심 개발 |
