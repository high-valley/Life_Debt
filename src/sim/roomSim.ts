// 1つの戦闘部屋のシミュレーション。DOM・描画・入力に依存しない。
// 1ティックの処理順（同フレームの競合をこの順で解決する）:
//   1) プレイヤー移動・射撃 2) 自弾の命中 3) 敵の撃破（清算・ドロップ） 4) 敵AIと攻撃・被弾
//   5) 時間片の回収（滞納中は差し押さえ） 6) 時計の減少 7) ウェーブ・部屋クリア判定
import type { Balance, EnemyDef, NodeKind } from "../data/types.ts";
import type { RunState } from "./runState.ts";

export const STEP = 1 / 60;
const CELL = 40;
const TAU = Math.PI * 2;

export interface P { x: number; y: number }

export class Player {
  x = 140; y = 360;
  r = 13;
  ax = 1; ay = 0;          // 狙っている向き
  dashT = 0;
  dashDx = 1; dashDy = 0;
  dashCd = 0;
  iframe = 0;
  shotCd = 0;
  flash = 0;
  slot = 0;
  skillCd = [0, 0, 0];
}

export class Foe {
  readonly id: number;
  readonly def: EnemyDef;
  x: number; y: number;
  vx = 0; vy = 0;
  readonly r: number;
  hp: number;
  maxHp: number;
  cd = 1;
  flash = 0;
  slowT = 0;
  marked = false;
  dead = false;
  aoeCd = 3;
  windup = 0;
  summonCd = 6;
  volleyCd = 2.5;
  constructor(id: number, def: EnemyDef, x: number, y: number, hp: number) {
    this.id = id;
    this.def = def;
    this.x = x;
    this.y = y;
    this.r = def.radius;
    this.hp = hp;
    this.maxHp = hp;
  }
}

export interface Shot { x: number; y: number; vx: number; vy: number; life: number }
export interface EShot { x: number; y: number; vx: number; vy: number; dmg: number; life: number; reason: string }
export interface Shard { x: number; y: number; v: number }
export interface Circle { x: number; y: number; r: number }

export type FxKind = "mark" | "burst" | "slash" | "lose" | "poof" | "seize" | "gain" | "warn";
export interface FxEvent { type: "fx"; kind: FxKind; x: number; y: number; dur: number; r?: number; tx?: number; ty?: number; text?: string; color?: string; enemy?: boolean; follow?: Foe }
export type RoomEvent = FxEvent | { type: "sfx"; name: string } | { type: "toast"; text: string; kind: string } | { type: "shake"; amount: number };

const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(ax - bx, ay - by);

/** 点と線分の距離 */
export function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return dist(px, py, ax + dx * t, ay + dy * t);
}

function compact<T>(arr: T[], keep: (v: T) => boolean): void {
  let j = 0;
  for (let i = 0; i < arr.length; i++) if (keep(arr[i])) arr[j++] = arr[i];
  arr.length = j;
}

export class RoomSim {
  readonly run: RunState;
  readonly D: Balance;
  readonly kind: NodeKind;
  readonly id: string;
  readonly W: number;
  readonly H: number;
  readonly geom: Circle[] = [];
  waves: string[][] = [];
  wave = 0;
  waveT = 0;
  cleared = false;
  justCleared = false;
  readonly dropMul: number;
  readonly p = new Player();
  foes: Foe[] = [];
  shots: Shot[] = [];
  eshots: EShot[] = [];
  shards: Shard[] = [];
  events: RoomEvent[] = [];
  boss: Foe | null = null;
  private uid = 1;
  private flow: Int32Array;
  private blockedCell: Uint8Array;
  private flowT = 0;
  private flowReady = false;
  private readonly gw: number;
  private readonly gh: number;

