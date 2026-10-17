extends SceneTree
## ヘッドレス単体テスト（仕様書 §16「特に重要なエッジケース」を中心に）
##   godot --headless --path . -s res://tests/run_tests.gd

var failures := 0
var passed := 0
var data: DataLoader


func _init() -> void:
	data = DataLoader.load_file()
	var tests := [
		"test_data_valid", "test_data_rejects_broken",
		"test_death_once", "test_same_frame_purchase_and_hit", "test_cap_truncate", "test_pay_cannot_zero",
		"test_repay_once_on_transition", "test_double_enter_ignored", "test_default_collector_settle", "test_seizure_settles",
		"test_collector_steal_reduces_debt", "test_max_two_contracts", "test_boss_forces_due", "test_early_repay",
		"test_gate_threshold", "test_shop_purchase", "test_drain_only_in_step", "test_seed_reproducible",
		"test_ledger_invariant_and_bot_runs",
	]
	for name in tests:
		var before := failures
		call(name)
		if failures == before:
			passed += 1
			print("  ok   ", name)
		else:
			print("  FAIL ", name)
	print("\n%d passed, %d failed" % [passed, tests.size() - passed])
	quit(1 if failures > 0 else 0)


func check(cond: bool, msg: String) -> void:
	if not cond:
		failures += 1
		printerr("    assertion failed: ", msg)


func new_run(seed_value: int = 1) -> RunState:
	return RunState.new(data, seed_value)


func contract(id: String) -> Dictionary:
	for c in data.d.contracts:
		if c.id == id:
			return c
	return {}


# ------------------------------------------------------------------ data
func test_data_valid() -> void:
	check(data.is_valid(), "balance.json に検証エラー: %s" % [data.errors])


func test_data_rejects_broken() -> void:
	var d: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/balance.json"))
	d.contracts[0].repay = 10        # 元本より少ない返済額 = 無限増殖
	d.enemies.debtor.erase("hp")
	d.node_weights["casino"] = 5     # 存在しない区画
	var dl := DataLoader.new()
	dl.setup(d)
	check(dl.errors.size() >= 3, "壊れたデータを3件検出すべき: %s" % [dl.errors])


# ------------------------------------------------------------------ ledger
func test_death_once() -> void:
	var r := new_run()
	r.ledger.time = 5
	r.ledger.change(-10, "hit")
	r.ledger.change(-10, "hit")
	r.ledger.change(50, "drop")
	r.check_death()
	r.check_death()
	var deaths := r.ledger.log.filter(func(l: Dictionary) -> bool: return l.type == "death")
	check(deaths.size() == 1, "死亡は1回だけ")
	check(r.ledger.time == 0.0, "死亡後は増えない")
	check(r.result == "lose", "敗北になる")


func test_same_frame_purchase_and_hit() -> void:
	var r := new_run()
	r.ledger.time = 200
	var item: Dictionary = data.d.shop[0]   # 120秒
	check(r.buy(item, false), "購入できる")
	r.ledger.change(-8, "hit")
	check(is_equal_approx(r.ledger.time, 72.0), "購入と被弾が続いても残高が一致 (%.1f)" % r.ledger.time)
	check(is_equal_approx(r.ledger.spent, 128.0), "支払い総額 128")


func test_cap_truncate() -> void:
	var r := new_run()
	r.ledger.time = 3550
	r.ledger.change(100, "drop")
	check(r.ledger.time == 3600.0 and is_equal_approx(r.ledger.truncated, 50.0), "上限3600で切り捨て")
	check(not r.ledger.notices.is_empty(), "切り捨てを画面に通知する")


func test_pay_cannot_zero() -> void:
	var r := new_run()
	r.ledger.time = 20
	check(not r.ledger.can_pay(20), "残高ちょうどは払えない（0になる）")
	check(r.ledger.can_pay(19), "残高未満なら払える")
	check(not r.buy(data.d.shop[0], false), "120秒の品は買えない")
	check(r.ledger.time == 20.0, "失敗した購入で残高は変わらない")


# ------------------------------------------------------------------ contracts
func test_repay_once_on_transition() -> void:
	var r := new_run()
	r.debt.sign(contract("short"), r.room_index, r.ledger)   # +150 / 2部屋後に170
	var t0 := r.ledger.time
	r.enter_node("shop")
	check(r.debt.contracts[0].state == "active", "1部屋目では満期にならない")
	r.enter_node("rest")
	var t1 := r.ledger.time
	r.debt.process_due(r.room_index, false, r.ledger)
	r.debt.process_due(r.room_index, false, r.ledger)
	check(is_equal_approx(t0 - t1, 170.0), "満期で170秒引き落とし")
	check(r.ledger.time == t1, "同じ部屋で二重に引かれない")
	check(r.ledger.log.filter(func(l: Dictionary) -> bool: return l.type == "repay").size() == 1, "返済ログは1件")


