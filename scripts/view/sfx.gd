class_name Sfx
extends Node
## 仮の効果音（起動時にコードで波形を生成）。本番音源に差し替える時は SOUNDS を置き換える。

const RATE := 22050
const SOUNDS := {
	"shot": [900.0, 700.0, 0.04, "square", -18.0],
	"hit": [200.0, 90.0, 0.08, "square", -8.0],
	"gain": [1200.0, 1800.0, 0.06, "sine", -12.0],
	"skill": [300.0, 1200.0, 0.18, "tri", -8.0],
	"pay": [600.0, 300.0, 0.25, "sine", -6.0],
	"loan": [300.0, 900.0, 0.3, "tri", -6.0],
	"fail": [200.0, 160.0, 0.1, "square", -10.0],
	"beat": [70.0, 50.0, 0.12, "sine", -2.0],
	"boss": [90.0, 50.0, 0.5, "saw", -8.0],
	"door": [440.0, 880.0, 0.2, "tri", -8.0],
}

var players := {}


func _ready() -> void:
	for name in SOUNDS:
		var spec: Array = SOUNDS[name]
		var p := AudioStreamPlayer.new()
		p.stream = _make(spec)
		p.max_polyphony = 4
		p.volume_db = spec[4]
		add_child(p)
		players[name] = p


func play(name: String) -> void:
	if players.has(name):
		players[name].play()


static func _make(spec: Array) -> AudioStreamWAV:
	var f0: float = spec[0]
	var f1: float = spec[1]
	var dur: float = spec[2]
	var wave: String = spec[3]
	var n := int(RATE * dur)
	var bytes := PackedByteArray()
	bytes.resize(n * 2)
	var phase := 0.0
	for i in n:
		var k := float(i) / n
		phase = fmod(phase + f0 * pow(f1 / f0, k) / RATE, 1.0)
		var v := 0.0
		match wave:
			"sine": v = sin(phase * TAU)
			"square": v = 1.0 if phase < 0.5 else -1.0
			"saw": v = phase * 2.0 - 1.0
			_: v = 1.0 - absf(phase * 4.0 - 2.0)
		bytes.encode_s16(i * 2, int(v * exp(-k * 5.0) * 0.5 * 32767.0))
	var s := AudioStreamWAV.new()
	s.format = AudioStreamWAV.FORMAT_16_BITS
	s.mix_rate = RATE
	s.data = bytes
	return s
