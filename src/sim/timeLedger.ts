// 寿命残高の唯一の管理者。増減はすべて change() を通す。
// - 上限を超えた分は切り捨て（記録する）
// - 0 になったら死亡。死亡は1回だけ発生し、以後の増減は無視
// - 支払い（スキル・購入・返済）は残高が0にならない時だけ canPay() が true

export interface LogEntry { t: number; room: number; type: string; [k: string]: unknown }
export interface Notice { text: string; kind: string }

export const fmt = (s: number): string => {
  const n = Math.max(0, Math.ceil(s));
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
};

export class TimeLedger {
  time: number;
  maxTime: number;
  gained = 0;
  spent = 0;
  truncated = 0;
  dead = false;
  deathReason = "";
  log: LogEntry[] = [];
  notices: Notice[] = [];   // UIに出す通知
  clock = 0;                // ゲーム内時間（ログ用。RoomSim が進める）
  room = 0;

  constructor(start: number, max: number) {
    this.time = start;
    this.maxTime = max;
  }

  change(delta: number, reason: string): number {
    if (this.dead) return 0;
    const before = this.time;
    let next = before + delta;
    if (next > this.maxTime) {
      const cut = next - this.maxTime;
      this.truncated += cut;
      next = this.maxTime;
      if (reason !== "drain" && cut >= 1) this.notices.push({ text: `上限 ${fmt(this.maxTime)} を超えた ${Math.round(cut)}秒 は切り捨て`, kind: "warn" });
    }
    next = Math.max(next, 0);
    this.time = next;
    const applied = next - before;
    if (applied > 0) this.gained += applied;
    else this.spent -= applied;
    if (reason !== "drain") this.log.push({ t: Math.round(this.clock * 100) / 100, room: this.room, type: "time", reason, delta: Math.round(applied) });
    if (this.time <= 0 && !this.dead) {
      this.dead = true;
      this.deathReason = reason;
      this.log.push({ t: Math.round(this.clock * 100) / 100, room: this.room, type: "death", reason });
    }
    return applied;
  }

  canPay(cost: number): boolean {
    return !this.dead && this.time - cost > 0;
  }

  raiseMax(amount: number): void {
    this.maxTime += amount;
  }
}
