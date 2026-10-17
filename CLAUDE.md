# Life Debt — Claude Code 向け引き継ぎメモ

このファイルは Claude Code が最初に読む。作業前に必ず目を通すこと。

## プロジェクト
- 寿命が「HP・通貨・スキル燃料・借金の担保」を兼ねる見下ろし型ローグライト。
- 仕様書: `docs/specs/02_Lifetime_Roguelike_GDD.md`（MVP要件・エッジケース）、`docs/specs/03_Claude_Code_Architecture_Prompt.md`
- 配信方針: GitHub Pages（Web版・スマホでも確認）→ 固まったら同じプロジェクトから Windows 版を書き出して Steam へ。
- 姉妹作: `high-valley/demon_swarm`（同じ構成・同じCI）。共通化はアイデアにとどめ、コードは各リポジトリで独立させる。
- オーナーとのやり取りは**日本語**。報告は「何ができたか / 残っていること / 次にお願いしたいこと」を短く。

## 現在地（2026-10 時点）
- M0 縦切りスライス完了（`docs/milestones.md` に受け入れ条件との対応表）。
- 公開URL: https://high-valley.github.io/life_debt/
- 経緯: 単一HTMLのブラウザ試作で手触りを確認（オーナー評価「いい感じ」）→ 同じ数値で Godot 版を作成。
- 次は M1（手触り調整）。仕様書 §19「初回プレイテストの問い」への答えを集め、数値は `data/balance.json` だけで調整する。

## 技術スタック
- Godot **4.7.2-stable** / GDScript、Compatibility レンダラー、Web はスレッドなし書き出し（理由は `docs/decisions.md`）

## よく使うコマンド
```bash
godot --headless --path . --import
godot --headless --path . -s res://tests/run_tests.gd      # 単体テスト（失敗で終了コード1）
python3 tools/check_glyphs.py                              # フォントに無い文字を検出
python3 tools/subset_font.py /path/to/NotoSansCJK-Regular.ttc   # 日本語フォント再生成
godot --path . -- --shot=out.png --play --touch --frames=400 [--screen=map|contract|shop]
```

## 設計のルール（崩さないこと）
- **寿命の増減はすべて `TimeLedger.change()` を通す。** 直接 `time` を書き換えない。支払いは `can_pay()`（残高が0にならない時だけ true）で判定。死亡は1回だけ確定する。
- **借金は `DebtBook` の状態機械**（active → paid / defaulted → settled）。返済判定は `RunState.enter_node()` の中で部屋遷移時に1回だけ。ボス部屋の入口では全契約を満期にする。
- **1ティックの処理順**は `RoomSim.step()` の冒頭コメントのとおり（撃破・清算 → 敵の攻撃 → 回収 → 時計）。同フレームの競合はこの順で解決する。順番を変える時はテストも直す。
- 戦闘部屋（`State.ROOM`）以外ではシミュレーションを進めない ＝ ショップ・契約・マップ・ポーズ・契約書の間は時計が止まる。
- 乱数は `RngStreams` の用途別ストリーム（map / enemy / reward / misc）。新しい用途で既存ストリームを使うと seed 再現性が壊れる。
- 入力は `InputRouter` のシグナル経由。タッチは `TouchControls` が同じシグナルへ変換（通常弾はオートエイム・自動射撃）。
- バランス値は `data/balance.json`。項目を足したら `DataLoader.validate()` にも検証を足す。
- 全画面の Control は `set_anchors_and_offsets_preset(PRESET_FULL_RECT)`。
- UIに記号や第2水準漢字を足したら `tools/check_glyphs.py` で確認（CIでも実行され、足りないと公開が止まる）。絵文字系の記号（⚔ ☠ など）はフォントに無いので使わない。

## CI / 公開
- `main` に push → glyph check → テスト → Web版を Pages に公開 → Windows版を Artifacts に保存。
- Godot を上げる時は `project.godot` と workflow の `GODOT_VERSION` / `GODOT_RELEASE` を同時に変える。

## 未実装・今後
- 仮アセット → 本番素材、効果音
- 部屋プリセットの追加（現在10種）、敵の種類追加
- 統計・アンロックのセーブ、ラン中断セーブ（MVP外）
- Steam 連携は `scripts/autoload/platform.gd` の `steam_available()` を入口に（Web版では読み込まない）
