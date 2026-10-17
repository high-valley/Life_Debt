class_name RoomSim
extends RefCounted
## 1つの戦闘部屋のシミュレーション。ノード・描画・入力に依存しない。
## 1ティックの処理順（同フレームの競合をこの順で解決する）:
##   1) プレイヤー移動・射撃 2) 自弾の命中 3) 敵の撃破（清算・ドロップ） 4) 敵AIと攻撃・被弾
##   5) 時間片の回収（滞納中は差し押さえ） 6) 時計の減少 7) ウェーブ・部屋クリア判定

const STEP := 1.0 / 60.0
const CELL := 40


class Player:
	var pos := Vector2(140, 360)
	var vel := Vector2.ZERO
	var r := 13.0
	var aim := Vector2.RIGHT
	var dash_t := 0.0
	var dash_dir := Vector2.RIGHT
	var dash_cd := 0.0
	var iframe := 0.0
	var shot_cd := 0.0
	var flash := 0.0
	var slot := 0
	var skill_cd: Array = [0.0, 0.0, 0.0]


class Foe:
	var id: int
	var def: Dictionary
	var pos: Vector2
	var vel := Vector2.ZERO
	var r: float
	var hp: float
	var max_hp: float
	var cd := 1.0
	var flash := 0.0
	var slow_t := 0.0
	var marked := false
	var dead := false
	var aoe_cd := 3.0
	var windup := 0.0
	var summon_cd := 6.0
	var volley_cd := 2.5


var run: RunState
var D: Dictionary
var kind: String
var id := ""
var size: Vector2
var geom: Array = []         # {pos, r}
var waves: Array = []
var wave := 0
var wave_t := 0.0
var cleared := false
var just_cleared := false
var drop_mul := 1.0
var p := Player.new()
var foes: Array = []
var shots: Array = []        # {pos, vel, life}
var eshots: Array = []       # {pos, vel, dmg, life, reason}
var shards: Array = []       # {pos, v}
var events: Array = []       # fx / sfx / toast / shake
var boss: Foe = null
var _uid := 1
var _flow := PackedInt32Array()
var _flow_t := 0.0
var _gw: int
var _gh: int


func _init(p_run: RunState, p_kind: String) -> void:
	run = p_run
	D = run.D
	kind = p_kind
	size = Vector2(D.room_size[0], D.room_size[1])
	_gw = int(size.x) / CELL
	_gh = int(size.y) / CELL
	var gi := 0 if kind == "boss" else run.rng.map.randi_range(0, D.geometries.size() - 1)
	for g in D.geometries[gi]:
		geom.append({"pos": Vector2(g[0], g[1]), "r": float(g[2])})
	id = "%s-%d-g%d" % [kind, run.room_index, gi]
	drop_mul = float(D.nodes[kind].get("drop_mul", 1.0))
	p.r = float(D.player.radius)
	_build_waves()
	_spawn_wave()


# ---------------------------------------------------------------- events
func _emit(type: String, payload: Dictionary = {}) -> void:
	payload["type"] = type
	events.append(payload)


func _fx(k: String, pos: Vector2, dur: float, extra: Dictionary = {}) -> void:
	var e := extra.duplicate()
	e["kind"] = k
	e["pos"] = pos
	e["dur"] = dur
	_emit("fx", e)


func drain_events() -> Array:
	var out := events
	events = []
	for n in run.ledger.notices:
		out.append({"type": "toast", "text": n.text, "kind": n.kind})
	run.ledger.notices.clear()
	return out


# ---------------------------------------------------------------- waves
func _build_waves() -> void:
	var a := run.area()
	if kind == "boss":
		waves = [["regulator", "officer", "officer"]]
		return
	var base := 2 + a
	for w in 3:
		var list: Array = []
		var n := base + run.rng.enemy.randi_range(0, 1) + w
		for i in n:
			list.append("officer" if run.rng.enemy.randf() < 0.25 + a * 0.08 else "debtor")
		if (kind == "elite" or kind == "alley") and w == 0:
			list.append("enforcer")
			if a >= 2:
				list.append("enforcer")
		waves.append(list)
	if not run.debt.defaulted().is_empty():
		waves[0].append("collector")   # 滞納中は回収人が合算で1体だけ来る


