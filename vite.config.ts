import { defineConfig } from "vite";

export default defineConfig({
  publicDir: "assets",
  clearScreen: false,
  server: {
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/models/**"] },
  },
  envPrefix: ["VITE_"],
  build: { target: ["es2021", "chrome100", "safari13"] },
});
