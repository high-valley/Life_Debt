// スマホ用の操作レイヤー。結果は InputRouter のコールバックとして流す。
//   画面左半分ドラッグ = 仮想スティック（指に付いてくる） / 通常弾は自動で見えている敵へ
//   右下 = ダッシュと3つの寿命スキル / 右上 = 契約書・ポーズ
import type { RoomSim } from "../sim/roomSim.ts";
import type { RunState } from "../sim/runState.ts";
import { hitButton, touchButtons, type Btn } from "../ui/hudLayout.ts";
import { C, FONT } from "../view/theme.ts";
import type { InputRouter } from "./inputRouter.ts";
import { followOrigin, JOY_RADIUS, stickVector, type P } from "./stick.ts";

export class TouchControls {
  joy: { id: number; o: P; p: P } | null = null;
  W = 0;
  H = 0;
  private readonly router: InputRouter;

  constructor(router: InputRouter) {
    this.router = router;
  }

  attach(cv: HTMLCanvasElement): void {
    const pos = (e: PointerEvent): P => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    cv.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse") return;
      e.preventDefault();
      const r = this.router;
      r.onAnyInput();
      r.setTouchMode(true);
      if (!r.gameplayEnabled) return;
      const p = pos(e), b = touchButtons(this.W, this.H);
      if (hitButton(p.x, p.y, b.pause)) return r.onPause();
      if (hitButton(p.x, p.y, b.book)) return r.onBook();
      if (hitButton(p.x, p.y, b.dash)) return r.onDash();
      for (const k of ["s0", "s1", "s2"] as const) if (hitButton(p.x, p.y, b[k])) return r.onSkill(b[k].skill!, null);
      if (!this.joy && p.x < this.W * 0.5) {
        try { cv.setPointerCapture(e.pointerId); } catch { /* 古いブラウザ */ }
        this.joy = { id: e.pointerId, o: p, p };
      }
    }, { passive: false });
    cv.addEventListener("pointermove", (e) => {
      const j = this.joy;
      if (!j || j.id !== e.pointerId) return;
      j.p = pos(e);
      j.o = followOrigin(j.o, j.p);
      this.router.touchMove = stickVector(j.o, j.p);
    });
    const end = (e: PointerEvent): void => { if (this.joy && this.joy.id === e.pointerId) this.reset(); };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
  }

  reset(): void {
    this.joy = null;
    this.router.reset();
  }

  draw(ctx: CanvasRenderingContext2D, room: RoomSim, run: RunState): void {
    const b = touchButtons(this.W, this.H), D = run.D;
    this.circle(ctx, b.dash, b.dash.label, "", room.p.dashCd <= 0, room.p.dashCd / D.player.dash_cd, false);
    for (const k of ["s0", "s1", "s2"] as const) {
      const i = b[k].skill!, sk = D.skills[i], cost = run.skillCost(i);
      this.circle(ctx, b[k], sk.name, `−${cost}s`, false, room.p.skillCd[i] / sk.cd, !run.ledger.canPay(cost));
    }
    this.circle(ctx, b.pause, "II", "", false, 0, false);
    this.circle(ctx, b.book, "契", "", false, 0, false);
    if (this.joy) {
      const j = this.joy;
      let dx = j.p.x - j.o.x, dy = j.p.y - j.o.y;
      const l = Math.hypot(dx, dy);
      if (l > JOY_RADIUS) { dx = (dx / l) * JOY_RADIUS; dy = (dy / l) * JOY_RADIUS; }
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(239,231,214,.35)";
      ctx.beginPath(); ctx.arc(j.o.x, j.o.y, JOY_RADIUS, 0, 7); ctx.stroke();
      ctx.fillStyle = "rgba(242,181,68,.6)";
      ctx.beginPath(); ctx.arc(j.o.x + dx, j.o.y + dy, 20, 0, 7); ctx.fill();
    } else if (run.elapsed < 10) {
      ctx.fillStyle = C.muted; ctx.font = `14px ${FONT}`; ctx.textBaseline = "middle";
      ctx.fillText("← 左側ドラッグで移動（弾は自動）", 20, this.H * 0.62);
    }
    if (this.H > this.W) {
      ctx.fillStyle = C.brass; ctx.textAlign = "center"; ctx.font = `14px ${FONT}`;
      ctx.fillText("横向きにすると遊びやすくなります", this.W / 2, 130);
      ctx.textAlign = "left";
    }
    ctx.lineWidth = 1;
    ctx.textBaseline = "alphabetic";
  }

  private circle(ctx: CanvasRenderingContext2D, b: Btn, label: string, sub: string, lit: boolean, cd: number, dim: boolean): void {
    ctx.fillStyle = "rgba(23,28,36,.8)";
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill();
    if (cd > 0) {
      ctx.fillStyle = "rgba(0,0,0,.6)";
      ctx.beginPath(); ctx.moveTo(b.x, b.y);
      ctx.arc(b.x, b.y, b.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * cd);
      ctx.closePath(); ctx.fill();
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = lit ? C.brass : "#3a3f4b";
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.stroke();
    const fs = Math.max(10, Math.round(b.r * (label.length > 3 ? 0.3 : 0.38)));
    ctx.font = `700 ${fs}px ${FONT}`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = dim ? "#6b675d" : C.paper;
    ctx.fillText(label, b.x, b.y - (sub ? b.r * 0.18 : 0));
    if (sub) {
      ctx.fillStyle = dim ? C.debt : C.brass;
      ctx.fillText(sub, b.x, b.y + b.r * 0.35);
    }
    ctx.textAlign = "left";
  }
}
