// 戦闘HUD（表示専用）。大型の寿命カウントダウン、区画、借金、スキル、トースト、低残寿命の演出。
import type { RoomSim } from "../sim/roomSim.ts";
import type { RunState } from "../sim/runState.ts";
import { fmt } from "../sim/timeLedger.ts";
import { pad, uiScale } from "../ui/hudLayout.ts";
import { C, FONT, MONO, TOAST_COLOR } from "./theme.ts";

interface Toast { text: string; kind: string; t: number }

export class Hud {
  toasts: Toast[] = [];

  toast(text: string, kind = "muted", dur = 2.2): void {
    this.toasts.push({ text, kind, t: dur });
    if (this.toasts.length > 4) this.toasts.shift();
  }

  update(dt: number): void {
    for (const t of this.toasts) t.t -= dt;
    this.toasts = this.toasts.filter((t) => t.t > 0);
  }

  clear(): void {
    this.toasts = [];
  }

  draw(ctx: CanvasRenderingContext2D, run: RunState, room: RoomSim, W: number, H: number, o: { touch: boolean; running: boolean; flash: boolean; debug: boolean; fps: number }): void {
    const u = uiScale(W, H), p = pad(W, H), t = run.ledger.time, low = t < 60;
    const f = (px: number, w = 400, face = FONT): string => `${w} ${Math.round(px * u)}px ${face}`;
    // 低残寿命: 画面端を赤く脈動させる（設定で抑制可）
    if (low && o.running) {
      const pulse = o.flash ? 0.5 + 0.5 * Math.sin(run.elapsed * (t < 20 ? 10 : 5)) : 0.6;
      const a = (1 - t / 60) * (0.25 + 0.25 * pulse);
      const w = Math.min(W, H) * 0.18;
      for (let i = 0; i < 8; i++) {
        const k = i / 8, inset = w * k;
        ctx.strokeStyle = `rgba(229,72,77,${(a * (1 - k) * 0.35).toFixed(3)})`;
        ctx.lineWidth = w / 8;
        ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
      }
    }
    ctx.textBaseline = "middle";
    // 寿命カウントダウン
    const big = W > 1000 ? 50 : 38;
    ctx.textAlign = "center";
    ctx.fillStyle = low ? C.debt : t < 300 ? C.brass : C.paper;
    ctx.font = f(big, 700, MONO);
    ctx.fillText(fmt(t), W / 2, p + (big / 2) * u);
    ctx.fillStyle = C.muted; ctx.font = f(11);
    ctx.fillText(o.running ? `残寿命  上限 ${fmt(run.ledger.maxTime)}` : "残寿命（時計停止中）", W / 2, p + (big + 8) * u);
    if (room.boss && !room.boss.dead) {
      const bw = Math.min(400 * u, W - 220), y = p + (big + 18) * u;
      ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(W / 2 - bw / 2, y, bw, 9 * u);
      ctx.fillStyle = C.brass; ctx.fillRect(W / 2 - bw / 2, y, bw * Math.max(0, room.boss.hp / room.boss.maxHp), 9 * u);
      ctx.fillStyle = C.paper; ctx.font = f(12, 700);
      ctx.fillText("時間管理局長", W / 2, y + 20 * u);
    }
    // 区画（左上）
    ctx.textAlign = "left";
    const nd = run.D.nodes[room.kind];
    ctx.fillStyle = C.paper; ctx.font = f(14, 700);
    ctx.fillText(`エリア${run.area()} · 区画 ${run.roomIndex + 1}/${run.D.rooms_total + 1}`, p, p + 10 * u);
    ctx.fillStyle = C.muted; ctx.font = f(11);
    ctx.fillText(`${nd.icon} ${nd.name}${room.dropMul > 1 ? "（ドロップ+50%）" : ""}  敵 ${room.foes.length}`, p, p + 28 * u);
    // 借金（右上。スマホはボタンを避ける）
    ctx.textAlign = "right";
    const right = W - p - (o.touch ? 100 : 0);
    const open = run.debt.openContracts();
    ctx.fillStyle = run.debt.defaulted().length ? C.debt : open.length ? C.brass : C.muted;
    ctx.font = f(14, 700);
    ctx.fillText(open.length ? `借金 ${Math.round(run.debt.total())}秒` : "借金なし", right, p + 10 * u);
    ctx.font = f(11);
    open.forEach((c, i) => {
      ctx.fillStyle = c.state === "defaulted" ? C.debt : "#cdbf9c";
      ctx.fillText(`#${c.uid} ${Math.round(c.outstanding)}秒 · ${run.debt.dueText(c, run.roomIndex)}`, right, p + (28 + i * 15) * u);
    });
    ctx.textAlign = "left";
    // スキル（PCのみ。スマホはタッチボタンに表示）
    if (!o.touch) {
      const sw = 120 * u, sh = 46 * u, gap = 8 * u;
      const x0 = W / 2 - (sw * 3 + gap * 2) / 2, y0 = H - sh - p;
      for (let i = 0; i < 3; i++) {
        const sk = run.D.skills[i], cost = run.skillCost(i), ok = run.ledger.canPay(cost);
        const x = x0 + i * (sw + gap);
        ctx.fillStyle = "rgba(23,28,36,.92)"; ctx.fillRect(x, y0, sw, sh);
        const cd = room.p.skillCd[i] / sk.cd;
        if (cd > 0) { ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(x, y0 + sh * (1 - cd), sw, sh * cd); }
        const sel = room.p.slot === i;
        ctx.strokeStyle = sel ? C.brass : C.edge; ctx.lineWidth = sel ? 2 : 1; ctx.strokeRect(x, y0, sw, sh);
        ctx.fillStyle = ok ? C.paper : "#6b675d"; ctx.font = f(13, 700);
        ctx.fillText(sk.name, x + 9 * u, y0 + 15 * u);
        ctx.fillStyle = ok ? C.brass : C.debt; ctx.font = f(12);
        ctx.fillText(`−${cost}s`, x + 9 * u, y0 + 33 * u);
        ctx.fillStyle = C.muted; ctx.fillText(String(i + 1), x + sw - 14 * u, y0 + 13 * u);
      }
      ctx.lineWidth = 1;
    }
    // トースト
    let ty = H * (o.touch ? 0.3 : 0.25);
    ctx.textAlign = "center";
    ctx.font = f(14, 700);
    for (const tt of this.toasts) {
      const a = Math.min(1, tt.t * 2);
      const tw = ctx.measureText(tt.text).width + 26;
      ctx.globalAlpha = a;
      ctx.fillStyle = "rgba(13,15,20,.85)"; ctx.fillRect(W / 2 - tw / 2, ty - 13 * u, tw, 26 * u);
      ctx.fillStyle = TOAST_COLOR[tt.kind] ?? C.paper;
      ctx.fillText(tt.text, W / 2, ty);
      ty += 30 * u;
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    if (o.debug) {
      ctx.fillStyle = C.ok; ctx.font = `12px ${MONO}`;
      [`FPS ${o.fps.toFixed(0)}`, `room ${room.id}`, `game ${run.elapsed.toFixed(1)}s`,
        `contracts ${run.debt.contracts.map((c) => `#${c.uid}:${c.state}@${c.due_room}`).join(" ")}`, `seed ${run.seed}  log ${run.ledger.log.length}`]
        .forEach((l, i) => ctx.fillText(l, p, p + 50 * u + i * 16));
    }
    ctx.textBaseline = "alphabetic";
  }
}
