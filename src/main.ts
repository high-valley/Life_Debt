// ゲーム全体の状態機械と配線。
//   title → room ⇄ (reward / book / pause) → map → (shop / contract / rest / room) … → result
// room 以外ではシミュレーションを進めない ＝ 時計（寿命の減少）と敵AIは止まる。
import balance from "../data/balance.json" with { type: "json" };
import { loadBalance } from "./data/dataLoader.ts";
import type { Balance, ContractDef, NodeKind } from "./data/types.ts";
import { InputRouter } from "./input/inputRouter.ts";
import { TouchControls } from "./input/touchControls.ts";
import { Platform, urlFlag } from "./platform.ts";
import { Settings } from "./settings.ts";
import { RoomSim, STEP } from "./sim/roomSim.ts";
import { RunState, type Choice } from "./sim/runState.ts";
import { Menus } from "./ui/menus.ts";
import { Hud } from "./view/hud.ts";
import { RoomView } from "./view/roomView.ts";
import { Sfx } from "./view/sfx.ts";

type State = "title" | "room" | "map" | "shop" | "contract" | "rest" | "reward" | "book" | "pause" | "settings" | "result";
const MAX_STEPS_PER_FRAME = 4;   // 端末が遅い時は「処理落ち（ゆっくり）」にして、追いつこうとする悪循環を防ぐ

class Game {
  state: State = "title";
  readonly D: Balance;
  run: RunState | null = null;
  room: RoomSim | null = null;
  seed = Math.floor(Math.random() * 1_000_000);
  picked: ContractDef | null = null;
  endTimer = 0;
  beatT = 0;

  readonly cv: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly router = new InputRouter();
  readonly touch: TouchControls;
  readonly view = new RoomView();
  readonly hud = new Hud();
  readonly sfx = new Sfx();
  readonly menus: Menus;
  W = 0;
  H = 0;
  DPR = 1;
  perf = { fps: 60, frames: 0, acc: 0 };
  private last = 0;
  private acc = 0;

  constructor() {
    const { D, errors } = loadBalance(balance);
    if (errors.length) {
      document.body.textContent = "データ定義にエラーがあります: " + errors.join(" / ");
      throw new Error(errors.join("\n"));
    }
    this.D = D;
    Settings.load();
    if (urlFlag("fps") !== null) Settings.debugHud = true;
    this.cv = document.getElementById("cv") as HTMLCanvasElement;
    this.ctx = this.cv.getContext("2d", { alpha: false })!;
    this.menus = new Menus(document.getElementById("ui")!);
    this.touch = new TouchControls(this.router);
    this.sfx.setVolume(Settings.volume);

    const r = this.router;
    r.attach(this.cv);
    this.touch.attach(this.cv);
    r.onAnyInput = () => this.sfx.unlock();
    r.onDash = () => { if (this.inRoom()) { const m = r.moveVector(); this.room!.tryDash(m.x, m.y); } };
    r.onSlot = (i) => { if (this.inRoom()) this.room!.p.slot = i; };
    r.onSkill = (i, sp) => { if (this.inRoom()) this.room!.useSkill(i, sp ? this.view.screenToWorld(sp.x, sp.y) : null); };
    r.onInteract = () => {
      const rm = this.room;
      if (this.inRoom() && rm && rm.cleared && rm.kind !== "boss") {
        const d = rm.doorRect();
        if (Math.hypot(rm.p.x - (d.x + d.w / 2), rm.p.y - (d.y + d.h / 2)) < 220) this.openMap();
      }
    };
    r.onBook = () => {
      if (this.state === "room") {
        this.setState("book");
        this.menus.showBook(this.run!, () => this.setState("room"));
      } else if (this.state === "book") {
        this.setState("room");
      }
    };
    r.onPause = () => {
      if (this.state === "room") this.pause();
      else if (this.state === "pause" || this.state === "book") this.setState("room");
    };
    r.onDebug = () => { Settings.debugHud = !Settings.debugHud; Settings.save(); };
    r.onHotkey = (i) => { if (this.state === "map" || this.state === "reward" || this.state === "rest") this.menus.pressHotkey(i); };
    r.onTouchMode = (on) => { this.menus.touchMode = on; };
    r.onBlur = () => { if (this.state === "room") this.pause(); };
    r.setTouchMode(Platform.prefersTouch());
    this.menus.touchMode = r.touchMode;
    document.addEventListener("pointerdown", () => this.sfx.unlock(), { capture: true });

    addEventListener("resize", () => this.resize());
    this.resize();
    this.toTitle();
    requestAnimationFrame((t) => { this.last = t; this.frame(t); });
  }

  private inRoom(): boolean {
    return this.state === "room" && this.room !== null && this.run !== null && this.run.result === "";
  }

