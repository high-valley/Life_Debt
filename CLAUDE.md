# Life Debt — Claude Code 向け引き継ぎメモ

このファイルは Claude Code が最初に読む。作業前に必ず目を通すこと。

## プロジェクト
- 寿命が「HP・通貨・スキル燃料・借金の担保」を兼ねる見下ろし型ローグライト。
- 仕様書: `docs/specs/02_Lifetime_Roguelike_GDD.md`（MVP要件・エッジケース）、`docs/specs/03_Claude_Code_Architecture_Prompt.md`
- 配信方針: GitHub Pages（Web版・スマホでも確認）→ 固まったら同じコードを Electron で包んで Windows 版を作り Steam へ。
- 姉妹作: `high-valley/demon_swarm`, `high-valley/death_legacy`（同じ構成・同じCI）。共通化はアイデアにとどめ、コードは各リポジトリで独立させる。
- オーナーとのやり取りは**日本語**。報告は「何ができたか / 残っていること / 次にお願いしたいこと」を短く。専門用語はかみ砕く。

## 現在地（2026-10 時点）
- M0 縦切りスライス完了（`docs/milestones.md` に受け入れ条件との対応表）。
- 公開URL: https://high-valley.github.io/Life_Debt/
- 経緯: 単一HTMLの試作（オーナー評価「いい感じ」）→ Godot 版 → **iPhone のブラウザで重く遊べなかったため TypeScript（Canvas 2D）へ移行**（ADR-012）。Godot 版は `godot-legacy` ブランチ。
- 次は M1（手触り調整）。仕様書 §19「初回プレイテストの問い」への答えを集め、数値は `data/balance.json` だけで調整する。

## よく使うコマンド
```bash
npm install            # 初回（この作業環境では npm に繋がらないので、ln -s /opt/npm-tools/node_modules node_modules で代用できる）
npm test               # 単体テスト 20件（Node 22.18+ が TypeScript をそのまま実行）
npm run typecheck
npm run build          # dist/ に書き出し
npm run dev            # http://localhost:8000
```
画面確認は Playwright（`/opt/pw-browsers/chromium`）で dist/ を開き、`globalThis.__ld`（Game）から状態を読める。URL: `?fps` `?lowres`。

## 設計のルール（崩さないこと）
- **寿命の増減はすべて `TimeLedger.change()` を通す。** 直接 `time` を書き換えない。支払いは `canPay()`（残高が0にならない時だけ true）で判定。死亡は1回だけ確定する。
- **借金は `DebtBook` の状態機械**（active → paid / defaulted → settled）。返済判定は `RunState.enterNode()` の中で部屋遷移時に1回だけ。ボス部屋の入口では全契約を満期にする。
- **1ティックの処理順**は `RoomSim.step()` の冒頭コメントのとおり（撃破・清算 → 敵の攻撃 → 回収 → 時計）。同フレームの競合はこの順で解決する。順番を変える時はテストも直す。
- 戦闘部屋（state `room`）以外ではシミュレーションを進めない ＝ ショップ・契約・マップ・ポーズ・契約書の間は時計が止まる。
- `src/sim` は DOM・描画・入力に依存しない。乱数は `RngStreams` の用途別ストリーム（map / enemy / reward / misc）。新しい用途で既存ストリームを使うと seed 再現性が壊れる。`Math.random` は描画の揺れ以外で使わない。
- 入力は `InputRouter` / `TouchControls` 経由（スマホの通常弾はオートエイム・自動射撃）。ボタン位置は `src/ui/hudLayout.ts` の1か所。
- バランス値は `data/balance.json`。項目を足したら `src/data/types.ts` と `loadBalance()` の検証にも足す。
- TypeScript は「型を消すだけで動く」書き方にする（`enum`・引数プロパティ禁止、import は `.ts` 付き）。

## CI / 公開
- `main` に push → 型チェック → テスト → Web版を Pages に公開。テストが落ちると公開されない。

## 未実装・今後
- 仮アセット → 本番素材、効果音
- 部屋プリセットの追加（現在10種）、敵の種類追加
- 統計・アンロックのセーブ、ラン中断セーブ（MVP外）
- Steam 版（Electron＋Steamworks）。入口は `src/platform.ts` の `steamAvailable()`
