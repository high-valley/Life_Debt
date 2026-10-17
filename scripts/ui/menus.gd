class_name Menus
extends Control
## 戦闘以外の画面（タイトル / ルート選択 / ショップ / 契約 / 休憩 / 報酬 / 契約書 / ポーズ / 設定 / リザルト）。
## これらの画面が出ている間は Main がシミュレーションを進めないので、時計は止まる。

signal play_pressed(seed_value: int)

const C_INK := Color("#0e1015")
const C_SLATE := Color("#181b23")
const C_EDGE := Color("#2a2f3b")
const C_PAPER := Color("#efe7d6")
const C_PAPER_INK := Color("#24201a")
const C_MUTED := Color("#9a9688")
const C_BRASS := Color("#f2b544")
const C_SHARD := Color("#5fe0c8")
const C_DEBT := Color("#e5484d")

var screens := {}            # name -> {ov, box}
var seed_edit: LineEdit
var kbd_help: Label
var touch_help: Label
var _settings_back := ""
var _hotkey_buttons: Array = []
var vol_slider: HSlider
var shake_check: CheckButton
var flash_check: CheckButton
var debug_check: CheckButton


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	theme = _theme()
	for name in ["title", "map", "shop", "contract", "rest", "reward", "book", "pause", "settings", "result"]:
		screens[name] = _overlay(name == "contract")
	_build_title()
	_build_settings()
	hide_all()


# ------------------------------------------------------------------ building blocks
func _box(bg: Color, edge: Color, pad := 16, radius := 4) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.border_color = edge
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(radius)
	sb.set_content_margin_all(pad)
	return sb


func _theme() -> Theme:
	var th := Theme.new()
	th.default_font_size = 22
	th.set_stylebox("normal", "Button", _box(C_EDGE, Color("#3a4150"), 14))
	th.set_stylebox("focus", "Button", _box(C_EDGE, C_SHARD, 14))
	th.set_stylebox("hover", "Button", _box(C_EDGE, C_BRASS, 14))
	th.set_stylebox("pressed", "Button", _box(Color("#333a48"), C_BRASS, 14))
	th.set_stylebox("disabled", "Button", _box(Color("#16191f"), C_EDGE, 14))
	th.set_color("font_color", "Button", C_PAPER)
	th.set_color("font_hover_color", "Button", C_PAPER)
	th.set_color("font_disabled_color", "Button", Color("#5d5a52"))
	th.set_color("font_color", "Label", C_PAPER)
	th.set_stylebox("normal", "LineEdit", _box(C_INK, C_EDGE, 10))
	return th


func _overlay(paper: bool) -> Dictionary:
	var ov := ColorRect.new()
	ov.color = Color(C_INK, 0.84)
	ov.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	ov.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(ov)
	var scroll := ScrollContainer.new()
	scroll.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	ov.add_child(scroll)
	var center := CenterContainer.new()
	center.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	center.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.add_child(center)
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", _box(C_PAPER if paper else C_SLATE, Color("#c9bfa8") if paper else C_EDGE, 30))
	center.add_child(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 14)
	panel.add_child(box)
	return {"ov": ov, "box": box, "panel": panel, "paper": paper}


func _clear(name: String) -> VBoxContainer:
	var box: VBoxContainer = screens[name].box
	for c in box.get_children():
		c.queue_free()
	var w := minf(900.0, get_viewport_rect().size.x - 40.0)
	screens[name].panel.custom_minimum_size = Vector2(w, 0)
	return box


func _label(text: String, size := 20, col := C_PAPER, wrap := true) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", col)
	if wrap:
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return l


func _button(text: String, on_press: Callable, primary := false, paper := false) -> Button:
	var b := Button.new()
	b.text = text
	if primary:
		b.add_theme_stylebox_override("normal", _box(C_PAPER_INK if paper else C_BRASS, C_PAPER_INK if paper else C_BRASS, 14))
		b.add_theme_stylebox_override("hover", _box(C_PAPER_INK if paper else C_BRASS.lightened(0.1), C_SHARD, 14))
		b.add_theme_color_override("font_color", C_PAPER if paper else Color("#1b1407"))
		b.add_theme_color_override("font_hover_color", C_PAPER if paper else Color("#1b1407"))
	elif paper:
		b.add_theme_stylebox_override("normal", _box(Color("#fffaf0"), Color("#b9ad92"), 14))
		b.add_theme_color_override("font_color", C_PAPER_INK)
		b.add_theme_color_override("font_hover_color", C_PAPER_INK)
	b.pressed.connect(on_press)
	return b


