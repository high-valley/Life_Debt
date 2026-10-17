// 用途ごとの乱数列。演出の乱数が増えても、敵の出現とカード候補の順序は同じ seed で再現される。
// 新しい用途を足す時は既存の列を流用せず、列を1本足す（流用すると seed 再現性が壊れる）。

/** 文字列 → 128bit の種（cyrb128） */
function hash128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/** sfc32: 速くて質の良い32bit乱数 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seedText: string) {
    [this.a, this.b, this.c, this.d] = hash128(seedText);
    for (let i = 0; i < 12; i++) this.nextU32();
  }

  nextU32(): number {
    this.a >>>= 0; this.b >>>= 0; this.c >>>= 0; this.d >>>= 0;
    const t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    const r = (t + this.d) | 0;
    this.c = (this.c + r) | 0;
    return r >>> 0;
  }

  /** [0, 1) */
  randf(): number {
    return this.nextU32() / 4294967296;
  }

  /** [a, b] の整数（両端を含む） */
  int(a: number, b: number): number {
    return a + Math.floor(this.randf() * (b - a + 1));
  }

  /** [0, n) の整数 */
  randi(n: number): number {
    return Math.floor(this.randf() * n);
  }
}

export class RngStreams {
  readonly map: Rng;     // 分岐ルートの候補・部屋の地形
  readonly enemy: Rng;   // 敵の構成と出現位置
  readonly reward: Rng;  // 戦闘報酬の3択
  readonly misc: Rng;    // ドロップの散らばり・弾のぶれ

  constructor(seed: number) {
    this.map = new Rng(`${seed}:map`);
    this.enemy = new Rng(`${seed}:enemy`);
    this.reward = new Rng(`${seed}:reward`);
    this.misc = new Rng(`${seed}:misc`);
  }
}
