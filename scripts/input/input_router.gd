class_name InputRouter
extends Node
## キーボード・マウス・タッチを「プレイヤーの意図」に変換する層。
## ゲーム側は入力デバイスを区別せず、ここのシグナルと move_vector() / aim を使う。

signal dash_requested
signal slot_selected(index: int)
signal skill_requested(index: int, screen_pos: Variant)   # screen_pos が null ならオートエイム
signal interact_requested
signal book_toggled
signal pause_toggled
signal debug_toggled
signal hotkey(index: int)                                   # メニューの1/2/3選択
signal touch_mode_changed(on: bool)

const ACTIONS := {
	"move_left": [KEY_A, KEY_LEFT], "move_right": [KEY_D, KEY_RIGHT],
	"move_up": [KEY_W, KEY_UP], "move_down": [KEY_S, KEY_DOWN],
	"dash": [KEY_SPACE], "slot_1": [KEY_1], "slot_2": [KEY_2], "slot_3": [KEY_3],
	"use_skill": [KEY_Q], "interact": [KEY_E], "book": [KEY_TAB], "pause": [KEY_ESCAPE, KEY_P], "debug_hud": [KEY_F3],
}

var gameplay_enabled := false
var touch_mode := false
var touch_move := Vector2.ZERO
var mouse_pos := Vector2.ZERO
var mouse_inside := false
var shoot_held := false
var slot := 0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for action in ACTIONS:
		if not InputMap.has_action(action):
			InputMap.add_action(action)
			for key in ACTIONS[action]:
				var ev := InputEventKey.new()
				ev.physical_keycode = key
				InputMap.action_add_event(action, ev)


func move_vector() -> Vector2:
	if touch_move.length() > 0.0:
		return touch_move
	return Input.get_vector("move_left", "move_right", "move_up", "move_down")


func set_touch_mode(on: bool) -> void:
	if on == touch_mode:
		return
	touch_mode = on
	if on:
		mouse_inside = false
		shoot_held = false
	touch_mode_changed.emit(on)


static func is_real_mouse(event: InputEvent) -> bool:
	return event.device != InputEvent.DEVICE_ID_EMULATION


func _input(event: InputEvent) -> void:
	if event is InputEventScreenTouch or event is InputEventScreenDrag:
		set_touch_mode(true)
	elif event is InputEventMouseMotion and is_real_mouse(event) and event.relative.length() > 3.0:
		set_touch_mode(false)
	elif event is InputEventKey and event.pressed and not event.echo:
		set_touch_mode(false)
	if event is InputEventMouseButton and is_real_mouse(event) and event.button_index == MOUSE_BUTTON_LEFT and not event.pressed:
		shoot_held = false


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("pause"):
		pause_toggled.emit()
		return
	if event.is_action_pressed("debug_hud"):
		debug_toggled.emit()
		return
	if event.is_action_pressed("book"):
		book_toggled.emit()
		return
	for i in 3:
		if event.is_action_pressed("slot_%d" % (i + 1)):
			hotkey.emit(i)
			if gameplay_enabled:
				slot = i
				slot_selected.emit(i)
			return
	if not gameplay_enabled:
		return
	if event.is_action_pressed("dash"):
		dash_requested.emit()
	elif event.is_action_pressed("use_skill"):
		skill_requested.emit(slot, mouse_pos if not touch_mode else null)
	elif event.is_action_pressed("interact"):
		interact_requested.emit()
	elif event is InputEventMouseMotion and is_real_mouse(event):
		mouse_pos = event.position
		mouse_inside = true
	elif event is InputEventMouseButton and event.pressed and is_real_mouse(event):
		mouse_pos = event.position
		match event.button_index:
			MOUSE_BUTTON_LEFT:
				shoot_held = true
			MOUSE_BUTTON_RIGHT:
				skill_requested.emit(slot, event.position)
			MOUSE_BUTTON_WHEEL_DOWN:
				slot = (slot + 1) % 3
				slot_selected.emit(slot)
			MOUSE_BUTTON_WHEEL_UP:
				slot = (slot + 2) % 3
				slot_selected.emit(slot)


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_MOUSE_EXIT:
		mouse_inside = false
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT:
		shoot_held = false