func test_double_enter_ignored() -> void:
	var r := new_run()
	r._transitioning = true
	var notices := r.enter_node("shop")
	check(r.room_index == 0 and notices.is_empty(), "遷移中の再入は無視")


func test_default_collector_settle() -> void:
	var r := new_run(4)
	r.debt.sign(contract("standard"), r.room_index, r.ledger)   # 返済360
	r.ledger.time = 100
	r.enter_node("shop")
	r.enter_node("rest")
	var notices := r.enter_node("battle")
	check(r.debt.contracts[0].state == "defaulted", "払えなければ滞納")
	check(notices.any(func(n: Dictionary) -> bool: return n.kind == "debt"), "滞納を通知")
	check(r.ledger.time > 0.0 and r.result == "", "返済不能でも即死しない（逃げ道が残る）")
	var room := RoomSim.new(r, "battle")
	var col: Array = room.foes.filter(func(f: RoomSim.Foe) -> bool: return f.def.ai == "collector")
	check(col.size() == 1, "回収人は合算で1体")
	col[0].hp = 0
	room.step(RoomSim.STEP, Vector2.ZERO, null, false)
	check(r.debt.contracts[0].state == "settled", "回収人撃破で清算")


func test_seizure_settles() -> void:
	var r := new_run()
	r.debt.sign(contract("short"), 0, r.ledger)
	r.ledger.time = 60
	r.enter_node("shop")
	r.enter_node("battle")
	var c: Dictionary = r.debt.contracts[0]
	check(c.state == "defaulted", "滞納")
	var done := r.debt.seize(c.outstanding + 1)
	check(done and c.state == "settled", "差し押さえで完済したら清算")


func test_collector_steal_reduces_debt() -> void:
	var r := new_run()
	r.debt.sign(contract("short"), 0, r.ledger)
	r.ledger.time = 60
	r.enter_node("shop")
	r.enter_node("battle")
	var room := RoomSim.new(r, "battle")
	var before: float = r.debt.contracts[0].outstanding
	room._hurt_player(15, "collector", true)
	check(is_equal_approx(before - r.debt.contracts[0].outstanding, 15.0), "回収人の取り立ては借金に充当")


func test_max_two_contracts() -> void:
	var r := new_run()
	check(r.debt.sign(contract("short"), 0, r.ledger), "1件目")
	check(r.debt.sign(contract("short"), 0, r.ledger), "2件目")
	check(not r.debt.sign(contract("short"), 0, r.ledger), "3件目は不可")


func test_boss_forces_due() -> void:
	var r := new_run()
	r.debt.sign(contract("large"), 0, r.ledger)   # 4部屋後に650
	r.room_index = 1
	var t0 := r.ledger.time
	r.enter_node("boss")
	check(r.debt.contracts[0].state == "paid" and is_equal_approx(t0 - r.ledger.time, 650.0), "ボスの入口で全契約が満期")


func test_early_repay() -> void:
	var r := new_run()
	r.debt.sign(contract("standard"), 0, r.ledger)
	check(r.debt.repay_early(r.debt.contracts[0], r.ledger), "早期返済できる")
	check(r.debt.total() == 0.0, "借金0")


# ------------------------------------------------------------------ route / shop / clock
func test_gate_threshold() -> void:
	var r := new_run()
	r.room_index = int(data.d.gate_room) - 1
	var ch := r.next_choices()
	check(ch[0].kind == "premium" and ch[0].gate, "区画5で階級ゲート")
	r.ledger.time = 299
	check(not r.gate_open(), "300秒未満は通れない")
	r.ledger.time = 300
	check(r.gate_open(), "300秒以上は通れる")


func test_shop_purchase() -> void:
	var r := new_run()
	var item: Dictionary = data.d.shop[2]   # 最大寿命+300
	var max0 := r.ledger.max_time
	check(r.buy(item, true), "高級区画で購入")
	check(r.ledger.max_time == max0 + 300.0, "上限が上がる")
	check(is_equal_approx(r.ledger.spent, roundf(150 * 0.7)), "3割引")


