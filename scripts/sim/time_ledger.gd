class_name TimeLedger
extends RefCounted
## 寿命残高の唯一の管理者。増減はすべて change() を通す。
## - 上限を超えた分は切り捨て（記録する）
## - 0 になったら死亡。死亡は1回だけ発生し、以後の増減は無視
## - 支払い（スキル・購入・返済）は残高が0にならない時だけ can_pay() が true

var time: float
var max_time: float
var gained := 0.0
var spent := 0.0
var truncated := 0.0
var dead := false
var death_reason := ""
var log: Array = []          # {t, room, type, reason, delta}
var notices: Array = []      # UIに出す通知 {text, kind}
var clock := 0.0             # ゲーム内時間（ログ用。RunState が進める）
var room := 0


func _init(start: float, p_max: float) -> void:
	time = start
	max_time = p_max


func change(delta: float, reason: String) -> float:
	if dead:
		return 0.0
	var before := time
	var next := before + delta
	if next > max_time:
		var cut := next - max_time
		truncated += cut
		next = max_time
		if reason != "drain" and cut >= 1.0:
			notices.append({"text": "上限 %s を超えた %d秒 は切り捨て" % [fmt(max_time), roundi(cut)], "kind": "warn"})
	next = maxf(next, 0.0)
	time = next
	var applied := next - before
	if applied > 0.0:
		gained += applied
	else:
		spent -= applied
	if reason != "drain":
		log.append({"t": snappedf(clock, 0.01), "room": room, "type": "time", "reason": reason, "delta": roundi(applied)})
	if time <= 0.0 and not dead:
		dead = true
		death_reason = reason
		log.append({"t": snappedf(clock, 0.01), "room": room, "type": "death", "reason": reason})
	return applied


func can_pay(cost: float) -> bool:
	return not dead and time - cost > 0.0


func raise_max(amount: float) -> void:
	max_time += amount


static func fmt(s: float) -> String:
	var n := maxi(0, ceili(s))
	return "%02d:%02d" % [n / 60, n % 60]
