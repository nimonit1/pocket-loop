import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages(サブパス配信)でも動くよう、相対パスで出力する
export default defineConfig({
  base: "./",
  plugins: [react()],
});
