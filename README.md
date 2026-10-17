# Life Debt（仮）

時債都市では、残りの寿命が通貨になる。撃てば減り、奪えば増え、足りなければ未来の自分から借りる。返せなければ、回収人が来る。
**寿命が HP・通貨・スキル燃料・借金の担保を兼ねる**見下ろし型ローグライトの最小縦切りスライス（TypeScript / Canvas 2D）。

- 遊ぶ（Web版・スマホ可）: https://high-valley.github.io/life_debt/
- 仕様: `docs/specs/02_Lifetime_Roguelike_GDD.md`
- 配信方針: GitHub Pages で確認 → 固まったら同じコードを Electron で包んで Windows 版を作り Steam へ（ADR-012）
- 旧 Godot 版は `godot-legacy` ブランチに保存（iPhone のブラウザで重かったため移行）

## 遊び方

| 操作 | キーボード＋マウス | スマホ（横向き推奨） |
|---|---|---|
| 移動 | WASD | 画面左側をドラッグ（スティックは指に付いてくる） |
| 通常弾（無料） | 左クリック長押し | 自動で見えている敵へ |
| 寿命スキル | 右クリック / Q（1・2・3で選択） | 右下の3ボタン |
| ダッシュ | Space | 右下「ダッシュ」 |
| 次の区画へ | 扉に触れる / E | 扉に触れる |
| 契約書 | Tab | 右上「契」 |
| ポーズ | Esc / P | 右上「II」 |

- 残寿命（初期15:00）は戦闘中だけ1秒ごとに減る。被弾・スキル・買い物でも減り、敵の時間片で増える。0で終わり。
- **寿命銀行**で未来の寿命を借りられる（同時2件）。満期の部屋に入った瞬間に自動返済。払えなければ回収人が追ってくる（撃破か差し押さえで清算）。
- 区画5は**階級ゲート**（残寿命300秒以上で高級区画、未満は裏道）。最終区画は時間管理局長戦。局の入口で全契約が満期になる。

URL の付け足し: `?fps`（FPS表示）、`?lowres`（解像度を半分に）。

## ローカルで動かす

Node.js 22.18 以上が必要。

```bash
npm install
npm run dev        # http://localhost:8000
npm test           # 単体テスト 20件
npm run typecheck
npm run build      # dist/ に書き出し（GitHub Pages に置くもの）
```

`main` に push すると、型チェック → テスト → Web版を Pages に公開（テストが落ちると公開されない）。

## フォルダ構成

```
data/balance.json   バランス値（寿命・敵・契約・店・区画・部屋の地形）。数値調整はここだけ
src/
  sim/              TimeLedger（寿命の唯一の管理者）・DebtBook（借金の状態機械）・RunState（周回と分岐）・RoomSim（戦闘部屋）
  data/             JSON の型と読込時の検証
  core/             乱数（用途別ストリーム）
  input/            InputRouter（キーボード・マウス）・TouchControls（スティック・スキルボタン）
  view/ ui/         部屋の描画・HUD・効果音 / 画面（HTML）・ボタン配置
  main.ts           状態機械・60Hz固定ステップのループ・配線
tests/              単体テスト（CIで実行）
docs/               設計メモ・判断記録（ADR）・マイルストーン・仕様書
```
