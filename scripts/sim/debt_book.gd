class_name DebtBook
extends RefCounted
## 借金契約の状態機械。
##   active ──(満期の部屋に入る・払える)──▶ paid
##     └────(満期の部屋に入る・払えない)─▶ defaulted ──(回収人撃破 / 差し押さえで完済)──▶ settled
## 返済判定は部屋遷移時に1回だけ（processed に部屋番号を記録して二重実行を防ぐ）。

var contracts: Array = []    # Dictionary の配列
var seq := 0
var count := 0
var max_debt := 0.0
var max_open := 2
var seize_rate := 0.4


func open_contracts() -> Array:
	return contracts.filter(func(c: Dictionary) -> bool: return c.state == "active" or c.state == "defaulted")


func defaulted() -> Array:
	return contracts.filter(func(c: Dictionary) -> bool: return c.state == "defaulted")


func total() -> float:
	var s := 0.0
	for c in open_contracts():
		s += c.outstanding
	return s


func can_sign() -> bool:
	return open_contracts().size() < max_open


func sign(def: Dictionary, room_index: int, ledger: TimeLedger) -> bool:
	if not can_sign() or ledger.dead:
		return false
	seq += 1
	var c := {"uid": seq, "id": def.id, "name": def.name, "principal": float(def.principal), "repay": float(def.repay),
		"signed_room": room_index, "due_room": room_index + int(def.due), "outstanding": float(def.repay), "state": "active", "processed": -1}
	contracts.append(c)
	count += 1
	ledger.change(float(def.principal), "loan")
	max_debt = maxf(max_debt, total())
	ledger.log.append({"t": ledger.clock, "room": room_index, "type": "sign", "contract": c.uid, "due_room": c.due_room})
	return true


## 部屋遷移時に呼ぶ。force_all（ボス部屋の入口）なら満期前の契約もすべて処理する。
func process_due(room_index: int, force_all: bool, ledger: TimeLedger) -> Array:
	var notices: Array = []
	for c in contracts:
		if c.state != "active" or c.processed == room_index:
			continue
		if not force_all and c.due_room > room_index:
			continue
		c.processed = room_index
		if ledger.can_pay(c.outstanding):
			ledger.change(-c.outstanding, "repay")
			notices.append({"text": "%s #%d を返済：−%d秒" % [c.name, c.uid, roundi(c.outstanding)], "kind": "pay"})
			ledger.log.append({"t": ledger.clock, "room": room_index, "type": "repay", "contract": c.uid})
			c.outstanding = 0.0
			c.state = "paid"
		else:
			c.state = "defaulted"
			notices.append({"text": "%s #%d 返済不能 — 回収人が派遣された" % [c.name, c.uid], "kind": "debt"})
			ledger.log.append({"t": ledger.clock, "room": room_index, "type": "default", "contract": c.uid})
	return notices


## 休憩所での早期返済
func repay_early(c: Dictionary, ledger: TimeLedger) -> bool:
	if c.state != "active" or not ledger.can_pay(c.outstanding):
		return false
	ledger.change(-c.outstanding, "repay")
	ledger.log.append({"t": ledger.clock, "room": ledger.room, "type": "repay", "contract": c.uid, "early": true})
	c.outstanding = 0.0
	c.state = "paid"
	return true


## 滞納分を差し押さえで充当。完済したら true
func seize(amount: float) -> bool:
	var left := amount
	for c in defaulted():
		var take: float = minf(left, c.outstanding)
		c.outstanding -= take
		left -= take
		if left <= 0.0:
			break
	if not defaulted().is_empty() and defaulted().all(func(c: Dictionary) -> bool: return c.outstanding <= 0.5):
		settle_defaulted()
		return true
	return false


func settle_defaulted() -> bool:
	var any := false
	for c in defaulted():
		c.state = "settled"
		c.outstanding = 0.0
		any = true
	return any


func default_outstanding() -> float:
	var s := 0.0
	for c in defaulted():
		s += c.outstanding
	return s


func due_text(c: Dictionary, room_index: int) -> String:
	match c.state:
		"defaulted":
			return "滞納中：回収人が追跡"
		"paid":
			return "返済済み"
		"settled":
			return "清算済み"
	var left: int = c.due_room - room_index
	return "次の部屋で満期" if left <= 0 else "あと%d部屋で満期" % left