## 選択肢カード（ボタン）。tone: "" / "risk" / "safe" / "paper"
func _card(head: String, title: String, body: String, price: String, on_press: Callable, disabled := false, tone := "") -> Button:
	var b := Button.new()
	b.text = ("%s\n" % head if head != "" else "") + title + ("  %s" % price if price != "" else "") + ("\n%s" % body if body != "" else "")
	b.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	b.custom_minimum_size = Vector2(250, 110)
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	b.disabled = disabled
	var edge := C_EDGE
	if tone == "risk":
		edge = C_DEBT.darkened(0.2)
	elif tone == "safe":
		edge = C_SHARD.darkened(0.3)
	var bg := Color("#fffaf0") if tone == "paper" else C_INK
	b.add_theme_stylebox_override("normal", _box(bg, Color("#cfc4ab") if tone == "paper" else edge, 14))
	b.add_theme_stylebox_override("hover", _box(bg, C_BRASS, 14))
	b.add_theme_stylebox_override("focus", _box(bg, C_SHARD, 14))
	b.add_theme_font_size_override("font_size", 18)
	if tone == "paper":
		b.add_theme_color_override("font_color", C_PAPER_INK)
		b.add_theme_color_override("font_hover_color", C_PAPER_INK)
	b.pressed.connect(on_press)
	return b


func _grid(parent: Control, cols := 3) -> GridContainer:
	var g := GridContainer.new()
	g.columns = cols if get_viewport_rect().size.x > 900 else 1
	g.add_theme_constant_override("h_separation", 12)
	g.add_theme_constant_override("v_separation", 12)
	parent.add_child(g)
	return g


func _row(parent: Control) -> HFlowContainer:
	var r := HFlowContainer.new()
	r.add_theme_constant_override("h_separation", 10)
	r.add_theme_constant_override("v_separation", 10)
	parent.add_child(r)
	return r


func _show(name: String) -> void:
	hide_all()
	screens[name].ov.show()
	_hotkey_buttons = []


func hide_all() -> void:
	for s in screens.values():
		s.ov.hide()


func is_open(name: String) -> bool:
	return screens[name].ov.visible


func press_hotkey(i: int) -> void:
	if i < _hotkey_buttons.size() and not _hotkey_buttons[i].disabled:
		_hotkey_buttons[i].pressed.emit()


static func bal_line(run: RunState) -> String:
	return "残寿命 %s（%d秒）  上限 %s  借金 %d秒" % [TimeLedger.fmt(run.ledger.time), ceili(run.ledger.time), TimeLedger.fmt(run.ledger.max_time), roundi(run.debt.total())]


# ------------------------------------------------------------------ title / settings
func _build_title() -> void:
	var box: VBoxContainer = screens.title.box
	screens.title.panel.custom_minimum_size = Vector2(minf(900.0, get_viewport_rect().size.x - 40.0), 0)
	box.add_child(_label("PROTOTYPE · GODOT %s" % Engine.get_version_info().string.split(".stable")[0], 15, C_BRASS))
	var t := RichTextLabel.new()
	t.bbcode_enabled = true
	t.fit_content = true
	t.scroll_active = false
	t.add_theme_font_size_override("normal_font_size", 80)
	t.text = "LIFE [color=#f2b544]DEBT[/color]"
	box.add_child(t)
	box.add_child(_label("時債都市では、残りの寿命が通貨になる。撃てば減り、奪えば増え、足りなければ未来の自分から借りる。返せなければ、回収人が来る。", 20, C_MUTED))
	var row := _row(box)
	row.add_child(_label("Seed", 18, C_MUTED, false))
	seed_edit = LineEdit.new()
	seed_edit.custom_minimum_size = Vector2(200, 0)
	row.add_child(seed_edit)
	var buttons := _row(box)
	buttons.add_child(_button("契約して始める", func() -> void: play_pressed.emit(int(seed_edit.text) if seed_edit.text.is_valid_int() else 0), true))
	buttons.add_child(_button("Settings", func() -> void: open_settings("title")))
	if Platform.can_quit():
		buttons.add_child(_button("Quit", func() -> void: get_tree().quit()))
	kbd_help = _label("WASD 移動 / Space ダッシュ / 左クリック長押し 通常弾（無料）/ 右クリック・Q 寿命スキル / 1・2・3 スキル選択 / E・扉に触れる 次へ / Tab 契約書 / Esc・P ポーズ / F3 デバッグ", 16, C_MUTED)
	touch_help = _label("左側ドラッグ 移動 / 通常弾は自動 / 右下ボタン 寿命スキル・ダッシュ / 右上 契約書・ポーズ / 扉に触れると次へ / 横向き推奨", 16, C_MUTED)
	box.add_child(kbd_help)
	box.add_child(touch_help)