func _spawn_wave() -> void:
	if wave >= waves.size():
		return
	for eid in waves[wave]:
		var def: Dictionary = D.enemies[eid]
		var r := float(def.radius)
		var pos := Vector2.ZERO
		for tries in 20:
			var side := run.rng.enemy.randi_range(0, 2)
			match side:
				0: pos = Vector2(size.x - 60 - run.rng.enemy.randf() * 200, 80 + run.rng.enemy.randf() * (size.y - 160))
				1: pos = Vector2(300 + run.rng.enemy.randf() * (size.x - 380), 60 + run.rng.enemy.randf() * 80)
				_: pos = Vector2(300 + run.rng.enemy.randf() * (size.x - 380), size.y - 60 - run.rng.enemy.randf() * 80)
			if not blocked(pos, r) and pos.distance_to(p.pos) >= 280:
				break
		var hp := float(def.hp) * (1.0 + (run.area() - 1) * float(D.area_hp_scale))
		if def.ai == "collector":
			hp = float(def.hp) + run.debt.default_outstanding() * float(def.get("hp_per_debt", 0.35))
		var f := _new_foe(def, pos, hp)
		f.cd = 0.6 + run.rng.enemy.randf()
		if def.ai == "boss":
			boss = f
	wave += 1
	wave_t = 0.0


func _new_foe(def: Dictionary, pos: Vector2, hp: float) -> Foe:
	var f := Foe.new()
	f.id = _uid
	_uid += 1
	f.def = def
	f.pos = pos
	f.r = float(def.radius)
	f.hp = hp
	f.max_hp = hp
	foes.append(f)
	return f


# ---------------------------------------------------------------- geometry
func blocked(pos: Vector2, r: float) -> bool:
	if pos.x < r or pos.y < r or pos.x > size.x - r or pos.y > size.y - r:
		return true
	for o in geom:
		if pos.distance_to(o.pos) < o.r + r:
			return true
	return false


static func seg_dist(pt: Vector2, a: Vector2, b: Vector2) -> float:
	return pt.distance_to(Geometry2D.get_closest_point_to_segment(pt, a, b))


func los(a: Vector2, b: Vector2, pad: float) -> bool:
	for o in geom:
		if seg_dist(o.pos, a, b) < o.r + pad:
			return false
	return true


func _push_out(pos: Vector2, r: float) -> Vector2:
	for o in geom:
		var off: Vector2 = pos - o.pos
		var rr: float = o.r + r
		if off.length() < rr and off.length() > 0.0:
			pos = o.pos + off.normalized() * rr
	return pos.clamp(Vector2(r, r), size - Vector2(r, r))


func door_rect() -> Rect2:
	return Rect2(size.x - 34, size.y / 2 - 60, 34, 120)


## 経路: 40pxグリッドのBFS距離場（プレイヤーが起点）。視線が通らない敵はこれを下る
func _build_flow() -> void:
	var blocked_cell := PackedByteArray()
	blocked_cell.resize(_gw * _gh)
	_flow.resize(_gw * _gh)
	_flow.fill(-1)
	for gy in _gh:
		for gx in _gw:
			var c := Vector2(gx * CELL + CELL / 2.0, gy * CELL + CELL / 2.0)
			for o in geom:
				if c.distance_to(o.pos) < o.r + 14.0:
					blocked_cell[gy * _gw + gx] = 1
	var px := clampi(int(p.pos.x) / CELL, 0, _gw - 1)
	var py := clampi(int(p.pos.y) / CELL, 0, _gh - 1)
	var q := [py * _gw + px]
	_flow[q[0]] = 0
	var h := 0
	while h < q.size():
		var i: int = q[h]
		h += 1
		var x := i % _gw
		var y := i / _gw
		for dy in [-1, 0, 1]:
			for dx in [-1, 0, 1]:
				if dx == 0 and dy == 0:
					continue
				var nx: int = x + dx
				var ny: int = y + dy
				if nx < 0 or ny < 0 or nx >= _gw or ny >= _gh:
					continue
				var j := ny * _gw + nx
				if _flow[j] >= 0 or blocked_cell[j] == 1:
					continue
				if dx != 0 and dy != 0 and (blocked_cell[y * _gw + nx] == 1 or blocked_cell[ny * _gw + x] == 1):
					continue
				_flow[j] = _flow[i] + 1
				q.append(j)


