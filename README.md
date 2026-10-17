# Life Debt（仮）

時債都市では、残りの寿命が通貨になる。撃てば減り、奪えば増え、足りなければ未来の自分から借りる。返せなければ、回収人が来る。
**寿命が HP・通貨・スキル燃料・借金の担保を兼ねる**見下ろし型ローグライトの最小縦切りスライス（Godot 4.7 / GDScript）。

- 遊ぶ（Web版・スマホ可）: https://high-valley.github.io/life_debt/
- 仕様: `docs/specs/02_Lifetime_Roguelike_GDD.md`
- 配信方針: GitHub Pages で確認 → 固まったら同じプロジェクトから Windows 版を書き出して Steam へ

## 遊び方

| 操作 | キーボード＋マウス | スマホ（横向き推奨） |
|---|---|---|
| 移動 | WASD | 画面左側をドラッグ |
| 通常弾（無料） | 左クリック長押し | 自動で見えている敵へ |
| 寿命スキル | 右クリック / Q（1・2・3で選択） | 右下の3ボタン |
| ダッシュ | Space | 右下「ダッシュ」 |
| 次の区画へ | 扉に触れる / E | 扉に触れる |
| 契約書 | Tab | 右上「契」 |
| ポーズ | Esc / P | 右上「II」 |

- 残寿命（初期15:00）は戦闘中だけ1秒ごとに減る。被弾・スキル・買い物でも減り、敵の時間片で増える。0で終わり。
- **寿命銀行**で未来の寿命を借りられる（同時2件）。満期の部屋に入った瞬間に自動返済。払えなければ回収人が追ってくる（撃破か差し押さえで清算）。
- 区画5は**階級ゲート**（残寿命300秒以上で高級区画、未満は裏道）。最終区画は時間管理局長戦。局の入口で全契約が満期になる。

## 開発

```bash
godot --headless --path . --import
godot --headless --path . -s res://tests/run_tests.gd
python3 tools/check_glyphs.py
```

`main` に push すると GitHub Actions がテスト → Web版を Pages に公開 → Windows版（.exe）を Artifacts に保存する。

## フォルダ構成

```
data/balance.json   バランス値（数値調整はここだけ）
scripts/
  sim/       TimeLedger（寿命残高API）, DebtBook（契約の状態機械）, RunState（進行）, RoomSim（戦闘）
  input/     InputRouter（キーボード/マウス/タッチ → 意図）
  view/      RoomView（描画）, Sfx
  ui/        Hud, TouchControls, Menus
  autoload/  Settings, Platform
  main.gd    状態機械と配線
tests/       ヘッドレス単体テスト（仕様書のエッジケース）
tools/       フォントのサブセット作成・文字チェック
docs/        設計・判断記録・マイルストーン・仕様書
```

## ライセンス

- フォント: Noto Sans CJK JP（SIL Open Font License 1.1）— `assets/fonts/LICENSE-NotoSansCJK.txt`
