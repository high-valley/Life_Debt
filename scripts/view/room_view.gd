class_name RoomView
extends Node2D
## 戦闘部屋の描画。RoomSim を読むだけ。仮アセットなので図形で描く。

const FONT := preload("res://assets/fonts/NotoSansJP-Subset.otf")

var room: RoomSim
var router: InputRouter
var camera := Camera2D.new()
var fx: Array = []
var shake := 0.0
var touch_mode := false
var _rng := RandomNumberGenerator.new()


func _ready() -> void:
	add_child(camera)
	camera.make_current()


func add_fx(e: Dictionary) -> void:
	e["t"] = 0.0
	fx.append(e)


func add_shake(a: float) -> void:
	shake = minf(14.0, shake + a)


func clear() -> void:
	fx.clear()
	shake = 0.0


func screen_to_world(p: Vector2) -> Vector2:
	return get_canvas_transform().affine_inverse() * p


func _process(delta: float) -> void:
	var vp := get_viewport_rect().size
	if room:
		var view := Vector2(900, 506) if touch_mode else room.size
		var z := minf(vp.x / view.x, vp.y / view.y)
		camera.zoom = Vector2(z, z)
		var half := vp / z / 2.0
		var c := room.p.pos if touch_mode else room.size / 2.0
		c.x = room.size.x / 2.0 if half.x * 2.0 >= room.size.x else clampf(c.x, half.x, room.size.x - half.x)
		c.y = room.size.y / 2.0 if half.y * 2.0 >= room.size.y else clampf(c.y, half.y, room.size.y - half.y)
		camera.position = c
		camera.offset = Vector2(_rng.randf() - 0.5, _rng.randf() - 0.5) * shake
	shake *= 0.85
	for f in fx:
		f.t += delta
	fx = fx.filter(func(f: Dictionary) -> bool: return f.t < f.dur)
	queue_redraw()


func _draw() -> void:
	if room == null:
		return
	var s := room.size
	draw_rect(Rect2(Vector2.ZERO, s), Color("#151820"))
	var grid := Color("#1d212b")
	for x in range(0, int(s.x) + 1, 64):
		draw_line(Vector2(x, 0), Vector2(x, s.y), grid, 1.0)
	for y in range(0, int(s.y) + 1, 64):
		draw_line(Vector2(0, y), Vector2(s.x, y), grid, 1.0)
	draw_rect(Rect2(Vector2(3, 3), s - Vector2(6, 6)), Color("#3a3226"), false, 6.0)
	# 床の大時計
	var c := s / 2.0
	var dial := Color(0.95, 0.71, 0.27, 0.06)
	draw_arc(c, 300.0, 0, TAU, 96, dial, 2.0)
	for i in 12:
		var a := i / 12.0 * TAU
		draw_line(c + Vector2(cos(a), sin(a)) * 270.0, c + Vector2(cos(a), sin(a)) * 300.0, dial, 2.0)
	for o in room.geom:
		draw_circle(o.pos, o.r, Color("#262a33"))
		draw_arc(o.pos, o.r, 0, TAU, 48, Color("#3a3f4b"), 3.0)
	var d := room.door_rect()
	var open := room.cleared and room.kind != "boss"
	draw_rect(d, Color(0.37, 0.88, 0.78, 0.35) if open else Color("#2a1d1d"))
	draw_rect(d, Color("#5fe0c8") if open else Color("#5a3a3a"), false, 3.0)
	if open:
		draw_string(FONT, Vector2(d.position.x - 90, d.get_center().y + 7), "出口 →", HORIZONTAL_ALIGNMENT_RIGHT, 80, 20, Color("#5fe0c8"))
	for sh in room.shards:
		var a: float = room.run.elapsed * 3.0 + sh.pos.x
		draw_set_transform(sh.pos, a)
		draw_rect(Rect2(-4, -4, 8, 8), Color("#5fe0c8"))
		draw_set_transform(Vector2.ZERO)
	for f in fx:
		_fx_under(f)
	for e in room.foes:
		_draw_foe(e)
	_draw_player()
	for sh in room.shots:
		draw_circle(sh.pos, 3.5, Color("#f2e3b3"))
	for sh in room.eshots:
		draw_circle(sh.pos, 5.0, Color("#f2b544") if sh.reason == "boss" else Color("#6aa7ff"))
	if not touch_mode and router and router.mouse_inside and router.gameplay_enabled:
		var w := screen_to_world(router.mouse_pos)
		var col := Color(0.94, 0.9, 0.84, 0.5)
		draw_arc(w, 9.0, 0, TAU, 20, col, 1.5)
		draw_line(w + Vector2(-14, 0), w + Vector2(-5, 0), col, 1.5)
		draw_line(w + Vector2(5, 0), w + Vector2(14, 0), col, 1.5)
	for f in fx:
		_fx_over(f)