func set_touch_mode(on: bool) -> void:
	kbd_help.visible = not on
	touch_help.visible = on


func show_title(seed_value: int) -> void:
	_show("title")
	seed_edit.text = str(seed_value)


func _build_settings() -> void:
	var box: VBoxContainer = screens.settings.box
	screens.settings.panel.custom_minimum_size = Vector2(minf(700.0, get_viewport_rect().size.x - 40.0), 0)
	box.add_child(_label("Settings", 34))
	box.add_child(_label("音量", 18, C_MUTED))
	vol_slider = HSlider.new()
	vol_slider.max_value = 1.0
	vol_slider.step = 0.05
	vol_slider.custom_minimum_size = Vector2(0, 30)
	box.add_child(vol_slider)
	shake_check = CheckButton.new()
	shake_check.text = "被弾時の画面揺れ"
	box.add_child(shake_check)
	flash_check = CheckButton.new()
	flash_check.text = "残寿命が少ない時の点滅・脈動"
	box.add_child(flash_check)
	debug_check = CheckButton.new()
	debug_check.text = "デバッグHUD（部屋ID・時間・契約キュー・seed）"
	box.add_child(debug_check)
	box.add_child(_button("戻る", func() -> void:
		Settings.volume = vol_slider.value
		Settings.shake = shake_check.button_pressed
		Settings.flash = flash_check.button_pressed
		Settings.debug_hud = debug_check.button_pressed
		Settings.save()
		_show(_settings_back), true))


func open_settings(back: String) -> void:
	_settings_back = back
	vol_slider.value = Settings.volume
	shake_check.button_pressed = Settings.shake
	flash_check.button_pressed = Settings.flash
	debug_check.button_pressed = Settings.debug_hud
	_show("settings")


# ------------------------------------------------------------------ run screens
func show_map(run: RunState, choices: Array, on_pick: Callable) -> void:
	var box := _clear("map")
	_show("map")
	var idx := run.room_index + 1
	var D := run.D
	box.add_child(_label("最深部" if idx >= int(D.rooms_total) else "エリア %d · 区画 %d / %d" % [mini(3, idx / 3 + 1), idx + 1, int(D.rooms_total) + 1], 15, C_BRASS))
	box.add_child(_label("次の区画を選ぶ", 30))
	var info := bal_line(run)
	var due := run.debt.open_contracts().filter(func(c: Dictionary) -> bool: return c.state == "active" and c.due_room <= idx)
	if not due.is_empty():
		info += "\n⚠ 次の部屋で満期: " + "、".join(due.map(func(c: Dictionary) -> String: return "#%d %d秒" % [c.uid, roundi(c.outstanding)]))
	if idx >= int(D.rooms_total) and not run.debt.open_contracts().is_empty():
		info += "\n⚠ 局の入口で全契約が満期になる"
	box.add_child(_label(info, 17, C_MUTED))
	var g := _grid(box, choices.size())
	for node in choices:
		var nd: Dictionary = D.nodes[node.kind]
		var head := "戦闘" if nd.get("combat", false) else "非戦闘・時計停止"
		var disabled := false
		if node.get("gate", false):
			disabled = not run.gate_open()
			head = "通行不可：残寿命 %d秒 未満" % int(D.time.gate_threshold) if disabled else "階級ゲート：通過の瞬間だけ判定"
		var kind: String = node.kind
		var b := _card(head, "%s %s" % [nd.icon, nd.name], nd.desc, "", func() -> void: on_pick.call(kind), disabled,
			"risk" if nd.get("risk", false) else ("safe" if nd.get("safe", false) else ""))
		g.add_child(b)
		_hotkey_buttons.append(b)
	for b in _hotkey_buttons:
		if not b.disabled:
			b.grab_focus()
			break


func show_shop(run: RunState, premium: bool, on_buy: Callable, on_leave: Callable) -> void:
	var box := _clear("shop")
	_show("shop")
	box.add_child(_label("Premium district · 3割引＋休息" if premium else "Shop", 15, C_BRASS))
	box.add_child(_label("高級区画の時計商" if premium else "闇時計店", 30))
	box.add_child(_label("価格はすべて寿命（秒）。店の中では時計は止まっている。", 17, C_MUTED))
	box.add_child(_label(bal_line(run), 17, C_BRASS))
	var g := _grid(box, 2)
	for item in run.D.shop:
		var price := run.shop_price(item, premium)
		var ok := run.ledger.can_pay(price)
		var it: Dictionary = item
		g.add_child(_card("所持 %d" % run.mod("shop_" + item.id), item.name, "%s\n購入後 %s" % [item.desc, TimeLedger.fmt(run.ledger.time - price) if ok else "— 払えない"],
			"%d秒" % price, func() -> void: on_buy.call(it), not ok))
	_row(box).add_child(_button("店を出る", on_leave, true))


