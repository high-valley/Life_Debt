// 戦闘以外の画面（タイトル / ルート選択 / ショップ / 契約 / 休憩 / 報酬 / 契約書 / ポーズ / 設定 / リザルト）。HTML で作る。
// これらの画面が出ている間は main がシミュレーションを進めないので、時計は止まる。
import type { ContractDef, RewardDef, ShopItem } from "../data/types.ts";
import { Platform } from "../platform.ts";
import { Settings } from "../settings.ts";
import type { Contract } from "../sim/debtBook.ts";
import type { Choice, RunState } from "../sim/runState.ts";
import { fmt } from "../sim/timeLedger.ts";
import { button, h } from "./dom.ts";

export const balLine = (run: RunState): string =>
  `残寿命 ${fmt(run.ledger.time)}（${Math.ceil(run.ledger.time)}秒）  上限 ${fmt(run.ledger.maxTime)}  借金 ${Math.round(run.debt.total())}秒`;

export class Menus {
  readonly root: HTMLElement;
  touchMode = false;
  seed = 0;
  private hotkeys: HTMLButtonElement[] = [];

  constructor(root: HTMLElement) {
    this.root = root;
  }

  private open(cls = ""): HTMLElement {
    this.hotkeys = [];
    const panel = h("div", { class: `panel ${cls}` });
    this.root.replaceChildren(h("div", { class: "ov" }, panel));
    this.root.hidden = false;
    return panel;
  }

  hideAll(): void {
    this.root.hidden = true;
    this.root.replaceChildren();
    this.hotkeys = [];
  }

  pressHotkey(i: number): void {
    const b = this.hotkeys[i];
    if (b && !b.disabled) b.click();
  }

  /** 選択肢カード。tone: "" / "risk" / "safe" / "paper" */
  private card(head: string, title: string, body: string, price: string, onPress: () => void, disabled = false, tone = ""): HTMLButtonElement {
    return h("button", { type: "button", class: `card ${tone}`, disabled, onclick: onPress },
      head ? h("span", { class: "k" }, head) : null,
      h("span", { class: "n" }, title, price ? h("span", { class: "price" }, price) : null),
      body ? h("span", { class: "d" }, body) : null);
  }

  /** 戦闘中の指がそのまま離れて誤タップしないよう、少しだけ押せない時間を作る */
  private guard(buttons: HTMLButtonElement[]): void {
    const was = buttons.map((b) => b.disabled);
    for (const b of buttons) b.disabled = true;
    setTimeout(() => buttons.forEach((b, i) => { b.disabled = was[i]; }), 250);
  }

  // ---------------------------------------------------------------- title / settings
  showTitle(on: { play: (seed: number) => void; settings: () => void }): void {
    const p = this.open("title");
    const seedIn = h("input", { id: "seedIn", inputmode: "numeric", value: String(this.seed), size: 10 });
    const row = h("div", { class: "row" },
      button("契約して始める", () => {
        const n = Number.parseInt(seedIn.value, 10);
        on.play(Number.isFinite(n) ? n : 0);
      }, "primary"),
      button("設定", on.settings));
    if (Platform.canQuit()) row.append(button("終了", () => Platform.quit()));
    p.append(
      h("div", { class: "eyebrow" }, `Prototype · Web · v${__VERSION__}`),
      h("h1", {}, "LIFE ", h("span", {}, "DEBT")),
      h("p", {}, "時債都市では、残りの寿命が通貨になる。撃てば減り、奪えば増え、足りなければ未来の自分から借りる。返せなければ、回収人が来る。"),
      h("label", { for: "seedIn" }, "Seed", seedIn),
      row,
      h("p", { class: "note" }, this.touchMode
        ? "左側ドラッグ 移動 / 通常弾は自動 / 右下ボタン 寿命スキル・ダッシュ / 右上 契約書・ポーズ / 扉に触れると次へ / 横向き推奨"
        : "WASD 移動 / Space ダッシュ / 左クリック長押し 通常弾（無料）/ 右クリック・Q 寿命スキル / 1・2・3 スキル選択 / E・扉に触れる 次へ / Tab 契約書 / Esc・P ポーズ / F3 デバッグ"),
    );
  }