func test_drain_only_in_step() -> void:
	var r := new_run()
	var room := RoomSim.new(r, "battle")
	var t0 := r.ledger.time
	for i in 60:
		room.step(RoomSim.STEP, Vector2.ZERO, Vector2(1000, 360), false)
	var drop := t0 - r.ledger.time
	check(drop >= 0.99, "戦闘中は1秒で約1秒減る (%.2f)" % drop)
	var t1 := r.ledger.time
	r.next_choices()
	r.roll_rewards()
	check(r.ledger.time == t1, "マップ・報酬選択など step を呼ばない間は減らない")


func test_seed_reproducible() -> void:
	var a := _route_trace(321)
	var b := _route_trace(321)
	var c := _route_trace(322)
	check(a == b, "同じseedで部屋候補・敵構成・報酬が一致")
	check(a != c, "seedが違えば変わる")


func _route_trace(seed_value: int) -> String:
	var r := new_run(seed_value)
	var out: Array = []
	for i in 6:
		var ch := r.next_choices()
		out.append(",".join(ch.map(func(n: Dictionary) -> String: return n.kind)))
		var room := RoomSim.new(r, "battle")
		out.append(str(room.waves))
		out.append(",".join(r.roll_rewards().map(func(x: Dictionary) -> String: return x.id)))
		r.room_index += 1
	return "|".join(out)


# ------------------------------------------------------------------ bot
func test_ledger_invariant_and_bot_runs() -> void:
	var lines := []
	var digest_a := ""
	for seed_value in [42, 42, 7, 1234, 99]:
		var r := new_run(seed_value)
		var room := RoomSim.new(r, "battle")
		r.route.append("battle")
		var guard := 0
		while r.result == "" and guard < 60 * 60 * 25:
			guard += 1
			if room.just_cleared and data.d.nodes[room.kind].get("reward", false):
				r.apply_reward(r.roll_rewards()[0].id)
			if room.at_door():
				var choices := r.next_choices()
				var pick: Dictionary = choices[0]
				if pick.get("gate", false) and not r.gate_open():
					pick = choices[1]
				r.enter_node(pick.kind)
				match pick.kind:
					"shop", "premium":
						if r.ledger.time > 500:
							r.buy(data.d.shop[0], pick.kind == "premium")
					"contract":
						r.debt.sign(contract("standard"), r.room_index, r.ledger)
					"rest":
						r.rest()
				if r.result != "":
					break
				var next_combat: String = pick.kind if data.d.nodes[pick.kind].get("combat", false) else "battle"
				if not data.d.nodes[pick.kind].get("combat", false):
					# 非戦闘区画の後はもう一度マップへ（テストでは次の候補の先頭が戦闘ならそこへ）
					var ch2 := r.next_choices()
					var pk: Dictionary = ch2[0]
					if pk.get("gate", false) and not r.gate_open():
						pk = ch2[1]
					r.enter_node(pk.kind)
					next_combat = pk.kind if data.d.nodes[pk.kind].get("combat", false) else "battle"
				room = RoomSim.new(r, next_combat)
				continue
			var mv := Vector2.ZERO
			var near := room.nearest_foe(room.p.pos)
			if room.cleared:
				var door := Vector2(room.size.x - 10, room.size.y / 2)
				mv = (door - room.p.pos).normalized() if room.los(room.p.pos, door, room.p.r + 2) else (Vector2(0, -1) if room.p.pos.y > 120 else Vector2(1, 0))
			elif near and near.pos.distance_to(room.p.pos) < 200:
				mv = (room.p.pos - near.pos).normalized()
			elif not room.shards.is_empty():
				mv = (room.shards[0].pos - room.p.pos).normalized()
			if near and guard % 90 == 0 and r.ledger.time > 200:
				room.use_skill(0, null)
			room.step(RoomSim.STEP, mv, null, false)
			room.drain_events()
		var inv := absf(float(data.d.time.start) + r.ledger.gained - r.ledger.spent - r.ledger.time) < 0.01
		check(inv, "残高 = 初期 + 獲得 − 支払い (seed %d)" % seed_value)
		var line := "%d:%s room%d t=%ds left=%ds contracts=%d" % [seed_value, r.result if r.result != "" else "timeout", r.room_index, roundi(r.elapsed), roundi(r.ledger.time), r.debt.count]
		if seed_value == 42:
			if digest_a == "":
				digest_a = line
			else:
				check(digest_a == line, "同seed・同入力で同じ結果 (%s / %s)" % [digest_a, line])
		lines.append(line)
		check(r.result != "", "ボットのランが決着する (seed %d)" % seed_value)
	print("    bot: ", lines)
