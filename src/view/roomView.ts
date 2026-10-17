// 戦闘部屋の描画。RoomSim を読むだけ。仮アセットなので図形で描く。
import type { InputRouter } from "../input/inputRouter.ts";
import type { FxEvent, RoomSim } from "../sim/roomSim.ts";
import { C, FONT } from "./theme.ts";

type Fx = FxEvent & { t: number };

const rgba = (hex: string, a: number): string =>
  `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

export class RoomView {
  fx: Fx[] = [];
  shake = 0;
  zoom = 1;
  camX = 0;
  camY = 0;
  W = 0;
  H = 0;
  private shx = 0;
  private shy = 0;

  addFx(e: FxEvent): void {
    if (this.fx.length < 200) this.fx.push({ ...e, t: 0 });
  }

  addShake(a: number): void {
    this.shake = Math.min(14, this.shake + a);
  }

  clear(): void {
    this.fx.length = 0;
    this.shake = 0;
  }

  /** PCは部屋全体が入るように、スマホは主人公の周り（900×506）を大きく映して追いかける */
  update(dt: number, room: RoomSim | null, W: number, H: number, touch: boolean): void {
    this.W = W;
    this.H = H;
    if (room) {
      const vw = touch ? 900 : room.W, vh = touch ? 506 : room.H;
      const z = (this.zoom = Math.min(W / vw, H / vh));
      const hw = W / z / 2, hh = H / z / 2;
      let cx = touch ? room.p.x : room.W / 2, cy = touch ? room.p.y : room.H / 2;
      cx = hw * 2 >= room.W ? room.W / 2 : Math.max(hw, Math.min(room.W - hw, cx));
      cy = hh * 2 >= room.H ? room.H / 2 : Math.max(hh, Math.min(room.H - hh, cy));
      this.camX = cx;
      this.camY = cy;
    }
    this.shx = (Math.random() - 0.5) * this.shake;
    this.shy = (Math.random() - 0.5) * this.shake;
    this.shake *= Math.pow(0.85, dt * 60);
    let j = 0;
    for (const f of this.fx) {
      f.t += dt;
      if (f.t < f.dur) this.fx[j++] = f;
    }
    this.fx.length = j;
  }

  screenToWorld(x: number, y: number): { x: number; y: number } {
    return { x: (x - this.W / 2 - this.shx) / this.zoom + this.camX, y: (y - this.H / 2 - this.shy) / this.zoom + this.camY };
  }

  draw(ctx: CanvasRenderingContext2D, room: RoomSim, router: InputRouter): void {
    const run = room.run, W = room.W, H = room.H;
    ctx.save();
    ctx.translate(this.W / 2 + this.shx, this.H / 2 + this.shy);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.camX, -this.camY);
    ctx.fillStyle = "#151820"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#1d212b"; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 64) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 0; y <= H; y += 64) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    ctx.strokeStyle = "#3a3226"; ctx.lineWidth = 6; ctx.strokeRect(3, 3, W - 6, H - 6);
    // 床の大時計
    ctx.strokeStyle = "rgba(242,181,68,.06)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(W / 2, H / 2, 300, 0, 7);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.moveTo(W / 2 + Math.cos(a) * 270, H / 2 + Math.sin(a) * 270); ctx.lineTo(W / 2 + Math.cos(a) * 300, H / 2 + Math.sin(a) * 300);
    }
    ctx.stroke();
    for (const o of room.geom) {
      ctx.fillStyle = "#262a33"; ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, 7); ctx.fill();
      ctx.strokeStyle = "#3a3f4b"; ctx.lineWidth = 3; ctx.stroke();
    }
    // 出口
    const d = room.doorRect(), open = room.cleared && room.kind !== "boss";
    ctx.fillStyle = open ? "rgba(95,224,200,.35)" : "#2a1d1d"; ctx.fillRect(d.x, d.y, d.w, d.h);
    ctx.strokeStyle = open ? C.shard : "#5a3a3a"; ctx.lineWidth = 3; ctx.strokeRect(d.x, d.y, d.w, d.h);
    if (open) {
      ctx.fillStyle = C.shard; ctx.font = `700 20px ${FONT}`; ctx.textAlign = "right"; ctx.textBaseline = "middle";
      ctx.fillText("出口 →", d.x - 10, d.y + d.h / 2);
      ctx.textAlign = "left";
    }
    // 時間片
    ctx.fillStyle = C.shard;
    for (const s of room.shards) {
      const a = run.elapsed * 3 + s.x;
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(a); ctx.fillRect(-4, -4, 8, 8); ctx.restore();
    }
    for (const f of this.fx) this.fxUnder(ctx, f);
    for (const e of room.foes) this.drawFoe(ctx, room, e);
    this.drawPlayer(ctx, room);
    ctx.fillStyle = "#f2e3b3";
    ctx.beginPath();
    for (const s of room.shots) { ctx.moveTo(s.x + 3.5, s.y); ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2); }
    ctx.fill();
    for (const s of room.eshots) {
      ctx.fillStyle = s.reason === "boss" ? C.brass : "#6aa7ff";
      ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, 7); ctx.fill();
    }
    if (!router.touchMode && router.mouseInside && router.gameplayEnabled) {
      const w = this.screenToWorld(router.mouse.x, router.mouse.y);
      ctx.strokeStyle = "rgba(239,231,214,.5)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(w.x, w.y, 9, 0, 7);
      ctx.moveTo(w.x - 14, w.y); ctx.lineTo(w.x - 5, w.y); ctx.moveTo(w.x + 5, w.y); ctx.lineTo(w.x + 14, w.y);
      ctx.stroke();
    }
    for (const f of this.fx) this.fxOver(ctx, f);
    ctx.restore();
    ctx.lineWidth = 1;
    ctx.textBaseline = "alphabetic";
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, room: RoomSim): void {
    const p = room.p, t = room.run.ledger.time;
    ctx.globalAlpha = p.iframe > 0 && Math.floor(room.run.elapsed * 30) % 2 === 0 ? 0.45 : 1;
    // 寿命リング: 1秒ごとに一周減る
    const frac = t % 1;
    ctx.strokeStyle = t < 60 ? C.debt : C.brass; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke();
    ctx.fillStyle = p.flash > 0 ? "#ffffff" : C.paper;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
    ctx.strokeStyle = "rgba(36,32,26,1)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.ax * (p.r + 4), p.y + p.ay * (p.r + 4)); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawFoe(ctx: CanvasRenderingContext2D, room: RoomSim, e: RoomSim["foes"][number]): void {
    const d = e.def, t = room.run.elapsed;
    ctx.fillStyle = e.flash > 0 ? "#ffffff" : d.color;
    if (d.ai === "collector") {
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + t, rr = i % 2 === 1 ? e.r : e.r + 5;
        const x = e.x + Math.cos(a) * rr, y = e.y + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = C.debt; ctx.font = `700 13px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(`回収人 残${Math.round(room.run.debt.total())}秒`, e.x, e.y - e.r - 14);
      ctx.textAlign = "left";
    } else if (d.ai === "boss") {
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, 7); ctx.fill();
      ctx.strokeStyle = C.paperInk; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + Math.cos(t * 2) * e.r * 0.8, e.y + Math.sin(t * 2) * e.r * 0.8);
      ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + Math.cos(t / 6) * e.r * 0.5, e.y + Math.sin(t / 6) * e.r * 0.5);
      ctx.stroke();
    } else if (d.ai === "ranged") {
      ctx.beginPath();
      ctx.moveTo(e.x, e.y - e.r - 2); ctx.lineTo(e.x + e.r, e.y + e.r * 0.8); ctx.lineTo(e.x - e.r, e.y + e.r * 0.8);
      ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, 7); ctx.fill();
      if (d.elite) { ctx.strokeStyle = C.paperInk; ctx.lineWidth = 3; ctx.strokeRect(e.x - 6, e.y - 6, 12, 12); }
    }
    ctx.lineWidth = 1.5;
    if (e.marked) { ctx.strokeStyle = C.shard; ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 7, 0, 7); ctx.stroke(); }
    if (e.slowT > 0) { ctx.strokeStyle = "rgba(107,166,255,.7)"; ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 3, 0, 7); ctx.stroke(); }
    if (e.hp < e.maxHp && d.ai !== "boss") {
      const w = e.r * 2.2;
      ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(e.x - w / 2, e.y - e.r - 9, w, 3);
      ctx.fillStyle = C.debt; ctx.fillRect(e.x - w / 2, e.y - e.r - 9, w * Math.max(0, e.hp / e.maxHp), 3);
    }
  }

  private fxUnder(ctx: CanvasRenderingContext2D, f: Fx): void {
    const k = f.t / f.dur;
    if (f.kind === "warn") {
      const e = f.follow;
      if (!e || e.dead) return;
      ctx.fillStyle = `rgba(229,72,77,${0.1 + 0.2 * k})`;
      ctx.beginPath(); ctx.arc(e.x, e.y, (f.r ?? 0) * k, 0, 7); ctx.fill();
      ctx.strokeStyle = "rgba(229,72,77,.7)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(e.x, e.y, f.r ?? 0, 0, 7); ctx.stroke();
    } else if (f.kind === "burst") {
      ctx.strokeStyle = f.enemy ? `rgba(229,72,77,${1 - k})` : `rgba(242,181,68,${1 - k})`;
      ctx.lineWidth = 8 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(f.x, f.y, (f.r ?? 0) * (0.4 + 0.6 * k), 0, 7); ctx.stroke();
    } else if (f.kind === "slash") {
      ctx.strokeStyle = `rgba(239,231,214,${1 - k})`;
      ctx.lineWidth = 10 * (1 - k) + 2;
      ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.tx ?? f.x, f.ty ?? f.y); ctx.stroke();
    }
  }

  private fxOver(ctx: CanvasRenderingContext2D, f: Fx): void {
    const k = f.t / f.dur;
    if (f.kind === "poof") {
      ctx.fillStyle = rgba(f.color ?? "#ffffff", (1 - k) * 0.6);
      ctx.beginPath(); ctx.arc(f.x, f.y, 6 + 16 * k, 0, 7); ctx.fill();
    } else if (f.kind === "mark") {
      ctx.strokeStyle = `rgba(95,224,200,${1 - k})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(f.x, f.y, 10 + 30 * k, 0, 7); ctx.stroke();
    } else if (f.kind === "gain" || f.kind === "lose" || f.kind === "seize") {
      const col = f.kind === "gain" ? C.shard : f.kind === "seize" ? "#e5a14d" : C.debt;
      ctx.fillStyle = rgba(col, 1 - k);
      ctx.font = `700 18px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(f.text ?? "", f.x, f.y - 24 * k);
      ctx.textAlign = "left";
    }
  }
}