  showSettings(on: { back: () => void; volume: (v: number) => void }): void {
    const p = this.open();
    const vol = h("input", { id: "volIn", type: "range", min: 0, max: 100, step: 5, value: Math.round(Settings.volume * 100) });
    vol.addEventListener("input", () => on.volume(Number(vol.value) / 100));
    const shake = h("input", { type: "checkbox", checked: Settings.shake });
    const flash = h("input", { type: "checkbox", checked: Settings.flash });
    const dbg = h("input", { type: "checkbox", checked: Settings.debugHud });
    p.append(
      h("h2", {}, "設定"),
      h("label", { for: "volIn" }, "音量", vol),
      h("label", { class: "check" }, shake, "被弾時の画面揺れ"),
      h("label", { class: "check" }, flash, "残寿命が少ない時の点滅・脈動"),
      h("label", { class: "check" }, dbg, "デバッグ表示（FPS・部屋ID・契約キュー・seed）"),
      h("div", { class: "row" }, button("戻る", () => {
        Settings.volume = Number(vol.value) / 100;
        Settings.shake = shake.checked;
        Settings.flash = flash.checked;
        Settings.debugHud = dbg.checked;
        Settings.save();
        on.back();
      }, "primary")),
    );
  }

  // ---------------------------------------------------------------- run screens
  showMap(run: RunState, choices: Choice[], onPick: (c: Choice) => void): void {
    const p = this.open();
    const D = run.D, idx = run.roomIndex + 1;
    p.append(h("div", { class: "eyebrow" }, idx >= D.rooms_total ? "最深部" : `エリア ${Math.min(3, Math.floor(idx / 3) + 1)} · 区画 ${idx + 1} / ${D.rooms_total + 1}`),
      h("h2", {}, "次の区画を選ぶ"));
    const info = h("p", { class: "bal" }, balLine(run));
    const due = run.debt.openContracts().filter((c) => c.state === "active" && c.due_room <= idx);
    if (due.length) info.append(h("br"), h("span", { class: "danger" }, `⚠ 次の部屋で満期: ${due.map((c) => `#${c.uid} ${Math.round(c.outstanding)}秒`).join("、")}`));
    if (idx >= D.rooms_total && run.debt.openContracts().length) info.append(h("br"), h("span", { class: "danger" }, "⚠ 局の入口で全契約が満期になる"));
    p.append(info);
    const g = h("div", { class: "cards" });
    for (const node of choices) {
      const nd = D.nodes[node.kind];
      let head = nd.combat ? "戦闘" : "非戦闘・時計停止", disabled = false;
      if (node.gate) {
        disabled = !run.gateOpen();
        head = disabled ? `通行不可：残寿命 ${D.time.gate_threshold}秒 未満` : "階級ゲート：通過の瞬間だけ判定";
      }
      const b = this.card(head, `${nd.icon} ${nd.name}`, nd.desc, "", () => onPick(node), disabled, nd.risk ? "risk" : nd.safe ? "safe" : "");
      g.append(b);
      this.hotkeys.push(b);
    }
    p.append(g);
    this.guard(this.hotkeys);
  }

  showShop(run: RunState, premium: boolean, onBuy: (item: ShopItem) => void, onLeave: () => void): void {
    const p = this.open();
    p.append(h("div", { class: "eyebrow" }, premium ? "Premium district · 3割引＋休息" : "Shop"),
      h("h2", {}, premium ? "高級区画の時計商" : "闇時計店"),
      h("p", {}, "価格はすべて寿命（秒）。店の中では時計は止まっている。"),
      h("p", { class: "bal" }, balLine(run)));
    const g = h("div", { class: "cards two" });
    for (const item of run.D.shop) {
      const price = run.shopPrice(item, premium), ok = run.ledger.canPay(price);
      g.append(this.card(`所持 ${run.mod("shop_" + item.id)}`, item.name, `${item.desc}\n購入後 ${ok ? fmt(run.ledger.time - price) : "— 払えない"}`, `${price}秒`, () => onBuy(item), !ok));
    }
    p.append(g, h("div", { class: "row" }, button("店を出る", onLeave, "primary")));
  }

  showContract(run: RunState, picked: ContractDef | null, on: { pick: (c: ContractDef) => void; sign: () => void; leave: () => void }): void {
    const p = this.open("paper");
    p.append(h("div", { class: "eyebrow" }, "寿命銀行 · 融資契約書"), h("h2", {}, "未来の寿命を借りる"),
      h("p", {}, "返済は満期の部屋に入った瞬間、残寿命から自動で引き落とされる。払えなければ回収人が派遣され、返済完了まで追跡する。"),
      h("p", { class: "bal" }, `${balLine(run)}  契約 ${run.debt.openContracts().length}/${run.debt.maxOpen}件`));
    const full = !run.debt.canSign();
    const g = h("div", { class: "cards" });
    for (const c of run.D.contracts) {
      const sel = picked?.id === c.id;
      const b = this.card(`利息 ${Math.round((c.repay / c.principal - 1) * 100)}%${sel ? "  ● 選択中" : ""}`, c.name,
        `今すぐ +${c.principal}秒 / ${c.due}部屋後に −${c.repay}秒`, "", () => on.pick(c), full, "paper");
      b.setAttribute("aria-pressed", String(sel));
      g.append(b);
    }
    p.append(g);
    if (full) {
      p.append(h("p", { class: "danger" }, `同時に結べる契約は${run.debt.maxOpen}件まで`));
    } else if (picked) {
      const after = run.ledger.time + picked.principal, cut = Math.max(0, after - run.ledger.maxTime);
      p.append(h("pre", { class: "terms" },
        `受取  +${picked.principal}秒 → 残 ${fmt(Math.min(after, run.ledger.maxTime))}${cut > 0 ? `（${Math.round(cut)}秒 切り捨て）` : ""}\n` +
        `返済  ${picked.repay}秒（元本 ${picked.principal} ＋ 利息 ${picked.repay - picked.principal}）\n` +
        `満期  ${picked.due}部屋後の入口（区画 ${run.roomIndex + picked.due + 1}）\n` +
        `不履行時  回収人が戦闘部屋に出現し追跡。ドロップの${Math.round(run.debt.seizeRate * 100)}%を差押え。回収人撃破で清算`));
    }
    p.append(h("div", { class: "row" }, button("署名する", on.sign, "primary", !picked || full), button("借りずに出る", on.leave)));
  }

  showRest(run: RunState, onRest: () => void, onRepay: (c: Contract) => void): void {
    const p = this.open();
    p.append(h("div", { class: "eyebrow" }, "Rest"), h("h2", {}, "配給所の裏で一息つく"), h("p", { class: "bal" }, `どちらか1つを選べる。  ${balLine(run)}`));
    const g = h("div", { class: "cards two" });
    const b = this.card("休息", `+${run.D.rest_gain}秒`, "配給の残りを分けてもらう", "", onRest, false, "safe");
    g.append(b);
    this.hotkeys.push(b);
    for (const c of run.debt.openContracts().filter((x) => x.state === "active")) {
      const e = this.card(`契約 #${c.uid} · ${run.debt.dueText(c, run.roomIndex)}`, "早期返済", `${c.name} の ${Math.round(c.outstanding)}秒 を今払う`,
        `${Math.round(c.outstanding)}秒`, () => onRepay(c), !run.ledger.canPay(c.outstanding));
      g.append(e);
      this.hotkeys.push(e);
    }
    p.append(g);
  }

  showReward(run: RunState, picks: RewardDef[], onPick: (id: string) => void): void {
    const p = this.open();
    p.append(h("div", { class: "eyebrow" }, "Room cleared"), h("h2", {}, "戦利品を1つ選ぶ"));
    const g = h("div", { class: "cards" });
    picks.forEach((r, i) => {
      const b = this.card(`${this.touchMode ? "" : `[${i + 1}] `}所持 ${run.mod(r.id)}`, r.name, r.desc, "", () => onPick(r.id));
      g.append(b);
      this.hotkeys.push(b);
    });
    p.append(g);
    this.guard(this.hotkeys);
  }

  showBook(run: RunState, onClose: () => void): void {
    const p = this.open();
    p.append(h("div", { class: "eyebrow" }, "Contract book · 時計停止中"), h("h2", {}, "契約書"), h("p", { class: "bal" }, `${balLine(run)}  区画 ${run.roomIndex + 1}`));
    if (run.debt.contracts.length === 0) p.append(h("p", {}, "まだ契約はない。寿命銀行の区画で借りられる。"));
    for (const c of run.debt.contracts) {
      const cls = c.state === "defaulted" ? "danger" : c.state === "paid" || c.state === "settled" ? "" : "strong";
      p.append(h("p", { class: cls }, `#${c.uid} ${c.name}  ${c.state === "active" || c.state === "defaulted" ? `残 ${Math.round(c.outstanding)}秒` : ""}  受取 ${c.principal} / 返済 ${c.repay}  — ${run.debt.dueText(c, run.roomIndex)}`));
    }
    const mods = Object.keys(run.mods).filter((k) => !k.startsWith("shop_")).map((k) => `${run.D.rewards.find((r) => r.id === k)?.name ?? k} ×${run.mods[k]}`);
    const costs = run.D.skills.map((s, i) => `${s.name} ${run.skillCost(i)}秒`);
    p.append(h("p", { class: "note" }, `強化: ${mods.length ? mods.join("、") : "なし"}`, h("br"), `スキルコスト: ${costs.join("・")}`),
      h("div", { class: "row" }, button("閉じる", onClose, "primary")));
  }

  showPause(on: { resume: () => void; settings: () => void; title: () => void }): void {
    const p = this.open();
    p.append(h("h2", {}, "ポーズ中"), h("p", {}, "寿命の減少も敵の動きも止まっている。"),
      h("div", { class: "row" }, button("再開", on.resume, "primary"), button("設定", on.settings), button("タイトルへ戻る", on.title)));
  }

  showResult(run: RunState, on: { same: () => void; fresh: () => void; title: () => void }): void {
    const p = this.open();
    const win = run.result === "win";
    let reason = run.reason;
    if (run.debt.openContracts().length) reason += `（未返済の借金 ${Math.round(run.debt.total())}秒 が残った）`;
    p.append(h("div", { class: "eyebrow" }, "Run result"), h("h2", { class: win ? "win" : "lose" }, win ? "勝利：時計は止まった" : "敗北：寿命が尽きた"), h("p", {}, reason));
    const stats = h("div", { class: "stats" });
    const rows: [string, string][] = [["生存時間（戦闘中）", fmt(run.elapsed)], ["累積獲得寿命", `${Math.round(run.ledger.gained)}秒`], ["支払い総額", `${Math.round(run.ledger.spent)}秒`],
      ["最大借金額", `${Math.round(run.debt.maxDebt)}秒`], ["契約回数", String(run.debt.count)], ["到達区画", `${run.roomIndex + 1} / ${run.D.rooms_total + 1}（エリア${run.area()}）`],
      ["上限で切り捨て", `${Math.round(run.ledger.truncated)}秒`], ["seed", String(run.seed)]];
    for (const [k, v] of rows) stats.append(h("div", {}, h("b", {}, v), h("span", {}, k)));
    p.append(stats, h("div", { class: "row" }, button("同じseedで再挑戦", on.same, "primary"), button("新しいseedで挑戦", on.fresh), button("タイトル", on.title)));
  }
}