func _draw_player() -> void:
	var p := room.p
	var t := room.run.ledger.time
	var alpha := 0.45 if p.iframe > 0.0 and int(room.run.elapsed * 30.0) % 2 == 0 else 1.0
	# 寿命リング: 1秒ごとに一周減る
	var frac := fmod(t, 1.0)
	draw_arc(p.pos, p.r + 7.0, -PI / 2.0, -PI / 2.0 + TAU * frac, 32, Color(Color("#e5484d") if t < 60.0 else Color("#f2b544"), alpha), 3.0)
	draw_circle(p.pos, p.r, Color(1, 1, 1, alpha) if p.flash > 0.0 else Color(Color("#efe7d6"), alpha))
	draw_line(p.pos, p.pos + p.aim * (p.r + 4.0), Color(0.14, 0.13, 0.1, alpha), 2.0)


func _draw_foe(e: RoomSim.Foe) -> void:
	var d := e.def
	var col: Color = Color.WHITE if e.flash > 0.0 else d.color_c
	var t := room.run.elapsed
	match d.ai:
		"collector":
			var pts := PackedVector2Array()
			for i in 16:
				var a := i / 16.0 * TAU + t
				pts.append(e.pos + Vector2(cos(a), sin(a)) * (e.r if i % 2 == 1 else e.r + 5.0))
			draw_colored_polygon(pts, col)
			draw_string(FONT, e.pos + Vector2(-80, -e.r - 12), "回収人 残%d秒" % roundi(room.run.debt.total()), HORIZONTAL_ALIGNMENT_CENTER, 160, 13, Color("#e5484d"))
		"boss":
			draw_circle(e.pos, e.r, col)
			var ink := Color("#24201a")
			draw_line(e.pos, e.pos + Vector2(cos(t * 2.0), sin(t * 2.0)) * e.r * 0.8, ink, 3.0)
			draw_line(e.pos, e.pos + Vector2(cos(t / 6.0), sin(t / 6.0)) * e.r * 0.5, ink, 3.0)
		"ranged":
			draw_colored_polygon(PackedVector2Array([e.pos + Vector2(0, -e.r - 2), e.pos + Vector2(e.r, e.r * 0.8), e.pos + Vector2(-e.r, e.r * 0.8)]), col)
		_:
			draw_circle(e.pos, e.r, col)
			if d.get("elite", false):
				draw_rect(Rect2(e.pos - Vector2(6, 6), Vector2(12, 12)), Color("#24201a"), false, 3.0)
	if e.marked:
		draw_arc(e.pos, e.r + 7.0, 0, TAU, 24, Color("#5fe0c8"), 1.5)
	if e.slow_t > 0.0:
		draw_arc(e.pos, e.r + 3.0, 0, TAU, 24, Color(0.42, 0.65, 1, 0.7), 1.5)
	if e.hp < e.max_hp and d.ai != "boss":
		var w := e.r * 2.2
		draw_rect(Rect2(e.pos.x - w / 2.0, e.pos.y - e.r - 9, w, 3), Color(0, 0, 0, 0.55))
		draw_rect(Rect2(e.pos.x - w / 2.0, e.pos.y - e.r - 9, w * maxf(0.0, e.hp / e.max_hp), 3), Color("#e5484d"))


func _fx_under(f: Dictionary) -> void:
	var k: float = f.t / f.dur
	match f.kind:
		"warn":
			var e: RoomSim.Foe = f.follow
			if e and not e.dead:
				draw_circle(e.pos, f.r * k, Color(0.9, 0.28, 0.3, 0.1 + 0.2 * k))
				draw_arc(e.pos, f.r, 0, TAU, 48, Color(0.9, 0.28, 0.3, 0.7), 2.0)
		"burst":
			var col := Color(0.9, 0.28, 0.3, 1.0 - k) if f.get("enemy", false) else Color(0.95, 0.71, 0.27, 1.0 - k)
			draw_arc(f.pos, f.r * (0.4 + 0.6 * k), 0, TAU, 64, col, 8.0 * (1.0 - k) + 1.0)
		"slash":
			draw_line(f.pos, f.to, Color(0.94, 0.9, 0.84, 1.0 - k), 10.0 * (1.0 - k) + 2.0)


func _fx_over(f: Dictionary) -> void:
	var k: float = f.t / f.dur
	match f.kind:
		"poof":
			draw_circle(f.pos, 6.0 + 16.0 * k, Color(f.color, (1.0 - k) * 0.6))
		"mark":
			draw_arc(f.pos, 10.0 + 30.0 * k, 0, TAU, 32, Color(0.37, 0.88, 0.78, 1.0 - k), 2.0)
		"gain", "lose", "seize":
			var col := Color("#5fe0c8") if f.kind == "gain" else (Color("#e5a14d") if f.kind == "seize" else Color("#e5484d"))
			draw_string(FONT, f.pos + Vector2(-60, -24.0 * k), f.text, HORIZONTAL_ALIGNMENT_CENTER, 120, 18, Color(col, 1.0 - k))
