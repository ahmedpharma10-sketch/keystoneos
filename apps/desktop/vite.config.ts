import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri-friendly defaults: fixed port, no auto-open, host on for the WebView.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: false, host: true },
});