func _chase_target(f: Foe) -> Vector2:
	if _flow.is_empty() or los(f.pos, p.pos, f.r):
		return p.pos
	var gx := int(f.pos.x) / CELL
	var gy := int(f.pos.y) / CELL
	var best := p.pos
	var bd := 1 << 30
	for dy in [-1, 0, 1]:
		for dx in [-1, 0, 1]:
			var nx: int = gx + dx
			var ny: int = gy + dy
			if nx < 0 or ny < 0 or nx >= _gw or ny >= _gh:
				continue
			var v: int = _flow[ny * _gw + nx]
			if v >= 0 and v < bd:
				bd = v
				best = Vector2(nx * CELL + CELL / 2.0, ny * CELL + CELL / 2.0)
	return best


static func _steer(f: Foe, target: Vector2, speed: float, dt: float, stop: float) -> void:
	var off := target - f.pos
	var d := off.length()
	var want := off / d * speed if d > stop else Vector2.ZERO
	f.vel += (want - f.vel) * minf(1.0, dt * 8.0)


# ---------------------------------------------------------------- targeting
func nearest_foe(from: Vector2, max_d: float = 1e9, visible_only := false) -> Foe:
	var best: Foe = null
	var bd := max_d
	for f in foes:
		if f.dead:
			continue
		var d := from.distance_to(f.pos)
		if d < bd and (not visible_only or los(p.pos, f.pos, 3.0)):
			bd = d
			best = f
	return best


## aim_world が null ならオートエイム（見えている一番近い敵）
func _aim(aim_world: Variant) -> Vector2:
	if aim_world == null:
		var t := nearest_foe(p.pos, 1e9, true)
		if t == null:
			t = nearest_foe(p.pos)
		return (t.pos - p.pos).normalized() if t else p.aim
	var v: Vector2 = aim_world - p.pos
	return v.normalized() if v.length() > 1.0 else p.aim


# ---------------------------------------------------------------- player actions
func try_dash(move: Vector2) -> void:
	if p.dash_cd > 0.0 or run.result != "":
		return
	p.dash_dir = move.normalized() if move.length() > 0.01 else p.aim
	p.dash_t = float(D.player.dash_time)
	p.dash_cd = float(D.player.dash_cd)
	p.iframe = maxf(p.iframe, p.dash_t + 0.05)


