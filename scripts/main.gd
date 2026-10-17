extends Node
## ゲーム全体の状態機械と配線。
##   TITLE → ROOM ⇄ (REWARD / BOOK / PAUSE) → MAP → (SHOP / CONTRACT / REST / ROOM) … → RESULT
## ROOM 以外ではシミュレーションを進めない ＝ 時計（寿命の減少）と敵AIは止まる。

enum State { TITLE, ROOM, MAP, SHOP, CONTRACT, REST, REWARD, BOOK, PAUSE, RESULT }

var state := State.TITLE
var data: DataLoader
var run: RunState
var room: RoomSim
var current_seed := 0
var picked_contract: Variant = null
var end_timer := 0.0
var beat_t := 0.0

var router: InputRouter
var view: RoomView
var hud: Hud
var touch: TouchControls
var menus: Menus
var sfx: Sfx


func _ready() -> void:
	randomize()
	data = DataLoader.load_file()
	if not data.is_valid():
		var l := Label.new()
		l.text = "データ定義にエラーがあります:\n" + "\n".join(data.errors)
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		l.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		add_child(l)
		return
	router = InputRouter.new()
	add_child(router)
	view = RoomView.new()
	view.router = router
	add_child(view)
	var layer := CanvasLayer.new()
	add_child(layer)
	hud = Hud.new()
	layer.add_child(hud)
	touch = TouchControls.new()
	touch.router = router
	touch.room_ref = func() -> RoomSim: return room
	touch.run_ref = func() -> RunState: return run
	layer.add_child(touch)
	menus = Menus.new()
	layer.add_child(menus)
	sfx = Sfx.new()
	add_child(sfx)

	router.dash_requested.connect(func() -> void: if _in_room(): room.try_dash(router.move_vector()))
	router.slot_selected.connect(func(i: int) -> void: if _in_room(): room.p.slot = i)
	router.skill_requested.connect(func(i: int, sp: Variant) -> void: if _in_room(): room.use_skill(i, view.screen_to_world(sp) if sp != null else null))
	router.interact_requested.connect(func() -> void:
		if _in_room() and room.cleared and room.kind != "boss" and room.p.pos.distance_to(room.door_rect().get_center()) < 220.0:
			_open_map())
	router.book_toggled.connect(func() -> void:
		if state == State.ROOM:
			_set_state(State.BOOK)
			menus.show_book(run, func() -> void: _set_state(State.ROOM))
		elif state == State.BOOK:
			_set_state(State.ROOM))
	router.pause_toggled.connect(func() -> void:
		if state == State.ROOM:
			_set_state(State.PAUSE)
			menus.show_pause(func() -> void: _set_state(State.ROOM), _to_title)
		elif state in [State.PAUSE, State.BOOK]:
			_set_state(State.ROOM))
	router.debug_toggled.connect(func() -> void:
		Settings.debug_hud = not Settings.debug_hud
		Settings.save())
	router.hotkey.connect(func(i: int) -> void: if state in [State.MAP, State.REWARD, State.REST]: menus.press_hotkey(i))
	router.touch_mode_changed.connect(_on_touch_mode)
	menus.play_pressed.connect(_start)
	get_window().size_changed.connect(_apply_ui_scale)
	get_window().focus_exited.connect(func() -> void: if state == State.ROOM: router.pause_toggled.emit())

	router.set_touch_mode(Platform.prefers_touch())
	_on_touch_mode(router.touch_mode)
	current_seed = randi() % 1000000
	_to_title()
	_dev_hooks()


func _in_room() -> bool:
	return state == State.ROOM and room != null and run != null and run.result == ""


# ------------------------------------------------------------------ loop
func _physics_process(_delta: float) -> void:
	if run == null:
		return
	if state == State.ROOM and run.result == "":
		var aim: Variant = null if router.touch_mode else view.screen_to_world(router.mouse_pos)
		room.step(RoomSim.STEP, router.move_vector(), aim, router.shoot_held)
		_drain()
		if room.just_cleared and run.D.nodes[room.kind].get("reward", false):
			_open_reward()
		elif room.just_cleared and room.kind != "boss":
			hud.toast("扉が開いた →", "good")
		elif room.at_door():
			sfx.play("door")
			_open_map()
		if run.ledger.time < 30.0 and run.result == "":
			beat_t -= RoomSim.STEP
			if beat_t <= 0.0:
				beat_t = maxf(0.35, run.ledger.time / 30.0)
				sfx.play("beat")
	if run.result != "" and state != State.RESULT:
		if state == State.ROOM:
			room.step(RoomSim.STEP, Vector2.ZERO, null, false)   # 撃破・死亡演出を少しだけ流す
			_drain()
		end_timer -= RoomSim.STEP
		if end_timer <= 0.0:
			_show_result()
	hud.clock_running = state == State.ROOM and run.result == ""


func _drain() -> void:
	for e in room.drain_events():
		match e.type:
			"fx": view.add_fx(e)
			"sfx": sfx.play(e.name)
			"toast": hud.toast(e.text, e.get("kind", "muted"))
			"shake":
				if Settings.shake:
					view.add_shake(e.amount)
	for n in run.ledger.notices:
		hud.toast(n.text, n.kind)
	run.ledger.notices.clear()


# ------------------------------------------------------------------ states
func _set_state(s: State) -> void:
	state = s
	router.gameplay_enabled = s == State.ROOM
	touch.reset()
	if s == State.ROOM:
		menus.hide_all()
		get_viewport().gui_release_focus()
	hud.visible = run != null and room != null and s != State.TITLE
	touch.visible = router.touch_mode and s == State.ROOM


