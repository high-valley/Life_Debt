# マイルストーン

## M0 縦切りスライス ✅（2026-10 に TypeScript へ移行。テストは `tests/*.test.ts` の20件）
ブラウザ試作で手触りを確認 → Godot 版。全10区画＋ボス、借金・回収人・階級ゲート・ショップ・休憩・報酬、PC/スマホ両対応、CI で Pages と Windows を自動ビルド。

### MVP 受け入れ条件（仕様書 §17）との対応
| # | 条件 | 状態 | 確認 |
|---|---|---|---|
| 1 | 移動・通常攻撃・寿命スキル・ダッシュ | ✅ | 手動 |
| 2 | 寿命が減り、被弾・スキル・購入で追加減少、撃破で増加 | ✅ | test_same_frame_purchase_and_hit, test_drain_only_in_step |
| 3 | 0で敗北、ポーズ中は減らない | ✅ | test_death_once, test_drain_only_in_step |
| 4 | 分岐する部屋、ショップと契約 | ✅ | test_gate_threshold, test_shop_purchase |
| 5 | 借入・満期・返済・不履行の回収人 | ✅ | test_repay_once_on_transition, test_default_collector_settle |
| 6 | 残寿命によるルート分岐1種 | ✅ | test_gate_threshold |
| 7 | ボス撃破で勝利、リザルト・リトライ | ✅ | ボット走行 |
| 8 | 固定seedで主要な分岐を再現 | ✅ | test_seed_reproducible |
| 9 | 寿命管理・契約のエッジケースを単体テスト | ✅ | tests/run_tests.gd（19件） |

### 仕様書 §16 エッジケース
1 死亡1回 ✅ / 2 購入と被弾 ✅ / 3 満期の遷移で1回だけ ✅ / 4 回収と上限 ✅ / 5 UI中は停止 ✅ / 6 返済不能でも逃げ道 ✅ / 7 seed再現 ✅ / 8 死亡と清算の優先順位 ✅（architecture.md）

## M1 手触りの調整（次）
- 仕様書 §19 の問い: 支払う瞬間の悩み / 借金がリスクとして効くか / 0の焦りが理不尽でないか / 返済不能後の復帰 / 経済とアクションの比率
- ボット走行では 5 seed 中すべて勝利、残り 2〜15 分。人の操作ではもっと厳しい想定。

## M2 MVP 仕上げ
- 本番アセット、部屋プリセット追加、設定画面拡充、統計セーブ

## M3 Steam 準備
- Steamworks 登録、GodotSteam（Windows 版のみ）、ストアページ