func use_skill(i: int, aim_world: Variant) -> bool:
	if run.result != "":
		return false
	var sk: Dictionary = D.skills[i]
	var cost := run.skill_cost(i)
	if p.skill_cd[i] > 0.0:
		_emit("toast", {"text": "クールダウン中", "kind": "muted"})
		return false
	if not run.ledger.can_pay(cost):
		_emit("toast", {"text": "寿命が足りない（%d秒必要）" % cost, "kind": "debt"})
		_emit("sfx", {"name": "fail"})
		return false
	var dir := _aim(aim_world)
	match sk.id:
		"drain_mark":
			var target: Foe = nearest_foe(p.pos, 1e9, true) if aim_world == null else nearest_foe(aim_world, 90.0)
			if target == null:
				_emit("toast", {"text": "刻印する敵がいない", "kind": "muted"})
				return false
			run.ledger.change(-cost, "skill")
			target.marked = true
			_fx("mark", target.pos, 0.5)
		"time_burst":
			run.ledger.change(-cost, "skill")
			for f in foes:
				if f.pos.distance_to(p.pos) < float(sk.radius) + f.r:
					_hurt(f, float(sk.damage) * run.atk_mul())
			_fx("burst", p.pos, 0.45, {"r": float(sk.radius)})
			_emit("shake", {"amount": 4.0})
		"temporal_dash":
			run.ledger.change(-cost, "skill")
			var start := p.pos
			var end := (p.pos + dir * float(sk.length)).clamp(Vector2(p.r, p.r), size - Vector2(p.r, p.r))
			for f in foes:
				if seg_dist(f.pos, start, end) < f.r + 26.0:
					_hurt(f, float(sk.damage) * run.atk_mul())
					f.slow_t = float(sk.slow_time)
			p.pos = _push_out(end, p.r)
			p.iframe = maxf(p.iframe, 0.25)
			_fx("slash", start, 0.35, {"to": end})
	p.skill_cd[i] = float(sk.cd)
	_emit("sfx", {"name": "skill"})
	run.check_death()
	return true


func _hurt(f: Foe, d: float) -> void:
	if f.dead:
		return
	if f.def.ai == "collector":
		d *= run.collector_mul()
	f.hp -= d
	f.flash = 0.08


func _hurt_player(d: float, reason: String, steal: bool) -> void:
	if run.result != "" or p.iframe > 0.0:
		return
	p.iframe = float(D.player.hit_iframe)
	p.flash = 0.2
	_emit("shake", {"amount": 5.0})
	_emit("sfx", {"name": "hit"})
	if steal:   # 回収人の取り立ては借金の返済にも充当される
		for c in run.debt.defaulted():
			var take: float = minf(d, c.outstanding)
			c.outstanding -= take
			break
	run.ledger.change(-d, reason)
	_fx("lose", p.pos + Vector2(0, -20), 0.9, {"text": "−%d" % roundi(d)})
	if steal and not run.debt.defaulted().is_empty() and run.debt.defaulted().all(func(c: Dictionary) -> bool: return c.outstanding <= 0.5):
		run.debt.settle_defaulted()
		_emit("toast", {"text": "取り立てで滞納分を完済した", "kind": "good"})
	run.check_death()