func show_contract(run: RunState, picked: Variant, on_pick: Callable, on_sign: Callable, on_leave: Callable) -> void:
	var box := _clear("contract")
	_show("contract")
	box.add_child(_label("寿命銀行 · 融資契約書", 15, Color("#8a5a10")))
	box.add_child(_label("未来の寿命を借りる", 30, C_PAPER_INK))
	box.add_child(_label("返済は満期の部屋に入った瞬間、残寿命から自動で引き落とされる。払えなければ回収人が派遣され、返済完了まで追跡する。", 17, Color("#5b5446")))
	box.add_child(_label(bal_line(run) + "  契約 %d/%d件" % [run.debt.open_contracts().size(), run.debt.max_open], 17, Color("#8a5a10")))
	var full := not run.debt.can_sign()
	var g := _grid(box, 3)
	for c in run.D.contracts:
		var cc: Dictionary = c
		var sel: bool = picked != null and picked.id == c.id
		g.add_child(_card("利息 %d%%%s" % [roundi((float(c.repay) / float(c.principal) - 1.0) * 100.0), "  ● 選択中" if sel else ""], c.name,
			"今すぐ +%d秒 / %d部屋後に −%d秒" % [int(c.principal), int(c.due), int(c.repay)], "", func() -> void: on_pick.call(cc), full, "paper"))
	if full:
		box.add_child(_label("同時に結べる契約は%d件まで" % run.debt.max_open, 18, C_DEBT))
	elif picked != null:
		var after: float = run.ledger.time + float(picked.principal)
		var cut := maxf(0.0, after - run.ledger.max_time)
		var terms := "受取  +%d秒 → 残 %s%s\n返済  %d秒（元本 %d ＋ 利息 %d）\n満期  %d部屋後の入口（区画 %d）\n不履行時  回収人が戦闘部屋に出現し追跡。ドロップの%d%%を差押え。回収人撃破で清算" % [
			int(picked.principal), TimeLedger.fmt(minf(after, run.ledger.max_time)), "（%d秒 切り捨て）" % roundi(cut) if cut > 0 else "",
			int(picked.repay), int(picked.principal), int(picked.repay) - int(picked.principal), int(picked.due), run.room_index + int(picked.due) + 1, roundi(run.debt.seize_rate * 100)]
		box.add_child(_label(terms, 17, C_PAPER_INK))
	var row := _row(box)
	var sign := _button("署名する", on_sign, true, true)
	sign.disabled = picked == null or full
	row.add_child(sign)
	row.add_child(_button("借りずに出る", on_leave, false, true))


func show_rest(run: RunState, on_rest: Callable, on_repay: Callable) -> void:
	var box := _clear("rest")
	_show("rest")
	box.add_child(_label("Rest", 15, C_BRASS))
	box.add_child(_label("配給所の裏で一息つく", 30))
	box.add_child(_label("どちらか1つを選べる。  " + bal_line(run), 17, C_MUTED))
	var g := _grid(box, 2)
	var b := _card("休息", "+%d秒" % int(run.D.rest_gain), "配給の残りを分けてもらう", "", on_rest, false, "safe")
	g.add_child(b)
	_hotkey_buttons.append(b)
	for c in run.debt.open_contracts().filter(func(c: Dictionary) -> bool: return c.state == "active"):
		var cc: Dictionary = c
		var e := _card("契約 #%d · %s" % [c.uid, run.debt.due_text(c, run.room_index)], "早期返済", "%s の %d秒 を今払う" % [c.name, roundi(c.outstanding)],
			"%d秒" % roundi(c.outstanding), func() -> void: on_repay.call(cc), not run.ledger.can_pay(c.outstanding))
		g.add_child(e)
		_hotkey_buttons.append(e)
	b.grab_focus()


