# pocket-loop

Desktop music in your pocket

スマホのブラウザだけで、ドラムのループを作れるDTMウェブアプリです(開発中)。

## 現在の状態

フェーズ0(技術検証):16ステップのドラムシーケンサーを鳴らし、スマホでの遅延・音切れを確認するための最小プロトタイプです。

## 開発

```
npm install
npm run dev      # 開発サーバー(同じネットワークのスマホからも開けます)
npm run build    # 型チェック + 本番ビルド
```

## 公開

`main` ブランチへのpushで、GitHub Pagesへ自動公開されます(GitHub Actions)。
初回のみ、リポジトリの Settings → Pages → Source を **GitHub Actions** に設定してください。

## 外部通信

実行時の外部通信はありません(解析・CDN・外部フォントなし)。音はWeb Audioで合成しています。

## ライセンス

MIT
