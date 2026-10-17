class_name RngStreams
extends RefCounted
## 用途ごとに乱数列を分ける。演出や戦闘の細かな乱数が増えても、
## 部屋候補・敵構成・報酬候補の順序は同じ seed で再現される。

var map := RandomNumberGenerator.new()      # 分岐ルートの候補・部屋の地形
var enemy := RandomNumberGenerator.new()    # 敵の構成と出現位置
var reward := RandomNumberGenerator.new()   # 戦闘報酬の3択
var misc := RandomNumberGenerator.new()     # ドロップの散らばり・弾のぶれ


func _init(seed_value: int) -> void:
	map.seed = _mix(seed_value, 1)
	enemy.seed = _mix(seed_value, 2)
	reward.seed = _mix(seed_value, 3)
	misc.seed = _mix(seed_value, 4)


static func _mix(a: int, b: int) -> int:
	return ("%d:%d" % [a, b]).hash()