func show_reward(run: RunState, picks: Array, on_pick: Callable) -> void:
	var box := _clear("reward")
	_show("reward")
	box.add_child(_label("Room cleared", 15, C_BRASS))
	box.add_child(_label("戦利品を1つ選ぶ", 30))
	var g := _grid(box, 3)
	for i in picks.size():
		var r: Dictionary = picks[i]
		var id: String = r.id
		var b := _card("[%d] 所持 %d" % [i + 1, run.mod(r.id)], r.name, r.desc, "", func() -> void: on_pick.call(id))
		g.add_child(b)
		_hotkey_buttons.append(b)
	if not _hotkey_buttons.is_empty():
		_hotkey_buttons[0].grab_focus()


func show_book(run: RunState, on_close: Callable) -> void:
	var box := _clear("book")
	_show("book")
	box.add_child(_label("Contract book · 時計停止中", 15, C_BRASS))
	box.add_child(_label("契約書", 30))
	box.add_child(_label(bal_line(run) + "  区画 %d" % (run.room_index + 1), 17, C_BRASS))
	if run.debt.contracts.is_empty():
		box.add_child(_label("まだ契約はない。寿命銀行の区画で借りられる。", 17, C_MUTED))
	for c in run.debt.contracts:
		var col := C_DEBT if c.state == "defaulted" else (C_MUTED if c.state in ["paid", "settled"] else C_PAPER)
		box.add_child(_label("#%d %s  %s  受取 %d / 返済 %d  — %s" % [c.uid, c.name, "残 %d秒" % roundi(c.outstanding) if c.state in ["active", "defaulted"] else "", int(c.principal), int(c.repay), run.debt.due_text(c, run.room_index)], 17, col))
	var mods: Array = []
	for k in run.mods:
		if not k.begins_with("shop_"):
			var name: String = k
			for r in run.D.rewards:
				if r.id == k:
					name = r.name
			mods.append("%s ×%d" % [name, run.mods[k]])
	var costs: Array = []
	for i in 3:
		costs.append("%s %d秒" % [run.D.skills[i].name, run.skill_cost(i)])
	box.add_child(_label("強化: %s\nスキルコスト: %s" % ["、".join(mods) if not mods.is_empty() else "なし", "・".join(costs)], 16, C_MUTED))
	_row(box).add_child(_button("閉じる", on_close, true))


func show_pause(on_resume: Callable, on_retire: Callable) -> void:
	var box := _clear("pause")
	_show("pause")
	box.add_child(_label("ポーズ中", 34))
	box.add_child(_label("寿命の減少も敵の動きも止まっている。", 17, C_MUTED))
	var row := _row(box)
	var r := _button("再開", on_resume, true)
	row.add_child(r)
	row.add_child(_button("Settings", func() -> void: open_settings("pause")))
	row.add_child(_button("タイトルへ戻る", on_retire))
	r.grab_focus()


func show_result(run: RunState, on_same: Callable, on_new: Callable, on_title: Callable) -> void:
	var box := _clear("result")
	_show("result")
	var win := run.result == "win"
	box.add_child(_label("Run result", 15, C_BRASS))
	box.add_child(_label("勝利：時計は止まった" if win else "敗北：寿命が尽きた", 34, C_BRASS if win else C_DEBT))
	var reason := run.reason
	if not run.debt.open_contracts().is_empty():
		reason += "（未返済の借金 %d秒 が残った）" % roundi(run.debt.total())
	box.add_child(_label(reason, 17, C_MUTED))
	var g := GridContainer.new()
	g.columns = 4 if get_viewport_rect().size.x > 900 else 2
	g.add_theme_constant_override("h_separation", 28)
	g.add_theme_constant_override("v_separation", 8)
	box.add_child(g)
	var rows := [["生存時間（戦闘中）", TimeLedger.fmt(run.elapsed)], ["累積獲得寿命", "%d秒" % roundi(run.ledger.gained)], ["支払い総額", "%d秒" % roundi(run.ledger.spent)],
		["最大借金額", "%d秒" % roundi(run.debt.max_debt)], ["契約回数", str(run.debt.count)], ["到達区画", "%d / %d（エリア%d）" % [run.room_index + 1, int(run.D.rooms_total) + 1, run.area()]],
		["上限で切り捨て", "%d秒" % roundi(run.ledger.truncated)], ["seed", str(run.seed_value)]]
	for r in rows:
		var v := VBoxContainer.new()
		v.add_child(_label(r[1], 26, C_PAPER, false))
		v.add_child(_label(r[0], 14, C_MUTED, false))
		g.add_child(v)
	var row := _row(box)
	var same := _button("同じseedで再挑戦", on_same, true)
	row.add_child(same)
	row.add_child(_button("新しいseedで挑戦", on_new))
	row.add_child(_button("タイトル", on_title))
	same.grab_focus()
