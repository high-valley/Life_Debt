class_name DataLoader
extends RefCounted
## data/balance.json を読み込んで検証する。バランス値はすべてここから参照する。

var d: Dictionary = {}
var errors: PackedStringArray = []

const TOP := ["schema_version", "time", "player", "skills", "enemies", "area_hp_scale", "contracts", "max_contracts", "seize_rate",
	"shop", "premium_discount", "rest_gain", "rewards", "nodes", "node_weights", "rooms_total", "gate_room", "room_size", "geometries"]
const ENEMY_AI := ["chase", "ranged", "collector", "boss"]


static func load_file(path: String = "res://data/balance.json") -> DataLoader:
	var dl := DataLoader.new()
	if not FileAccess.file_exists(path):
		dl.errors.append("ファイルがない: " + path)
		return dl
	var v: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not v is Dictionary:
		dl.errors.append("JSONとして読めない: " + path)
		return dl
	dl.setup(v)
	return dl


func setup(p: Dictionary) -> void:
	d = p
	validate()
	if errors.is_empty():
		for id in d.enemies:
			d.enemies[id]["id"] = id
			d.enemies[id]["color_c"] = Color.html(d.enemies[id].color)


func is_valid() -> bool:
	return errors.is_empty()


func _need(obj: Variant, keys: Array, label: String) -> bool:
	if not obj is Dictionary:
		errors.append("%s: 辞書ではない" % label)
		return false
	var ok := true
	for k in keys:
		if not obj.has(k):
			errors.append("%s: '%s' がない" % [label, k])
			ok = false
	return ok


func validate() -> void:
	if not _need(d, TOP, "balance"):
		return
	_need(d.time, ["start", "max", "gate_threshold", "drain_per_sec"], "time")
	if float(d.time.get("start", 0)) <= 0 or float(d.time.get("start", 0)) > float(d.time.get("max", 0)):
		errors.append("time: start は 0 より大きく max 以下")
	_need(d.player, ["speed", "radius", "dash_speed", "dash_time", "dash_cd", "hit_iframe", "shot_interval", "shot_speed", "shot_damage", "pickup_radius"], "player")
	if d.skills.size() != 3:
		errors.append("skills: MVPは3つ固定")
	for i in d.skills.size():
		_need(d.skills[i], ["id", "name", "cost", "cd"], "skills[%d]" % i)
	for need in ["debtor", "officer", "enforcer", "collector", "regulator"]:
		if not d.enemies.has(need):
			errors.append("enemies: '%s' が必要" % need)
	for id in d.enemies:
		var e: Variant = d.enemies[id]
		if _need(e, ["name", "hp", "speed", "radius", "damage", "drop", "ai", "color"], "enemies[%s]" % id):
			if not e.ai in ENEMY_AI:
				errors.append("enemies[%s]: ai は %s のどれか" % [id, ENEMY_AI])
			if float(e.hp) <= 0:
				errors.append("enemies[%s]: hp は正の数" % id)
			if not Color.html_is_valid(str(e.color)):
				errors.append("enemies[%s]: color が不正" % id)
	for c in d.contracts:
		if _need(c, ["id", "name", "principal", "repay", "due"], "contracts[%s]" % str(c.get("id", "?"))):
			if float(c.repay) < float(c.principal):
				errors.append("contracts[%s]: 返済額が元本より少ない（無限増殖になる）" % c.id)
			if int(c.due) < 1:
				errors.append("contracts[%s]: due は1部屋以上" % c.id)
	for s in d.shop:
		_need(s, ["id", "name", "price", "desc"], "shop[%s]" % str(s.get("id", "?")))
	for r in d.rewards:
		_need(r, ["id", "name", "desc"], "rewards[%s]" % str(r.get("id", "?")))
	for k in d.node_weights:
		if not d.nodes.has(k):
			errors.append("node_weights: '%s' が nodes にない" % k)
	for k in ["battle", "elite", "shop", "contract", "rest", "premium", "alley", "boss"]:
		if not d.nodes.has(k):
			errors.append("nodes: '%s' が必要" % k)
	if int(d.gate_room) <= 0 or int(d.gate_room) >= int(d.rooms_total):
		errors.append("gate_room は 1〜rooms_total-1")
	if d.geometries.is_empty():
		errors.append("geometries: 部屋プリセットが1つもない")
