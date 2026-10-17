// キーボード・マウス・タッチを「プレイヤーの意図」に変換する層。
// ゲーム側は入力デバイスを区別せず、ここのコールバックと moveVector() / mouse / shootHeld を使う。
import type { P } from "./stick.ts";

const MOVE: Record<string, [number, number]> = {
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
  KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1],
};

export class InputRouter {
  gameplayEnabled = false;
  touchMode = false;
  touchMove: P = { x: 0, y: 0 };
  mouse: P = { x: 0, y: 0 };
  mouseInside = false;
  shootHeld = false;
  slot = 0;
  private keys = new Set<string>();

  onDash: () => void = () => {};
  onSlot: (i: number) => void = () => {};
  /** screen が null ならオートエイム */
  onSkill: (i: number, screen: P | null) => void = () => {};
  onInteract: () => void = () => {};
  onBook: () => void = () => {};
  onPause: () => void = () => {};
  onDebug: () => void = () => {};
  onHotkey: (i: number) => void = () => {};
  onTouchMode: (on: boolean) => void = () => {};
  onBlur: () => void = () => {};
  onAnyInput: () => void = () => {};

  attach(cv: HTMLCanvasElement): void {
    addEventListener("keydown", (e) => {
      this.onAnyInput();
      this.setTouchMode(false);
      if (this.gameplayEnabled && (e.code === "Space" || e.code.startsWith("Arrow"))) e.preventDefault();
      if (e.code === "Tab") e.preventDefault();
      this.keys.add(e.code);
      if (e.repeat) return;
      if (e.code === "Escape" || e.code === "KeyP") return this.onPause();
      if (e.code === "F3") { e.preventDefault(); return this.onDebug(); }
      if (e.code === "Tab") return this.onBook();
      const m = /^Digit([123])$/.exec(e.code);
      if (m) {
        const i = Number(m[1]) - 1;
        this.onHotkey(i);
        if (this.gameplayEnabled) { this.slot = i; this.onSlot(i); }
        return;
      }
      if (!this.gameplayEnabled) return;
      if (e.code === "Space") this.onDash();
      else if (e.code === "KeyQ") this.onSkill(this.slot, this.touchMode ? null : this.mouse);
      else if (e.code === "KeyE") this.onInteract();
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => {
      this.keys.clear();
      this.shootHeld = false;
      this.touchMove = { x: 0, y: 0 };
      this.onBlur();
    });
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.onBlur(); });

    const pos = (e: PointerEvent): P => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    cv.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      const p = pos(e);
      if (Math.hypot(p.x - this.mouse.x, p.y - this.mouse.y) > 3) this.setTouchMode(false);
      this.mouse = p;
      this.mouseInside = true;
    });
    cv.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") this.mouseInside = false; });
    cv.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse") return;
      this.onAnyInput();
      this.setTouchMode(false);
      cv.focus();
      this.mouse = pos(e);
      this.mouseInside = true;
      if (!this.gameplayEnabled) return;
      if (e.button === 0) this.shootHeld = true;
      else if (e.button === 2) this.onSkill(this.slot, this.mouse);
    });
    addEventListener("pointerup", (e) => { if (e.pointerType === "mouse" && e.button === 0) this.shootHeld = false; });
    cv.addEventListener("wheel", (e) => {
      if (!this.gameplayEnabled) return;
      e.preventDefault();
      this.slot = (this.slot + (e.deltaY > 0 ? 1 : 2)) % 3;
      this.onSlot(this.slot);
    }, { passive: false });
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  setTouchMode(on: boolean): void {
    if (on === this.touchMode) return;
    this.touchMode = on;
    if (on) { this.mouseInside = false; this.shootHeld = false; }
    this.onTouchMode(on);
  }

  moveVector(): P {
    if (this.touchMove.x !== 0 || this.touchMove.y !== 0) return this.touchMove;
    let x = 0, y = 0;
    for (const k of this.keys) {
      const v = MOVE[k];
      if (v) { x += v[0]; y += v[1]; }
    }
    return { x, y };
  }

  reset(): void {
    this.touchMove = { x: 0, y: 0 };
  }
}
