class_name Hud
extends Control
## 戦闘HUD（表示専用）。大型の寿命カウントダウン、区画、借金、スキル、トースト、低残寿命の演出。

const FONT := preload("res://assets/fonts/NotoSansJP-Subset.otf")

var run: RunState
var room: RoomSim
var touch_mode := false
var clock_running := false
var toasts: Array = []
var fps := 60.0


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)


func toast(text: String, kind := "muted", dur := 2.2) -> void:
	toasts.append({"text": text, "kind": kind, "t": dur})
	if toasts.size() > 4:
		toasts.pop_front()


func _process(delta: float) -> void:
	for t in toasts:
		t.t -= delta
	toasts = toasts.filter(func(t: Dictionary) -> bool: return t.t > 0.0)
	fps = lerpf(fps, Engine.get_frames_per_second(), 0.1)
	if visible:
		queue_redraw()


func _s(pos: Vector2, text: String, size: int, col: Color, align := HORIZONTAL_ALIGNMENT_LEFT, width := -1.0) -> void:
	draw_string(FONT, pos, text, align, width, size, col)


func _draw() -> void:
	if run == null or room == null:
		return
	var vp := size
	var pad := 22.0
	var t := run.ledger.time
	var low := t < 60.0
	var flash_on: bool = Settings.flash and clock_running
	# 低残寿命: 画面端を赤く脈動させる（設定で抑制可）
	if low and clock_running:
		var pulse := 0.5 + 0.5 * sin(run.elapsed * (10.0 if t < 20.0 else 5.0)) if flash_on else 0.6
		var a := (1.0 - t / 60.0) * (0.25 + 0.25 * pulse)
		var w := minf(vp.x, vp.y) * 0.18
		for i in 8:
			var k := float(i) / 8.0
			var col := Color(0.9, 0.28, 0.3, a * (1.0 - k) * 0.35)
			var inset := w * k
			draw_rect(Rect2(inset, inset, vp.x - inset * 2.0, vp.y - inset * 2.0), col, false, w / 8.0)
	# 寿命カウントダウン
	var col := Color("#e5484d") if low else (Color("#f2b544") if t < 300.0 else Color("#efe7d6"))
	var big := 64 if vp.x > 1000 else 48
	_s(Vector2(0, pad + big * 0.85), TimeLedger.fmt(t), big, col, HORIZONTAL_ALIGNMENT_CENTER, vp.x)
	_s(Vector2(0, pad + big + 18), "残寿命  上限 %s" % TimeLedger.fmt(run.ledger.max_time) if clock_running else "残寿命（時計停止中）", 15, Color("#9a9688"), HORIZONTAL_ALIGNMENT_CENTER, vp.x)
	if room.boss and not room.boss.dead:
		var bw := minf(520.0, vp.x - 200.0)
		var y := pad + big + 30
		draw_rect(Rect2(vp.x / 2.0 - bw / 2.0, y, bw, 12), Color(0, 0, 0, 0.6))
		draw_rect(Rect2(vp.x / 2.0 - bw / 2.0, y, bw * maxf(0.0, room.boss.hp / room.boss.max_hp), 12), Color("#f2b544"))
		_s(Vector2(0, y + 34), "時間管理局長", 17, Color("#efe7d6"), HORIZONTAL_ALIGNMENT_CENTER, vp.x)
	# 区画（左上）
	var nd: Dictionary = run.D.nodes[room.kind]
	_s(Vector2(pad, pad + 20), "エリア%d · 区画 %d/%d" % [run.area(), run.room_index + 1, int(run.D.rooms_total) + 1], 20, Color("#efe7d6"))
	_s(Vector2(pad, pad + 46), "%s %s%s  敵 %d" % [nd.icon, nd.name, "（ドロップ+50%）" if room.drop_mul > 1.0 else "", room.foes.size()], 15, Color("#9a9688"))
	# 借金（右上）
	var right := vp.x - pad - (120.0 if touch_mode else 0.0)
	var open := run.debt.open_contracts()
	var dcol := Color("#e5484d") if not run.debt.defaulted().is_empty() else (Color("#f2b544") if not open.is_empty() else Color("#9a9688"))
	_s(Vector2(0, pad + 20), "借金 %d秒" % roundi(run.debt.total()) if not open.is_empty() else "借金なし", 19, dcol, HORIZONTAL_ALIGNMENT_RIGHT, right)
	for i in open.size():
		var c: Dictionary = open[i]
		_s(Vector2(0, pad + 44 + i * 20), "#%d %d秒 · %s" % [c.uid, roundi(c.outstanding), run.debt.due_text(c, run.room_index)], 14, Color("#e5484d") if c.state == "defaulted" else Color("#cdbf9c"), HORIZONTAL_ALIGNMENT_RIGHT, right)
	# スキル（PCのみ。スマホはタッチボタンに表示）
	if not touch_mode:
		var sw := 170.0
		var sh := 64.0
		var gap := 10.0
		var x0 := vp.x / 2.0 - (sw * 3.0 + gap * 2.0) / 2.0
		var y0 := vp.y - sh - pad
		for i in 3:
			var sk: Dictionary = run.D.skills[i]
			var cost := run.skill_cost(i)
			var ok := run.ledger.can_pay(cost)
			var r := Rect2(x0 + i * (sw + gap), y0, sw, sh)
			draw_rect(r, Color(0.09, 0.11, 0.14, 0.92))
			var cd: float = room.p.skill_cd[i] / float(sk.cd)
			if cd > 0.0:
				draw_rect(Rect2(r.position.x, r.position.y + sh * (1.0 - cd), sw, sh * cd), Color(0, 0, 0, 0.55))
			var sel := room.p.slot == i
			draw_rect(r, Color("#f2b544") if sel else Color("#2a2f3b"), false, 2.0 if sel else 1.0)
			_s(r.position + Vector2(12, 26), sk.name, 19, Color("#efe7d6") if ok else Color("#6b675d"))
			_s(r.position + Vector2(12, 52), "−%ds" % cost, 16, Color("#f2b544") if ok else Color("#e5484d"))
			_s(r.position + Vector2(sw - 22, 20), str(i + 1), 14, Color("#9a9688"))
	# トースト
	var ty := vp.y * (0.3 if touch_mode else 0.25)
	for tt in toasts:
		var a := minf(1.0, tt.t * 2.0)
		var fs := 18
		var tw := FONT.get_string_size(tt.text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x + 28.0
		draw_rect(Rect2(vp.x / 2.0 - tw / 2.0, ty - 22, tw, 30), Color(0.05, 0.06, 0.08, 0.85 * a))
		var kc: Color = {"debt": Color("#e5484d"), "warn": Color("#f2b544"), "good": Color("#5fe0c8")}.get(tt.kind, Color("#efe7d6"))
		_s(Vector2(0, ty), tt.text, fs, Color(kc, a), HORIZONTAL_ALIGNMENT_CENTER, vp.x)
		ty += 36.0
	if Settings.debug_hud:
		var lines := ["FPS %d" % roundi(fps), "room %s" % room.id, "game %.1fs  real %ds" % [run.elapsed, Time.get_ticks_msec() / 1000],
			"contracts %s" % " ".join(run.debt.contracts.map(func(c: Dictionary) -> String: return "#%d:%s@%d" % [c.uid, c.state, c.due_room])),
			"seed %d  log %d" % [run.seed_value, run.ledger.log.size()], "platform %s" % ("web" if Platform.is_web else OS.get_name())]
		for i in lines.size():
			_s(Vector2(pad, pad + 80 + i * 18), lines[i], 14, Color("#7be08a"))
