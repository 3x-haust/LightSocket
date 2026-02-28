import { defineConfig } from "tsup";

export default defineConfig({
  entryPoints: ["./src/index.ts", "./src/server.ts", "./src/client.ts"],
  format: ["cjs", "esm"],
  target: "es2020",
  sourcemap: true,
  clean: true,
  dts: true,
});