  // ---------------------------------------------------------------- loop
  resize(): void {
    const rc = this.cv.getBoundingClientRect();
    // 画面の細かさは最大2倍まで（3倍で描いても見た目はほぼ同じで、描く量は2倍以上になる）
    this.DPR = Math.min(2, window.devicePixelRatio || 1) * (urlFlag("lowres") !== null ? 0.5 : 1);
    this.W = rc.width;
    this.H = rc.height;
    this.cv.width = Math.max(1, Math.round(this.W * this.DPR));
    this.cv.height = Math.max(1, Math.round(this.H * this.DPR));
    this.touch.W = this.W;
    this.touch.H = this.H;
  }

  frame(now: number): void {
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.25) dt = 0.25;
    const p = this.perf;
    p.frames++;
    p.acc += dt;
    if (p.acc >= 0.5) { p.fps = p.frames / p.acc; p.frames = 0; p.acc = 0; }
    if (this.cv.clientWidth !== Math.round(this.W) || this.cv.clientHeight !== Math.round(this.H)) this.resize();

    if (this.run && (this.state === "room" || this.run.result !== "")) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n < MAX_STEPS_PER_FRAME) {
        this.acc -= STEP;
        n++;
        this.tick();
        if (this.state !== "room" && (!this.run || this.run.result === "")) { this.acc = 0; break; }
        if (this.state === "result") break;
      }
      if (n >= MAX_STEPS_PER_FRAME) this.acc = 0;
    } else {
      this.acc = 0;
    }
    this.view.update(dt, this.room, this.W, this.H, this.router.touchMode);
    this.hud.update(dt);
    this.render();
    requestAnimationFrame((t) => this.frame(t));
  }

  private tick(): void {
    const run = this.run!, room = this.room!;
    if (this.state === "room" && run.result === "") {
      const aim = this.router.touchMode ? null : this.view.screenToWorld(this.router.mouse.x, this.router.mouse.y);
      const m = this.router.moveVector();
      room.step(STEP, m.x, m.y, aim, this.router.shootHeld);
      this.drain();
      if (room.justCleared && this.D.nodes[room.kind].reward) this.openReward();
      else if (room.justCleared && room.kind !== "boss") this.hud.toast("扉が開いた →", "good");
      else if (room.atDoor()) { this.sfx.play("door"); this.openMap(); }
      if (run.ledger.time < 30 && run.result === "") {
        this.beatT -= STEP;
        if (this.beatT <= 0) {
          this.beatT = Math.max(0.35, run.ledger.time / 30);
          this.sfx.play("beat");
        }
      }
    }
    if (run.result !== "" && this.state !== "result") {
      if (this.state === "room") {
        room.step(STEP, 0, 0, null, false);   // 撃破・死亡演出を少しだけ流す
        this.drain();
      }
      this.endTimer -= STEP;
      if (this.endTimer <= 0) this.showResult();
    }
  }

  private drain(): void {
    for (const e of this.room!.drainEvents()) {
      if (e.type === "fx") this.view.addFx(e);
      else if (e.type === "sfx") this.sfx.play(e.name);
      else if (e.type === "toast") this.hud.toast(e.text, e.kind);
      else if (e.type === "shake" && Settings.shake) this.view.addShake(e.amount);
    }
  }

  private render(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
    ctx.fillStyle = "#0e1015";
    ctx.fillRect(0, 0, this.W, this.H);
    if (!this.run || !this.room) {
      this.drawTitleBg();
      return;
    }
    this.view.draw(ctx, this.room, this.router);
    this.hud.draw(ctx, this.run, this.room, this.W, this.H, {
      touch: this.router.touchMode, running: this.state === "room" && this.run.result === "", flash: Settings.flash, debug: Settings.debugHud, fps: this.perf.fps,
    });
    if (this.router.touchMode && this.state === "room") this.touch.draw(ctx, this.room, this.run);
  }

  private drawTitleBg(): void {
    const ctx = this.ctx, t = performance.now() / 1000;
    const cx = this.W * 0.72, cy = this.H * 0.5, R = Math.min(this.W, this.H) * 0.38;
    ctx.strokeStyle = "rgba(242,181,68,.10)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.moveTo(cx + Math.cos(a) * R * 0.9, cy + Math.sin(a) * R * 0.9); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    }
    ctx.stroke();
    ctx.strokeStyle = "rgba(242,181,68,.18)"; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(t - Math.PI / 2) * R * 0.8, cy + Math.sin(t - Math.PI / 2) * R * 0.8);
    ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(t / 12 - Math.PI / 2) * R * 0.5, cy + Math.sin(t / 12 - Math.PI / 2) * R * 0.5);
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  // ---------------------------------------------------------------- states
  setState(s: State): void {
    this.state = s;
    this.router.gameplayEnabled = s === "room";
    this.touch.reset();
    if (s === "room") this.menus.hideAll();
  }

  private start(seed: number): void {
    this.seed = seed;
    this.run = new RunState(this.D, seed);
    this.endTimer = 1.4;
    this.hud.clear();
    this.enterRoom("battle");
    this.run.route.push("battle");
    this.hud.toast("時計が動き出した。敵を倒して寿命を奪え", "warn", 3);
  }

  private enterRoom(kind: NodeKind): void {
    this.room = new RoomSim(this.run!, kind);
    this.view.clear();
    this.setState("room");
    if (kind === "boss") {
      this.hud.toast("時間管理局長：「その寿命、国家に返してもらう」", "debt", 3);
      this.sfx.play("boss");
    }
  }

  toTitle(): void {
    this.run = null;
    this.room = null;
    this.view.clear();
    this.hud.clear();
    this.setState("title");
    this.menus.seed = this.seed;
    this.menus.showTitle({ play: (s) => this.start(s), settings: () => this.openSettings(() => this.toTitle()) });
  }

  private pause(): void {
    this.setState("pause");
    this.menus.showPause({ resume: () => this.setState("room"), settings: () => this.openSettings(() => this.pause()), title: () => this.toTitle() });
  }

  private openSettings(back: () => void): void {
    this.setState("settings");
    this.menus.showSettings({ back, volume: (v) => this.sfx.setVolume(v) });
  }

  private openMap(): void {
    this.setState("map");
    this.menus.showMap(this.run!, this.run!.nextChoices(), (c) => this.pickNode(c));
  }

  /** 部屋遷移: RunState.enterNode が「部屋番号 → 満期処理（1回だけ）」を行い、その後に次の区画を開く */
  private pickNode(c: Choice): void {
    const run = this.run!;
    if (this.state !== "map") return;
    const notices = run.enterNode(c.kind);
    for (const n of notices) this.hud.toast(n.text, n.kind === "pay" ? "warn" : "debt", 3.2);
    if (notices.some((n) => n.kind === "pay")) this.sfx.play("pay");
    if (run.result !== "") {
      this.menus.hideAll();
      return;
    }
    const nd = this.D.nodes[c.kind];
    if (nd.combat) {
      this.enterRoom(c.kind);
    } else if (c.kind === "shop" || c.kind === "premium") {
      if (c.kind === "premium" && !run.premiumRested) {
        run.premiumRested = true;
        run.rest();
        this.hud.toast(`高級区画で休息：+${this.D.rest_gain}秒`, "good");
      }
      this.setState("shop");
      this.showShop(c.kind === "premium");
    } else if (c.kind === "contract") {
      this.picked = null;
      this.setState("contract");
      this.showContract();
    } else if (c.kind === "rest") {
      this.setState("rest");
      this.menus.showRest(run, () => {
        run.rest();
        this.sfx.play("gain");
        this.openMap();
      }, (ct) => {
        if (run.debt.repayEarly(ct, run.ledger)) {
          this.sfx.play("pay");
          this.hud.toast(`#${ct.uid} を早期返済`, "good");
          this.openMap();
        }
      });
    }
  }

  private showShop(premium: boolean): void {
    const run = this.run!;
    this.menus.showShop(run, premium, (item) => {
      if (run.buy(item, premium)) {
        this.sfx.play("pay");
        this.hud.toast(`${item.name} を購入`, "good");
      }
      this.showShop(premium);
    }, () => this.openMap());
  }

  private showContract(): void {
    const run = this.run!;
    this.menus.showContract(run, this.picked, {
      pick: (c) => { this.picked = c; this.showContract(); },
      sign: () => {
        const c = this.picked;
        if (c && run.debt.sign(c, run.roomIndex, run.ledger)) {
          this.sfx.play("loan");
          this.hud.toast(`${c.name} に署名：+${c.principal}秒`, "warn");
          this.picked = null;
        }
        this.showContract();
      },
      leave: () => this.openMap(),
    });
  }

  private openReward(): void {
    const run = this.run!;
    this.setState("reward");
    this.menus.showReward(run, run.rollRewards(), (id) => {
      run.applyReward(id);
      this.setState("room");
      this.hud.toast("扉が開いた →", "good");
    });
  }

  private showResult(): void {
    this.setState("result");
    this.menus.showResult(this.run!, {
      same: () => this.start(this.seed),
      fresh: () => this.start(Math.floor(Math.random() * 1_000_000)),
      title: () => this.toTitle(),
    });
  }
}

// 開発・計測用にコンソールから触れるようにしておく
(globalThis as unknown as { __ld: Game }).__ld = new Game();
