import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// オフライン動作(PWA)のため、本番ビルドのみサービスワーカーを登録する
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

// ストレージ逼迫時に保存データが消されにくくする(R5対策、ブラウザが許可した場合のみ有効)
navigator.storage?.persist?.().catch(() => {});
