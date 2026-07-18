import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Support both VITE_ and REACT_APP_ env prefixes (guide uses REACT_APP_)
  envPrefix: ["VITE_", "REACT_APP_"],
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: "build",
  },
});
