class_name RunState
extends RefCounted
## 1周分の状態と、部屋をまたぐ進行ルール（分岐・遷移・ショップ・報酬）。
## 部屋遷移の順序: ①部屋番号を進める ②満期処理（1回だけ） ③次の区画を開く
## 死亡は TimeLedger が1回だけ確定させ、遷移中に二重に処理されることはない。

var data: DataLoader
var D: Dictionary
var seed_value: int
var rng: RngStreams
var ledger: TimeLedger
var debt := DebtBook.new()
var room_index := 0
var route: Array = []
var mods: Dictionary = {}
var elapsed := 0.0           # 戦闘中だけ進むゲーム内時間
var result := ""             # "" / "win" / "lose"
var reason := ""
var premium_rested := false
var _transitioning := false


func _init(p_data: DataLoader, p_seed: int) -> void:
	data = p_data
	D = data.d
	seed_value = p_seed
	rng = RngStreams.new(p_seed)
	ledger = TimeLedger.new(float(D.time.start), float(D.time.max))
	debt.max_open = int(D.max_contracts)
	debt.seize_rate = float(D.seize_rate)


# ---------------------------------------------------------------- stats
func mod(id: String) -> int:
	return int(mods.get(id, 0))


func atk_mul() -> float:
	return 1.0 + 0.15 * mod("atk")


func gain_mul() -> float:
	return 1.0 + 0.2 * mod("shop_gain") + 0.1 * mod("gain")


func pickup_radius() -> float:
	return float(D.player.pickup_radius) * (1.0 + 0.2 * mod("pickup"))


func skill_cost(i: int) -> int:
	return ceili(float(D.skills[i].cost) * maxf(0.5, 1.0 - 0.1 * mod("skillcost")))


func shot_interval() -> float:
	return float(D.player.shot_interval) / (1.0 + 0.15 * mod("firerate"))


func move_speed() -> float:
	return float(D.player.speed) * (1.0 + 0.1 * mod("speed"))


func collector_mul() -> float:
	return 1.0 + 0.3 * mod("collector")


func area() -> int:
	return mini(3, room_index / 3 + 1)


func check_death() -> void:
	if ledger.dead and result == "":
		result = "lose"
		reason = {"drain": "時計が止まった", "hit": "被弾で寿命が尽きた", "collector": "回収人に寿命を取り立てられた", "boss": "時間管理局長に時間を奪われた"}.get(ledger.death_reason, "寿命が尽きた")


func win() -> void:
	if result == "":
		result = "win"
		reason = "時間管理局長を倒し、都市の時計を止めた"
		ledger.log.append({"t": ledger.clock, "room": room_index, "type": "win"})


# ---------------------------------------------------------------- route
func next_choices() -> Array:
	var idx := room_index + 1
	if idx >= int(D.rooms_total):
		return [{"kind": "boss"}]
	if idx == int(D.gate_room):
		return [{"kind": "premium", "gate": true}, {"kind": "alley"}]
	var n := 3 if rng.map.randf() < 0.45 else 2
	var out: Array = []
	var weights: Dictionary = D.node_weights
	var total := 0.0
	for k in weights:
		total += float(weights[k])
	var guard := 0
	while out.size() < n and guard < 100:
		guard += 1
		var r := rng.map.randf() * total
		var pick := ""
		for k in weights:
			r -= float(weights[k])
			pick = k
			if r <= 0.0:
				break
		if out.any(func(o: Dictionary) -> bool: return o.kind == pick):
			continue
		out.append({"kind": pick})
	if not out.any(func(o: Dictionary) -> bool: return D.nodes[o.kind].get("combat", false)):
		out[0] = {"kind": "battle"}
	return out


func gate_open() -> bool:
	return ledger.time >= float(D.time.gate_threshold)


## 部屋遷移。満期処理の結果（通知）を返す。二重呼び出しは無視する。
func enter_node(kind: String) -> Array:
	if _transitioning or result != "":
		return []
	_transitioning = true
	room_index += 1
	ledger.room = room_index
	route.append(kind)
	var notices := debt.process_due(room_index, kind == "boss", ledger)
	ledger.log.append({"t": ledger.clock, "room": room_index, "type": "enter", "kind": kind})
	_transitioning = false
	check_death()
	return notices


# ---------------------------------------------------------------- shop / rest / reward
func shop_price(item: Dictionary, premium: bool) -> int:
	return roundi(float(item.price) * (float(D.premium_discount) if premium else 1.0))


func buy(item: Dictionary, premium: bool) -> bool:
	var price := shop_price(item, premium)
	if not ledger.can_pay(price):
		return false
	ledger.change(-price, "purchase")
	mods["shop_" + item.id] = mod("shop_" + item.id) + 1
	match item.id:
		"atk": mods.atk = mod("atk") + 1
		"skillcost": mods.skillcost = mod("skillcost") + 1
		"maxtime": ledger.raise_max(300.0)
	return true


func rest() -> void:
	ledger.change(float(D.rest_gain), "rest")


func roll_rewards() -> Array:
	var pool: Array = D.rewards.duplicate()
	var out: Array = []
	while out.size() < 3 and not pool.is_empty():
		out.append(pool.pop_at(rng.reward.randi_range(0, pool.size() - 1)))
	return out


func apply_reward(id: String) -> void:
	mods[id] = mod(id) + 1
	ledger.log.append({"t": ledger.clock, "room": room_index, "type": "reward", "id": id})
