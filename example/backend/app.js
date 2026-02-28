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
    mode: "esm",
  },
});

await ls.build();
ls.start();

app.get("/", (_, res) => {
  res.send("LightSocket example backend is running");
});

app.get("/health", (_, res) => {
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  console.log(`HTTP: http://localhost:${PORT}`);
  console.log(`WS: ws://localhost:${PORT}/realtime`);
});