# ---------------------------------------------------------------- tick
func step(dt: float, move: Vector2, aim_world: Variant, shoot: bool) -> void:
	just_cleared = false
	run.elapsed += dt
	run.ledger.clock = run.elapsed
	var P: Dictionary = D.player
	# 1) プレイヤー
	var mv := move.normalized() if move.length() > 0.01 else Vector2.ZERO
	if p.dash_t > 0.0:
		p.dash_t -= dt
		p.pos += p.dash_dir * float(P.dash_speed) * dt
	else:
		p.pos += mv * run.move_speed() * dt
	p.pos = _push_out(p.pos, p.r)
	p.dash_cd = maxf(0.0, p.dash_cd - dt)
	p.iframe = maxf(0.0, p.iframe - dt)
	p.flash -= dt
	p.shot_cd -= dt
	for i in 3:
		p.skill_cd[i] = maxf(0.0, p.skill_cd[i] - dt)
	p.aim = _aim(aim_world)
	var want_shoot := shoot if aim_world != null else not foes.is_empty()
	if want_shoot and p.shot_cd <= 0.0 and run.result == "":
		p.shot_cd = run.shot_interval()
		shots.append({"pos": p.pos + p.aim * 16.0, "vel": p.aim * float(P.shot_speed), "life": 0.9})
		if run.rng.misc.randf() < 0.3:
			_emit("sfx", {"name": "shot"})
	# 2) 自弾
	for s in shots:
		s.pos += s.vel * dt
		s.life -= dt
		if blocked(s.pos, 2.0):
			s.life = 0.0
			continue
		for f in foes:
			if not f.dead and f.pos.distance_to(s.pos) < f.r + 4.0:
				_hurt(f, float(P.shot_damage) * run.atk_mul())
				s.life = 0.0
				break
	shots = shots.filter(func(s: Dictionary) -> bool: return s.life > 0.0)
	# 3) 撃破（清算・ドロップは敵の攻撃より先）
	for f in foes:
		if f.dead or f.hp > 0.0:
			continue
		f.dead = true
		_fx("poof", f.pos, 0.4, {"color": f.def.color_c})
		if f.def.ai == "collector" and run.debt.settle_defaulted():
			_emit("toast", {"text": "回収人を退けた。滞納分は清算された", "kind": "good"})
		if f.def.ai == "boss":
			run.win()
		if float(f.def.drop) > 0.0:
			var v := float(f.def.drop) * (1.0 + float(D.skills[2].bonus) if f.marked else 1.0) * drop_mul
			var n := clampi(roundi(v / 20.0), 1, 5)
			for i in n:
				shards.append({"pos": f.pos + Vector2(run.rng.misc.randf() - 0.5, run.rng.misc.randf() - 0.5) * 26.0, "v": v / n})
	foes = foes.filter(func(f: Foe) -> bool: return not f.dead)
	# 4) 敵
	_flow_t -= dt
	if _flow_t <= 0.0 or _flow.is_empty():
		_flow_t = 0.25
		_build_flow()
	for f in foes:
		_foe_update(f, dt)
	for f in foes:
		f.pos = _push_out(f.pos + f.vel * dt, f.r)
	for i in foes.size():
		for j in range(i + 1, foes.size()):
			var a: Foe = foes[i]
			var b: Foe = foes[j]
			var off := b.pos - a.pos
			var d := off.length()
			var rr := a.r + b.r
			if d < rr and d > 0.0:
				var push := off / d * (rr - d) / 2.0
				a.pos -= push
				b.pos += push
	for s in eshots:
		s.pos += s.vel * dt
		s.life -= dt
		if blocked(s.pos, 2.0):
			s.life = 0.0
			continue
		if s.pos.distance_to(p.pos) < p.r + 4.0:
			_hurt_player(s.dmg, s.reason, false)
			s.life = 0.0
	eshots = eshots.filter(func(s: Dictionary) -> bool: return s.life > 0.0)
	# 5) 時間片
	var kept: Array = []
	for s in shards:
		var off: Vector2 = p.pos - s.pos
		var d := off.length()
		if d < p.r + 10.0:
			var v: float = s.v * run.gain_mul()
			if not run.debt.defaulted().is_empty():
				var seized := v * run.debt.seize_rate
				v -= seized
				_fx("seize", p.pos + Vector2(0, -34), 0.8, {"text": "差押 %d" % roundi(seized)})
				if run.debt.seize(seized):
					_emit("toast", {"text": "差し押さえで滞納分を完済した", "kind": "good"})
					for f in foes:
						if f.def.ai == "collector":
							f.dead = true
							_fx("poof", f.pos, 0.5, {"color": f.def.color_c})
			run.ledger.change(v, "drop")
			_emit("sfx", {"name": "gain"})
			_fx("gain", p.pos + Vector2(0, -18), 0.8, {"text": "+%d" % roundi(v)})
			continue
		if d < run.pickup_radius():
			s.pos += off / d * maxf(260.0, 640.0 - d * 2.0) * dt
		kept.append(s)
	shards = kept
	foes = foes.filter(func(f: Foe) -> bool: return not f.dead)
	# 6) 時計
	run.ledger.change(-float(D.time.drain_per_sec) * dt, "drain")
	run.check_death()
	# 7) ウェーブ・クリア
	wave_t += dt
	if wave < waves.size() and (foes.size() <= 1 or wave_t > 14.0):
		_spawn_wave()
	if not cleared and wave >= waves.size() and foes.is_empty() and run.result == "":
		cleared = true
		just_cleared = true
		_emit("sfx", {"name": "door"})