func _start(seed_value: int) -> void:
	current_seed = seed_value
	run = RunState.new(data, seed_value)
	end_timer = 1.4
	_enter_room("battle")
	run.route.append("battle")
	hud.toast("時計が動き出した。敵を倒して寿命を奪え", "warn", 3.0)


func _enter_room(kind: String) -> void:
	if room:
		room.dispose()
	room = RoomSim.new(run, kind)
	view.room = room
	view.clear()
	hud.run = run
	hud.room = room
	_set_state(State.ROOM)
	if kind == "boss":
		hud.toast("時間管理局長：「その寿命、国家に返してもらう」", "debt", 3.0)
		sfx.play("boss")


func _to_title() -> void:
	if room:
		room.dispose()
	run = null
	room = null
	view.room = null
	_set_state(State.TITLE)
	menus.show_title(current_seed)


func _open_map() -> void:
	_set_state(State.MAP)
	menus.show_map(run, run.next_choices(), _on_pick_node)


## 部屋遷移: RunState.enter_node が「部屋番号 → 満期処理（1回だけ）」を行い、その後に次の区画を開く
func _on_pick_node(kind: String) -> void:
	if state != State.MAP:
		return
	var notices := run.enter_node(kind)
	for n in notices:
		hud.toast(n.text, "warn" if n.kind == "pay" else "debt", 3.2)
	if notices.any(func(n: Dictionary) -> bool: return n.kind == "pay"):
		sfx.play("pay")
	if run.result != "":
		return
	var nd: Dictionary = run.D.nodes[kind]
	if nd.get("combat", false):
		_enter_room(kind)
	elif kind == "shop" or kind == "premium":
		if kind == "premium" and not run.premium_rested:
			run.premium_rested = true
			run.rest()
			hud.toast("高級区画で休息：+%d秒" % int(run.D.rest_gain), "good")
		_set_state(State.SHOP)
		_show_shop(kind == "premium")
	elif kind == "contract":
		picked_contract = null
		_set_state(State.CONTRACT)
		_show_contract()
	elif kind == "rest":
		_set_state(State.REST)
		menus.show_rest(run, func() -> void:
			run.rest()
			sfx.play("gain")
			_open_map(),
			func(c: Dictionary) -> void:
				if run.debt.repay_early(c, run.ledger):
					sfx.play("pay")
					hud.toast("#%d を早期返済" % c.uid, "good")
					_open_map())


func _show_shop(premium: bool) -> void:
	menus.show_shop(run, premium, func(item: Dictionary) -> void:
		if run.buy(item, premium):
			sfx.play("pay")
			hud.toast("%s を購入" % item.name, "good")
		_show_shop(premium),
		_open_map)


func _show_contract() -> void:
	menus.show_contract(run, picked_contract,
		func(c: Dictionary) -> void:
			picked_contract = c
			_show_contract(),
		func() -> void:
			if picked_contract != null and run.debt.sign(picked_contract, run.room_index, run.ledger):
				sfx.play("loan")
				hud.toast("%s に署名：+%d秒" % [picked_contract.name, int(picked_contract.principal)], "warn")
				picked_contract = null
			_show_contract(),
		_open_map)


func _open_reward() -> void:
	_set_state(State.REWARD)
	menus.show_reward(run, run.roll_rewards(), func(id: String) -> void:
		run.apply_reward(id)
		_set_state(State.ROOM)
		hud.toast("扉が開いた →", "good"))


func _show_result() -> void:
	_set_state(State.RESULT)
	menus.show_result(run, func() -> void: _start(current_seed), func() -> void: _start(randi() % 1000000), _to_title)


# ------------------------------------------------------------------ touch / scale
func _on_touch_mode(on: bool) -> void:
	view.touch_mode = on
	hud.touch_mode = on
	menus.set_touch_mode(on)
	touch.visible = on and state == State.ROOM
	_apply_ui_scale()


## スマホでは論理解像度の短辺を約600にして、文字とボタンを指で扱える大きさにする
func _apply_ui_scale() -> void:
	var win := get_window()
	if not router.touch_mode:
		win.content_scale_factor = 1.0
		return
	var phys := Vector2(win.size)
	var base_fit := minf(phys.x / 1920.0, phys.y / 1080.0)
	win.content_scale_factor = clampf(minf(phys.x, phys.y) / 600.0 / maxf(base_fit, 0.01), 1.0, 4.0)


## 開発用: `godot --path . -- --shot=out.png [--play] [--touch] [--frames=N] [--screen=map|contract|shop]`
func _dev_hooks() -> void:
	var args := {}
	for a in OS.get_cmdline_user_args():
		var kv := a.trim_prefix("--").split("=", true, 1)
		args[kv[0]] = kv[1] if kv.size() > 1 else "1"
	if not args.has("shot"):
		return
	if args.has("touch"):
		router.set_touch_mode(true)
	if args.has("play"):
		_start(2026)
		run.debt.sign(data.d.contracts[1], 0, run.ledger)
	for i in int(args.get("frames", "30")):
		await get_tree().process_frame
		if args.has("play") and state == State.REWARD:
			menus.press_hotkey(0)
	match args.get("screen", ""):
		"map": _open_map()
		"contract":
			_set_state(State.CONTRACT)
			picked_contract = data.d.contracts[0]
			_show_contract()
		"shop":
			_set_state(State.SHOP)
			_show_shop(false)
	await get_tree().process_frame
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(args.shot)
	print("screenshot saved: ", args.shot)
	get_tree().quit()
