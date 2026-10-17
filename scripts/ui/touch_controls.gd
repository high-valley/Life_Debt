class_name TouchControls
extends Control
## スマホ用の操作レイヤー。結果は InputRouter のシグナルとして流す。
##   画面左半分ドラッグ = 仮想スティック / 通常弾は自動で見えている敵へ
##   右下 = ダッシュと3つの寿命スキル / 右上 = 契約書・ポーズ

const JOY_RADIUS := 56.0
const DEAD_ZONE := 6.0

var router: InputRouter
var room_ref: Callable    # 現在の RoomSim を返す
var run_ref: Callable     # 現在の RunState を返す
var joy := {}
var font: Font


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	font = get_theme_default_font()


func reset() -> void:
	joy = {}
	if router:
		router.touch_move = Vector2.ZERO


func buttons() -> Dictionary:
	var pad := 22.0
	var r := clampf(size.y * 0.085, 40.0, 62.0)
	var sr := r * 0.82
	var b := Vector2(size.x - pad - r, size.y - pad - r)
	return {
		"dash": {"pos": b, "r": r, "label": "ダッシュ"},
		"s0": {"pos": b + Vector2(-r * 2.3, r * 0.15), "r": sr, "skill": 0},
		"s1": {"pos": b + Vector2(-r * 1.9, -r * 1.75), "r": sr, "skill": 1},
		"s2": {"pos": b + Vector2(-r * 0.2, -r * 2.35), "r": sr, "skill": 2},
		"pause": {"pos": Vector2(size.x - pad - 26, pad + 26), "r": 26.0, "label": "II"},
		"book": {"pos": Vector2(size.x - pad - 88, pad + 26), "r": 26.0, "label": "契"},
	}


func _active() -> bool:
	return visible and router != null and router.gameplay_enabled


func _hit(p: Vector2, b: Dictionary) -> bool:
	return p.distance_to(b.pos) <= b.r + 10.0


func _input(event: InputEvent) -> void:
	if not _active():
		return
	if event is InputEventScreenTouch:
		var p: Vector2 = event.position
		if event.pressed:
			var b := buttons()
			if _hit(p, b.pause):
				router.pause_toggled.emit()
			elif _hit(p, b.book):
				router.book_toggled.emit()
			elif _hit(p, b.dash):
				router.dash_requested.emit()
			else:
				var used := false
				for k in ["s0", "s1", "s2"]:
					if _hit(p, b[k]):
						router.skill_requested.emit(b[k].skill, null)
						used = true
						break
				if not used and joy.is_empty() and p.x < size.x * 0.5:
					joy = {"index": event.index, "origin": p, "pos": p}
		elif not joy.is_empty() and joy.index == event.index:
			reset()
		get_viewport().set_input_as_handled()
	elif event is InputEventScreenDrag:
		if not joy.is_empty() and joy.index == event.index:
			joy.pos = event.position
			joy.origin = follow_origin(joy.origin, joy.pos)
			router.touch_move = stick_vector(joy.origin, joy.pos)
		get_viewport().set_input_as_handled()


func _process(_d: float) -> void:
	if visible:
		queue_redraw()


func _draw() -> void:
	if not _active():
		return
	var room: RoomSim = room_ref.call() if room_ref.is_valid() else null
	var run: RunState = run_ref.call() if run_ref.is_valid() else null
	if room == null or run == null:
		return
	var b := buttons()
	_circle(b.dash, b.dash.label, "", room.p.dash_cd <= 0.0, room.p.dash_cd / float(run.D.player.dash_cd), false)
	for k in ["s0", "s1", "s2"]:
		var i: int = b[k].skill
		var sk: Dictionary = run.D.skills[i]
		var cost := run.skill_cost(i)
		_circle(b[k], sk.name, "−%ds" % cost, false, room.p.skill_cd[i] / float(sk.cd), not run.ledger.can_pay(cost))
	_circle(b.pause, "II", "", false, 0.0, false)
	_circle(b.book, "契", "", false, 0.0, false)
	if not joy.is_empty():
		var v: Vector2 = (joy.pos - joy.origin).limit_length(JOY_RADIUS)
		draw_arc(joy.origin, JOY_RADIUS, 0, TAU, 48, Color(0.94, 0.9, 0.84, 0.35), 3.0)
		draw_circle(joy.origin + v, 24.0, Color(0.95, 0.71, 0.27, 0.6))
	elif run.elapsed < 10.0:
		draw_string(font, Vector2(24, size.y * 0.62), "← 左側ドラッグで移動（弾は自動）", HORIZONTAL_ALIGNMENT_LEFT, -1, 20, Color("#9a9688"))
	if size.y > size.x:
		draw_string(font, Vector2(0, 150), "横向きにすると遊びやすくなります", HORIZONTAL_ALIGNMENT_CENTER, size.x, 20, Color("#f2b544"))


func _circle(btn: Dictionary, label: String, sub: String, lit: bool, cd: float, dim: bool) -> void:
	var p: Vector2 = btn.pos
	var r: float = btn.r
	draw_circle(p, r, Color(0.09, 0.11, 0.14, 0.8))
	if cd > 0.0:
		var pts := PackedVector2Array([p])
		for i in 33:
			var a := -PI / 2.0 + TAU * cd * i / 32.0
			pts.append(p + Vector2(cos(a), sin(a)) * r)
		draw_colored_polygon(pts, Color(0, 0, 0, 0.6))
	draw_arc(p, r, 0, TAU, 48, Color("#f2b544") if lit else Color("#3a3f4b"), 3.0)
	var fs := maxi(14, int(r * 0.34))
	var y := p.y + fs * 0.35 - (r * 0.18 if sub != "" else 0.0)
	draw_string(font, Vector2(p.x - r, y), label, HORIZONTAL_ALIGNMENT_CENTER, r * 2.0, fs, Color("#6b675d") if dim else Color("#efe7d6"))
	if sub != "":
		draw_string(font, Vector2(p.x - r, p.y + r * 0.42), sub, HORIZONTAL_ALIGNMENT_CENTER, r * 2.0, fs, Color("#e5484d") if dim else Color("#f2b544"))


## 指が円の外へ出たら、中心を指の方へ引っぱる（追従スティック）。
## 中心が固定だと、大きくスワイプした後に向きを変えるには指をその分戻す必要があり、操作が遅れて感じる。
static func follow_origin(origin: Vector2, pos: Vector2) -> Vector2:
	var v := pos - origin
	if v.length() > JOY_RADIUS:
		return pos - v.normalized() * JOY_RADIUS
	return origin


## 移動入力（長さ0〜1）。中心から少し動かしただけで反応する
static func stick_vector(origin: Vector2, pos: Vector2) -> Vector2:
	var v := pos - origin
	if v.length() <= DEAD_ZONE:
		return Vector2.ZERO
	return (v / JOY_RADIUS).limit_length(1.0)