func at_door() -> bool:
	if not cleared or kind == "boss":
		return false
	var d := door_rect()
	return p.pos.x + p.r > d.position.x and p.pos.y > d.position.y and p.pos.y < d.end.y


func _foe_update(f: Foe, dt: float) -> void:
	var d := f.def
	var speed := float(d.speed) * (float(D.skills[1].slow) if f.slow_t > 0.0 else 1.0)
	f.slow_t -= dt
	f.cd -= dt
	f.flash -= dt
	var dp := f.pos.distance_to(p.pos)
	var chase := _chase_target(f)
	var seen := los(f.pos, p.pos, 4.0)
	match d.ai:
		"chase", "collector":
			_steer(f, chase, speed, dt, 0.0)
			if dp < f.r + p.r + 2.0 and f.cd <= 0.0:
				f.cd = 0.8
				_hurt_player(float(d.damage), "collector" if d.ai == "collector" else "hit", d.ai == "collector")
		"ranged":
			if dp > float(d.range) or not seen:
				_steer(f, chase, speed, dt, 0.0)
			elif dp < 220.0:
				_steer(f, f.pos * 2.0 - p.pos, speed * 0.8, dt, 0.0)
			else:
				_steer(f, f.pos, 0.0, dt, 1.0)
			if seen and dp < float(d.range) + 40.0 and f.cd <= 0.0:
				f.cd = float(d.interval)
				var a := (p.pos - f.pos).angle() + (run.rng.misc.randf() - 0.5) * 0.1
				eshots.append({"pos": f.pos, "vel": Vector2(cos(a), sin(a)) * 330.0, "dmg": float(d.damage), "life": 1.6, "reason": "hit"})
		"boss":
			_steer(f, chase, speed, dt, f.r + 20.0)
			if dp < f.r + p.r + 4.0 and f.cd <= 0.0:
				f.cd = 1.0
				_hurt_player(float(d.damage), "boss", false)
			var aoe: Dictionary = d.aoe
			f.aoe_cd -= dt
			f.summon_cd -= dt
			f.volley_cd -= dt
			if f.windup > 0.0:
				f.windup -= dt
				if f.windup <= 0.0:
					if dp < float(aoe.radius) + p.r:
						_hurt_player(float(aoe.damage), "boss", false)
					_fx("burst", f.pos, 0.4, {"r": float(aoe.radius), "enemy": true})
					_emit("shake", {"amount": 6.0})
			elif f.aoe_cd <= 0.0 and dp < float(aoe.radius) + 45.0:
				f.windup = float(aoe.windup)
				f.aoe_cd = float(aoe.interval)
				_fx("warn", f.pos, float(aoe.windup), {"r": float(aoe.radius), "follow": f})
			if f.summon_cd <= 0.0 and foes.size() < 10:
				f.summon_cd = float(d.summon_interval)
				var dd: Dictionary = D.enemies.debtor
				for i in 3:
					var a := run.rng.enemy.randf() * TAU
					var m := _new_foe(dd, _push_out(f.pos + Vector2(cos(a), sin(a)) * 60.0, float(dd.radius)), float(dd.hp) * 1.5)
					m.cd = 1.0
			if f.volley_cd <= 0.0 and dp > 160.0 and seen:
				f.volley_cd = float(d.volley_interval)
				var base := (p.pos - f.pos).angle()
				for k in [-1, 0, 1]:
					var a: float = base + k * 0.22
					eshots.append({"pos": f.pos, "vel": Vector2(cos(a), sin(a)) * 300.0, "dmg": 10.0, "life": 2.0, "reason": "boss"})


func dispose() -> void:
	foes.clear()
	boss = null
	shots.clear()
	eshots.clear()
	shards.clear()
	events.clear()
