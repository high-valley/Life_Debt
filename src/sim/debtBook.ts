// 借金契約の状態機械。
//   active ──(満期の部屋に入る・払える)──▶ paid
//     └────(満期の部屋に入る・払えない)─▶ defaulted ──(回収人撃破 / 差し押さえで完済)──▶ settled
// 返済判定は部屋遷移時に1回だけ（processed に部屋番号を記録して二重実行を防ぐ）。
import type { ContractDef } from "../data/types.ts";
import type { Notice, TimeLedger } from "./timeLedger.ts";

export interface Contract {
  uid: number; id: string; name: string; principal: number; repay: number;
  signed_room: number; due_room: number; outstanding: number;
  state: "active" | "paid" | "defaulted" | "settled"; processed: number;
}

export class DebtBook {
  contracts: Contract[] = [];
  seq = 0;
  count = 0;
  maxDebt = 0;
  maxOpen = 2;
  seizeRate = 0.4;

  openContracts(): Contract[] {
    return this.contracts.filter((c) => c.state === "active" || c.state === "defaulted");
  }

  defaulted(): Contract[] {
    return this.contracts.filter((c) => c.state === "defaulted");
  }

  total(): number {
    return this.openContracts().reduce((s, c) => s + c.outstanding, 0);
  }

  canSign(): boolean {
    return this.openContracts().length < this.maxOpen;
  }

  sign(def: ContractDef, roomIndex: number, ledger: TimeLedger): boolean {
    if (!this.canSign() || ledger.dead) return false;
    this.seq++;
    const c: Contract = {
      uid: this.seq, id: def.id, name: def.name, principal: def.principal, repay: def.repay,
      signed_room: roomIndex, due_room: roomIndex + def.due, outstanding: def.repay, state: "active", processed: -1,
    };
    this.contracts.push(c);
    this.count++;
    ledger.change(def.principal, "loan");
    this.maxDebt = Math.max(this.maxDebt, this.total());
    ledger.log.push({ t: ledger.clock, room: roomIndex, type: "sign", contract: c.uid, due_room: c.due_room });
    return true;
  }

  /** 部屋遷移時に呼ぶ。forceAll（ボス部屋の入口）なら満期前の契約もすべて処理する */
  processDue(roomIndex: number, forceAll: boolean, ledger: TimeLedger): Notice[] {
    const notices: Notice[] = [];
    for (const c of this.contracts) {
      if (c.state !== "active" || c.processed === roomIndex) continue;
      if (!forceAll && c.due_room > roomIndex) continue;
      c.processed = roomIndex;
      if (ledger.canPay(c.outstanding)) {
        ledger.change(-c.outstanding, "repay");
        notices.push({ text: `${c.name} #${c.uid} を返済：−${Math.round(c.outstanding)}秒`, kind: "pay" });
        ledger.log.push({ t: ledger.clock, room: roomIndex, type: "repay", contract: c.uid });
        c.outstanding = 0;
        c.state = "paid";
      } else {
        c.state = "defaulted";
        notices.push({ text: `${c.name} #${c.uid} 返済不能 — 回収人が派遣された`, kind: "debt" });
        ledger.log.push({ t: ledger.clock, room: roomIndex, type: "default", contract: c.uid });
      }
    }
    return notices;
  }

  /** 休憩所での早期返済 */
  repayEarly(c: Contract, ledger: TimeLedger): boolean {
    if (c.state !== "active" || !ledger.canPay(c.outstanding)) return false;
    ledger.change(-c.outstanding, "repay");
    ledger.log.push({ t: ledger.clock, room: ledger.room, type: "repay", contract: c.uid, early: true });
    c.outstanding = 0;
    c.state = "paid";
    return true;
  }

  /** 滞納分を差し押さえで充当。完済したら true */
  seize(amount: number): boolean {
    let left = amount;
    for (const c of this.defaulted()) {
      const take = Math.min(left, c.outstanding);
      c.outstanding -= take;
      left -= take;
      if (left <= 0) break;
    }
    const d = this.defaulted();
    if (d.length > 0 && d.every((c) => c.outstanding <= 0.5)) {
      this.settleDefaulted();
      return true;
    }
    return false;
  }

  settleDefaulted(): boolean {
    let any = false;
    for (const c of this.defaulted()) {
      c.state = "settled";
      c.outstanding = 0;
      any = true;
    }
    return any;
  }

  defaultOutstanding(): number {
    return this.defaulted().reduce((s, c) => s + c.outstanding, 0);
  }

  dueText(c: Contract, roomIndex: number): string {
    if (c.state === "defaulted") return "滞納中：回収人が追跡";
    if (c.state === "paid") return "返済済み";
    if (c.state === "settled") return "清算済み";
    const left = c.due_room - roomIndex;
    return left <= 0 ? "次の部屋で満期" : `あと${left}部屋で満期`;
  }
}
