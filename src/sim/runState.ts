// 1周分の状態と、部屋をまたぐ進行ルール（分岐・遷移・ショップ・報酬）。
// 部屋遷移の順序: ①部屋番号を進める ②満期処理（1回だけ） ③次の区画を開く
// 死亡は TimeLedger が1回だけ確定させ、遷移中に二重に処理されることはない。
import { RngStreams } from "../core/rng.ts";
import type { Balance, NodeKind, RewardDef, ShopItem } from "../data/types.ts";
import { DebtBook } from "./debtBook.ts";
import { TimeLedger, type Notice } from "./timeLedger.ts";

export interface Choice { kind: NodeKind; gate?: boolean }

const DEATH_TEXT: Record<string, string> = {
  drain: "時計が止まった", hit: "被弾で寿命が尽きた", collector: "回収人に寿命を取り立てられた", boss: "時間管理局長に時間を奪われた",
};

export class RunState {
  readonly D: Balance;
  readonly seed: number;
  readonly rng: RngStreams;
  readonly ledger: TimeLedger;
  readonly debt = new DebtBook();
  roomIndex = 0;
  route: NodeKind[] = [];
  mods: Record<string, number> = {};
  elapsed = 0;          // 戦闘中だけ進むゲーム内時間
  result: "" | "win" | "lose" = "";
  reason = "";
  premiumRested = false;
  transitioning = false;

  constructor(D: Balance, seed: number) {
    this.D = D;
    this.seed = seed;
    this.rng = new RngStreams(seed);
    this.ledger = new TimeLedger(D.time.start, D.time.max);
    this.debt.maxOpen = D.max_contracts;
    this.debt.seizeRate = D.seize_rate;
  }

  // ---------------------------------------------------------------- stats
  mod(id: string): number { return this.mods[id] ?? 0; }
  atkMul(): number { return 1 + 0.15 * this.mod("atk"); }
  gainMul(): number { return 1 + 0.2 * this.mod("shop_gain") + 0.1 * this.mod("gain"); }
  pickupRadius(): number { return this.D.player.pickup_radius * (1 + 0.2 * this.mod("pickup")); }
  skillCost(i: number): number { return Math.ceil(this.D.skills[i].cost * Math.max(0.5, 1 - 0.1 * this.mod("skillcost"))); }
  shotInterval(): number { return this.D.player.shot_interval / (1 + 0.15 * this.mod("firerate")); }
  moveSpeed(): number { return this.D.player.speed * (1 + 0.1 * this.mod("speed")); }
  collectorMul(): number { return 1 + 0.3 * this.mod("collector"); }
  area(): number { return Math.min(3, Math.floor(this.roomIndex / 3) + 1); }

  checkDeath(): void {
    if (this.ledger.dead && this.result === "") {
      this.result = "lose";
      this.reason = DEATH_TEXT[this.ledger.deathReason] ?? "寿命が尽きた";
    }
  }

  win(): void {
    if (this.result === "") {
      this.result = "win";
      this.reason = "時間管理局長を倒し、都市の時計を止めた";
      this.ledger.log.push({ t: this.ledger.clock, room: this.roomIndex, type: "win" });
    }
  }

  // ---------------------------------------------------------------- route
  nextChoices(): Choice[] {
    const D = this.D, idx = this.roomIndex + 1;
    if (idx >= D.rooms_total) return [{ kind: "boss" }];
    if (idx === D.gate_room) return [{ kind: "premium", gate: true }, { kind: "alley" }];
    const n = this.rng.map.randf() < 0.45 ? 3 : 2;
    const out: Choice[] = [];
    const entries = Object.entries(D.node_weights) as [NodeKind, number][];
    const total = entries.reduce((s, [, w]) => s + w, 0);
    for (let guard = 0; out.length < n && guard < 100; guard++) {
      let r = this.rng.map.randf() * total;
      let pick: NodeKind = entries[0][0];
      for (const [k, w] of entries) {
        r -= w;
        pick = k;
        if (r <= 0) break;
      }
      if (out.some((o) => o.kind === pick)) continue;
      out.push({ kind: pick });
    }
    if (!out.some((o) => D.nodes[o.kind].combat)) out[0] = { kind: "battle" };
    return out;
  }

  gateOpen(): boolean {
    return this.ledger.time >= this.D.time.gate_threshold;
  }

  /** 部屋遷移。満期処理の結果（通知）を返す。二重呼び出しは無視する */
  enterNode(kind: NodeKind): Notice[] {
    if (this.transitioning || this.result !== "") return [];
    this.transitioning = true;
    this.roomIndex++;
    this.ledger.room = this.roomIndex;
    this.route.push(kind);
    const notices = this.debt.processDue(this.roomIndex, kind === "boss", this.ledger);
    this.ledger.log.push({ t: this.ledger.clock, room: this.roomIndex, type: "enter", kind });
    this.transitioning = false;
    this.checkDeath();
    return notices;
  }

  // ---------------------------------------------------------------- shop / rest / reward
  shopPrice(item: ShopItem, premium: boolean): number {
    return Math.round(item.price * (premium ? this.D.premium_discount : 1));
  }

  buy(item: ShopItem, premium: boolean): boolean {
    const price = this.shopPrice(item, premium);
    if (!this.ledger.canPay(price)) return false;
    this.ledger.change(-price, "purchase");
    this.mods["shop_" + item.id] = this.mod("shop_" + item.id) + 1;
    if (item.id === "atk") this.mods.atk = this.mod("atk") + 1;
    else if (item.id === "skillcost") this.mods.skillcost = this.mod("skillcost") + 1;
    else if (item.id === "maxtime") this.ledger.raiseMax(300);
    return true;
  }

  rest(): void {
    this.ledger.change(this.D.rest_gain, "rest");
  }

  rollRewards(): RewardDef[] {
    const pool = [...this.D.rewards];
    const out: RewardDef[] = [];
    while (out.length < 3 && pool.length > 0) out.push(pool.splice(this.rng.reward.int(0, pool.length - 1), 1)[0]);
    return out;
  }

  applyReward(id: string): void {
    this.mods[id] = this.mod(id) + 1;
    this.ledger.log.push({ t: this.ledger.clock, room: this.roomIndex, type: "reward", id });
  }
}