  constructor(run: RunState, kind: NodeKind) {
    this.run = run;
    this.D = run.D;
    this.kind = kind;
    [this.W, this.H] = this.D.room_size;
    this.gw = Math.floor(this.W / CELL);
    this.gh = Math.floor(this.H / CELL);
    this.flow = new Int32Array(this.gw * this.gh);
    this.blockedCell = new Uint8Array(this.gw * this.gh);
    const gi = kind === "boss" ? 0 : run.rng.map.int(0, this.D.geometries.length - 1);
    for (const [x, y, r] of this.D.geometries[gi]) this.geom.push({ x, y, r });
    this.id = `${kind}-${run.roomIndex}-g${gi}`;
    this.dropMul = this.D.nodes[kind].drop_mul ?? 1;
    this.p.r = this.D.player.radius;
    this.markBlocked();
    this.buildWaves();
    this.spawnWave();
  }

  // ---------------------------------------------------------------- events
  private emit(e: RoomEvent): void {
    this.events.push(e);
  }

  private fx(kind: FxKind, x: number, y: number, dur: number, extra: Partial<FxEvent> = {}): void {
    this.events.push({ type: "fx", kind, x, y, dur, ...extra });
  }

  drainEvents(): RoomEvent[] {
    const out = this.events;
    this.events = [];
    for (const n of this.run.ledger.notices) out.push({ type: "toast", text: n.text, kind: n.kind });
    this.run.ledger.notices.length = 0;
    return out;
  }

  // ---------------------------------------------------------------- waves
  private buildWaves(): void {
    const run = this.run, a = run.area(), rng = run.rng.enemy;
    if (this.kind === "boss") {
      this.waves = [["regulator", "officer", "officer"]];
      return;
    }
    const base = 2 + a;
    for (let w = 0; w < 3; w++) {
      const list: string[] = [];
      const n = base + rng.int(0, 1) + w;
      for (let i = 0; i < n; i++) list.push(rng.randf() < 0.25 + a * 0.08 ? "officer" : "debtor");
      if ((this.kind === "elite" || this.kind === "alley") && w === 0) {
        list.push("enforcer");
        if (a >= 2) list.push("enforcer");
      }
      this.waves.push(list);
    }
    if (run.debt.defaulted().length > 0) this.waves[0].push("collector"); // 滞納中は回収人が合算で1体だけ来る
  }

  private spawnWave(): void {
    if (this.wave >= this.waves.length) return;
    const rng = this.run.rng.enemy, D = this.D;
    for (const eid of this.waves[this.wave]) {
      const def = D.enemies[eid], r = def.radius;
      let x = 0, y = 0;
      for (let tries = 0; tries < 20; tries++) {
        const side = rng.int(0, 2);
        if (side === 0) { x = this.W - 60 - rng.randf() * 200; y = 80 + rng.randf() * (this.H - 160); }
        else if (side === 1) { x = 300 + rng.randf() * (this.W - 380); y = 60 + rng.randf() * 80; }
        else { x = 300 + rng.randf() * (this.W - 380); y = this.H - 60 - rng.randf() * 80; }
        if (!this.blocked(x, y, r) && dist(x, y, this.p.x, this.p.y) >= 280) break;
      }
      let hp = def.hp * (1 + (this.run.area() - 1) * D.area_hp_scale);
      if (def.ai === "collector") hp = def.hp + this.run.debt.defaultOutstanding() * (def.hp_per_debt ?? 0.35);
      const f = this.newFoe(def, x, y, hp);
      f.cd = 0.6 + rng.randf();
      if (def.ai === "boss") this.boss = f;
    }
    this.wave++;
    this.waveT = 0;
  }

  private newFoe(def: EnemyDef, x: number, y: number, hp: number): Foe {
    const f = new Foe(this.uid++, def, x, y, hp);
    this.foes.push(f);
    return f;
  }

  // ---------------------------------------------------------------- geometry
  blocked(x: number, y: number, r: number): boolean {
    if (x < r || y < r || x > this.W - r || y > this.H - r) return true;
    for (const o of this.geom) if (dist(x, y, o.x, o.y) < o.r + r) return true;
    return false;
  }

  los(ax: number, ay: number, bx: number, by: number, pad: number): boolean {
    for (const o of this.geom) if (segDist(o.x, o.y, ax, ay, bx, by) < o.r + pad) return false;
    return true;
  }

  pushOut(x: number, y: number, r: number): [number, number] {
    for (const o of this.geom) {
      const ox = x - o.x, oy = y - o.y, l = Math.hypot(ox, oy), rr = o.r + r;
      if (l < rr && l > 0) { x = o.x + (ox / l) * rr; y = o.y + (oy / l) * rr; }
    }
    return [Math.max(r, Math.min(this.W - r, x)), Math.max(r, Math.min(this.H - r, y))];
  }

  doorRect(): { x: number; y: number; w: number; h: number } {
    return { x: this.W - 34, y: this.H / 2 - 60, w: 34, h: 120 };
  }

  private markBlocked(): void {
    for (let gy = 0; gy < this.gh; gy++) {
      for (let gx = 0; gx < this.gw; gx++) {
        const cx = gx * CELL + CELL / 2, cy = gy * CELL + CELL / 2;
        for (const o of this.geom) if (dist(cx, cy, o.x, o.y) < o.r + 14) this.blockedCell[gy * this.gw + gx] = 1;
      }
    }
  }

  /** 経路: 40pxグリッドのBFS距離場（プレイヤーが起点）。視線が通らない敵はこれを下る */
  private buildFlow(): void {
    const gw = this.gw, gh = this.gh, flow = this.flow, bc = this.blockedCell;
    flow.fill(-1);
    const px = Math.max(0, Math.min(gw - 1, Math.floor(this.p.x / CELL)));
    const py = Math.max(0, Math.min(gh - 1, Math.floor(this.p.y / CELL)));
    const q = [py * gw + px];
    flow[q[0]] = 0;
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % gw, y = Math.floor(i / gw);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const j = ny * gw + nx;
          if (flow[j] >= 0 || bc[j] === 1) continue;
          if (dx !== 0 && dy !== 0 && (bc[y * gw + nx] === 1 || bc[ny * gw + x] === 1)) continue;
          flow[j] = flow[i] + 1;
          q.push(j);
        }
      }
    }
    this.flowReady = true;
  }

  private chaseTarget(f: Foe): P {
    const p = this.p;
    if (!this.flowReady || this.los(f.x, f.y, p.x, p.y, f.r)) return { x: p.x, y: p.y };
    const gx = Math.floor(f.x / CELL), gy = Math.floor(f.y / CELL);
    let best: P = { x: p.x, y: p.y }, bd = 1 << 30;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = gx + dx, ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= this.gw || ny >= this.gh) continue;
        const v = this.flow[ny * this.gw + nx];
        if (v >= 0 && v < bd) {
          bd = v;
          best = { x: nx * CELL + CELL / 2, y: ny * CELL + CELL / 2 };
        }
      }
    }
    return best;
  }

  private static steer(f: Foe, tx: number, ty: number, speed: number, dt: number, stop: number): void {
    const ox = tx - f.x, oy = ty - f.y, d = Math.hypot(ox, oy);
    let wx = 0, wy = 0;
    if (d > stop) { wx = (ox / d) * speed; wy = (oy / d) * speed; }
    const k = Math.min(1, dt * 8);
    f.vx += (wx - f.vx) * k;
    f.vy += (wy - f.vy) * k;
  }

  // ---------------------------------------------------------------- targeting
  nearestFoe(fx: number, fy: number, maxD = 1e9, visibleOnly = false): Foe | null {
    let best: Foe | null = null, bd = maxD;
    for (const f of this.foes) {
      if (f.dead) continue;
      const d = dist(fx, fy, f.x, f.y);
      if (d < bd && (!visibleOnly || this.los(this.p.x, this.p.y, f.x, f.y, 3))) {
        bd = d;
        best = f;
      }
    }
    return best;
  }

  /** aim が null ならオートエイム（見えている一番近い敵） */
  private aimDir(aim: P | null): [number, number] {
    const p = this.p;
    if (aim === null) {
      const t = this.nearestFoe(p.x, p.y, 1e9, true) ?? this.nearestFoe(p.x, p.y);
      if (!t) return [p.ax, p.ay];
      const l = dist(t.x, t.y, p.x, p.y) || 1;
      return [(t.x - p.x) / l, (t.y - p.y) / l];
    }
    const vx = aim.x - p.x, vy = aim.y - p.y, l = Math.hypot(vx, vy);
    return l > 1 ? [vx / l, vy / l] : [p.ax, p.ay];
  }

  // ---------------------------------------------------------------- player actions
  tryDash(mx: number, my: number): void {
    const p = this.p;
    if (p.dashCd > 0 || this.run.result !== "") return;
    const l = Math.hypot(mx, my);
    if (l > 0.01) { p.dashDx = mx / l; p.dashDy = my / l; } else { p.dashDx = p.ax; p.dashDy = p.ay; }
    p.dashT = this.D.player.dash_time;
    p.dashCd = this.D.player.dash_cd;
    p.iframe = Math.max(p.iframe, p.dashT + 0.05);
  }

  useSkill(i: number, aim: P | null): boolean {
    const run = this.run, p = this.p;
    if (run.result !== "") return false;
    const sk = this.D.skills[i];
    const cost = run.skillCost(i);
    if (p.skillCd[i] > 0) {
      this.emit({ type: "toast", text: "クールダウン中", kind: "muted" });
      return false;
    }
    if (!run.ledger.canPay(cost)) {
      this.emit({ type: "toast", text: `寿命が足りない（${cost}秒必要）`, kind: "debt" });
      this.emit({ type: "sfx", name: "fail" });
      return false;
    }
    const [dx, dy] = this.aimDir(aim);
    if (sk.id === "drain_mark") {
      const target = aim === null ? this.nearestFoe(p.x, p.y, 1e9, true) : this.nearestFoe(aim.x, aim.y, 90);
      if (!target) {
        this.emit({ type: "toast", text: "刻印する敵がいない", kind: "muted" });
        return false;
      }
      run.ledger.change(-cost, "skill");
      target.marked = true;
      this.fx("mark", target.x, target.y, 0.5);
    } else if (sk.id === "time_burst") {
      run.ledger.change(-cost, "skill");
      for (const f of this.foes) if (dist(f.x, f.y, p.x, p.y) < (sk.radius ?? 150) + f.r) this.hurt(f, (sk.damage ?? 0) * run.atkMul());
      this.fx("burst", p.x, p.y, 0.45, { r: sk.radius });
      this.emit({ type: "shake", amount: 4 });
    } else if (sk.id === "temporal_dash") {
      run.ledger.change(-cost, "skill");
      const sx = p.x, sy = p.y, len = sk.length ?? 260;
      const ex = Math.max(p.r, Math.min(this.W - p.r, p.x + dx * len));
      const ey = Math.max(p.r, Math.min(this.H - p.r, p.y + dy * len));
      for (const f of this.foes) {
        if (segDist(f.x, f.y, sx, sy, ex, ey) < f.r + 26) {
          this.hurt(f, (sk.damage ?? 0) * run.atkMul());
          f.slowT = sk.slow_time ?? 2.5;
        }
      }
      [p.x, p.y] = this.pushOut(ex, ey, p.r);
      p.iframe = Math.max(p.iframe, 0.25);
      this.fx("slash", sx, sy, 0.35, { tx: ex, ty: ey });
    }
    p.skillCd[i] = sk.cd;
    this.emit({ type: "sfx", name: "skill" });
    run.checkDeath();
    return true;
  }

  private hurt(f: Foe, d: number): void {
    if (f.dead) return;
    if (f.def.ai === "collector") d *= this.run.collectorMul();
    f.hp -= d;
    f.flash = 0.08;
  }

  hurtPlayer(d: number, reason: string, steal: boolean): void {
    const run = this.run, p = this.p;
    if (run.result !== "" || p.iframe > 0) return;
    p.iframe = this.D.player.hit_iframe;
    p.flash = 0.2;
    this.emit({ type: "shake", amount: 5 });
    this.emit({ type: "sfx", name: "hit" });
    if (steal) {
      // 回収人の取り立ては借金の返済にも充当される
      const c = run.debt.defaulted()[0];
      if (c) c.outstanding -= Math.min(d, c.outstanding);
    }
    run.ledger.change(-d, reason);
    this.fx("lose", p.x, p.y - 20, 0.9, { text: `−${Math.round(d)}` });
    const def = run.debt.defaulted();
    if (steal && def.length > 0 && def.every((c) => c.outstanding <= 0.5)) {
      run.debt.settleDefaulted();
      this.emit({ type: "toast", text: "取り立てで滞納分を完済した", kind: "good" });
    }
    run.checkDeath();
  }

  // ---------------------------------------------------------------- tick
  step(dt: number, mx: number, my: number, aim: P | null, shoot: boolean): void {
    const run = this.run, D = this.D, P = D.player, p = this.p;
    this.justCleared = false;
    run.elapsed += dt;
    run.ledger.clock = run.elapsed;
    // 1) プレイヤー
    const ml = Math.hypot(mx, my);
    const ux = ml > 0.01 ? mx / ml : 0, uy = ml > 0.01 ? my / ml : 0;
    if (p.dashT > 0) {
      p.dashT -= dt;
      p.x += p.dashDx * P.dash_speed * dt;
      p.y += p.dashDy * P.dash_speed * dt;
    } else {
      p.x += ux * run.moveSpeed() * dt;
      p.y += uy * run.moveSpeed() * dt;
    }
    [p.x, p.y] = this.pushOut(p.x, p.y, p.r);
    p.dashCd = Math.max(0, p.dashCd - dt);
    p.iframe = Math.max(0, p.iframe - dt);
    p.flash -= dt;
    p.shotCd -= dt;
    for (let i = 0; i < 3; i++) p.skillCd[i] = Math.max(0, p.skillCd[i] - dt);
    [p.ax, p.ay] = this.aimDir(aim);
    const wantShoot = aim !== null ? shoot : this.foes.length > 0;
    if (wantShoot && p.shotCd <= 0 && run.result === "") {
      p.shotCd = run.shotInterval();
      this.shots.push({ x: p.x + p.ax * 16, y: p.y + p.ay * 16, vx: p.ax * P.shot_speed, vy: p.ay * P.shot_speed, life: 0.9 });
      if (run.rng.misc.randf() < 0.3) this.emit({ type: "sfx", name: "shot" });
    }
    // 2) 自弾
    for (const s of this.shots) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      if (this.blocked(s.x, s.y, 2)) { s.life = 0; continue; }
      for (const f of this.foes) {
        if (!f.dead && dist(f.x, f.y, s.x, s.y) < f.r + 4) {
          this.hurt(f, P.shot_damage * run.atkMul());
          s.life = 0;
          break;
        }
      }
    }
    compact(this.shots, (s) => s.life > 0);
    // 3) 撃破（清算・ドロップは敵の攻撃より先）
    for (const f of this.foes) {
      if (f.dead || f.hp > 0) continue;
      f.dead = true;
      this.fx("poof", f.x, f.y, 0.4, { color: f.def.color });
      if (f.def.ai === "collector" && run.debt.settleDefaulted()) this.emit({ type: "toast", text: "回収人を退けた。滞納分は清算された", kind: "good" });
      if (f.def.ai === "boss") run.win();
      if (f.def.drop > 0) {
        const v = f.def.drop * (f.marked ? 1 + (D.skills[2].bonus ?? 0.5) : 1) * this.dropMul;
        const n = Math.max(1, Math.min(5, Math.round(v / 20)));
        for (let i = 0; i < n; i++) {
          this.shards.push({ x: f.x + (run.rng.misc.randf() - 0.5) * 26, y: f.y + (run.rng.misc.randf() - 0.5) * 26, v: v / n });
        }
      }
    }
    compact(this.foes, (f) => !f.dead);
    // 4) 敵
    this.flowT -= dt;
    if (this.flowT <= 0 || !this.flowReady) {
      this.flowT = 0.25;
      this.buildFlow();
    }
    const n0 = this.foes.length;   // 途中でボスが呼んだ手下はこのティックでは動かさない
    for (let i = 0; i < n0; i++) this.foeUpdate(this.foes[i], dt);
    for (const f of this.foes) [f.x, f.y] = this.pushOut(f.x + f.vx * dt, f.y + f.vy * dt, f.r);
    const fs = this.foes;
    for (let i = 0; i < fs.length; i++) {
      for (let j = i + 1; j < fs.length; j++) {
        const a = fs[i], b = fs[j];
        const ox = b.x - a.x, oy = b.y - a.y, d = Math.hypot(ox, oy), rr = a.r + b.r;
        if (d < rr && d > 0) {
          const k = (rr - d) / d / 2;
          a.x -= ox * k; a.y -= oy * k;
          b.x += ox * k; b.y += oy * k;
        }
      }
    }
    for (const s of this.eshots) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      if (this.blocked(s.x, s.y, 2)) { s.life = 0; continue; }
      if (dist(s.x, s.y, p.x, p.y) < p.r + 4) {
        this.hurtPlayer(s.dmg, s.reason, false);
        s.life = 0;
      }
    }
    compact(this.eshots, (s) => s.life > 0);
    // 5) 時間片
    compact(this.shards, (s) => {
      const ox = p.x - s.x, oy = p.y - s.y, d = Math.hypot(ox, oy);
      if (d < p.r + 10) {
        let v = s.v * run.gainMul();
        if (run.debt.defaulted().length > 0) {
          const seized = v * run.debt.seizeRate;
          v -= seized;
          this.fx("seize", p.x, p.y - 34, 0.8, { text: `差押 ${Math.round(seized)}` });
          if (run.debt.seize(seized)) {
            this.emit({ type: "toast", text: "差し押さえで滞納分を完済した", kind: "good" });
            for (const f of this.foes) {
              if (f.def.ai === "collector") {
                f.dead = true;
                this.fx("poof", f.x, f.y, 0.5, { color: f.def.color });
              }
            }
          }
        }
        run.ledger.change(v, "drop");
        this.emit({ type: "sfx", name: "gain" });
        this.fx("gain", p.x, p.y - 18, 0.8, { text: `+${Math.round(v)}` });
        return false;
      }
      if (d < run.pickupRadius()) {
        const sp = (Math.max(260, 640 - d * 2) * dt) / d;
        s.x += ox * sp;
        s.y += oy * sp;
      }
      return true;
    });
    compact(this.foes, (f) => !f.dead);
    // 6) 時計
    run.ledger.change(-D.time.drain_per_sec * dt, "drain");
    run.checkDeath();
    // 7) ウェーブ・クリア
    this.waveT += dt;
    if (this.wave < this.waves.length && (this.foes.length <= 1 || this.waveT > 14)) this.spawnWave();
    if (!this.cleared && this.wave >= this.waves.length && this.foes.length === 0 && run.result === "") {
      this.cleared = true;
      this.justCleared = true;
      this.emit({ type: "sfx", name: "door" });
    }
  }

  atDoor(): boolean {
    if (!this.cleared || this.kind === "boss") return false;
    const d = this.doorRect(), p = this.p;
    return p.x + p.r > d.x && p.y > d.y && p.y < d.y + d.h;
  }

  private foeUpdate(f: Foe, dt: number): void {
    const d = f.def, D = this.D, p = this.p;
    const speed = d.speed * (f.slowT > 0 ? (D.skills[1].slow ?? 0.45) : 1);
    f.slowT -= dt;
    f.cd -= dt;
    f.flash -= dt;
    const dp = dist(f.x, f.y, p.x, p.y);
    const chase = this.chaseTarget(f);
    const seen = this.los(f.x, f.y, p.x, p.y, 4);
    const S = RoomSim.steer;
    if (d.ai === "chase" || d.ai === "collector") {
      S(f, chase.x, chase.y, speed, dt, 0);
      if (dp < f.r + p.r + 2 && f.cd <= 0) {
        f.cd = 0.8;
        this.hurtPlayer(d.damage, d.ai === "collector" ? "collector" : "hit", d.ai === "collector");
      }
    } else if (d.ai === "ranged") {
      const range = d.range ?? 330;
      if (dp > range || !seen) S(f, chase.x, chase.y, speed, dt, 0);
      else if (dp < 220) S(f, f.x * 2 - p.x, f.y * 2 - p.y, speed * 0.8, dt, 0);
      else S(f, f.x, f.y, 0, dt, 1);
      if (seen && dp < range + 40 && f.cd <= 0) {
        f.cd = d.interval ?? 1.8;
        const a = Math.atan2(p.y - f.y, p.x - f.x) + (this.run.rng.misc.randf() - 0.5) * 0.1;
        this.eshots.push({ x: f.x, y: f.y, vx: Math.cos(a) * 330, vy: Math.sin(a) * 330, dmg: d.damage, life: 1.6, reason: "hit" });
      }
    } else if (d.ai === "boss") {
      S(f, chase.x, chase.y, speed, dt, f.r + 20);
      if (dp < f.r + p.r + 4 && f.cd <= 0) {
        f.cd = 1;
        this.hurtPlayer(d.damage, "boss", false);
      }
      const aoe = d.aoe!;
      f.aoeCd -= dt;
      f.summonCd -= dt;
      f.volleyCd -= dt;
      if (f.windup > 0) {
        f.windup -= dt;
        if (f.windup <= 0) {
          if (dp < aoe.radius + p.r) this.hurtPlayer(aoe.damage, "boss", false);
          this.fx("burst", f.x, f.y, 0.4, { r: aoe.radius, enemy: true });
          this.emit({ type: "shake", amount: 6 });
        }
      } else if (f.aoeCd <= 0 && dp < aoe.radius + 45) {
        f.windup = aoe.windup;
        f.aoeCd = aoe.interval;
        this.fx("warn", f.x, f.y, aoe.windup, { r: aoe.radius, follow: f });
      }
      if (f.summonCd <= 0 && this.foes.length < 10) {
        f.summonCd = d.summon_interval ?? 7;
        const dd = D.enemies.debtor;
        for (let i = 0; i < 3; i++) {
          const a = this.run.rng.enemy.randf() * TAU;
          const [sx, sy] = this.pushOut(f.x + Math.cos(a) * 60, f.y + Math.sin(a) * 60, dd.radius);
          this.newFoe(dd, sx, sy, dd.hp * 1.5).cd = 1;
        }
      }
      if (f.volleyCd <= 0 && dp > 160 && seen) {
        f.volleyCd = d.volley_interval ?? 3.2;
        const base = Math.atan2(p.y - f.y, p.x - f.x);
        for (const k of [-1, 0, 1]) {
          const a = base + k * 0.22;
          this.eshots.push({ x: f.x, y: f.y, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300, dmg: 10, life: 2, reason: "boss" });
        }
      }
    }
  }
}
