// 仕様書 §16「特に重要なエッジケース」を中心にしたテスト（Godot 版 tests/run_tests.gd から移植）
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadBalance } from "../src/data/dataLoader.ts";
import type { NodeKind } from "../src/data/types.ts";
import { followOrigin, JOY_RADIUS, stickVector } from "../src/input/stick.ts";
import { RoomSim, STEP } from "../src/sim/roomSim.ts";
import { contract, D, loaded, near, newRun, RAW_TEXT } from "./helpers.ts";

test("balance.json に検証エラーがない", () => {
  assert.deepEqual(loaded.errors, []);
});

test("壊れたデータ（返済額 < 元本・hp欠落・存在しない区画）を検出する", () => {
  const d = JSON.parse(RAW_TEXT);
  d.contracts[0].repay = 10;
  delete d.enemies.debtor.hp;
  d.node_weights.casino = 5;
  const { errors } = loadBalance(d);
  assert.ok(errors.length >= 3, errors.join(" / "));
});

// ------------------------------------------------------------------ ledger
test("死亡は1回だけ、死亡後は増えない", () => {
  const r = newRun();
  r.ledger.time = 5;
  r.ledger.change(-10, "hit");
  r.ledger.change(-10, "hit");
  r.ledger.change(50, "drop");
  r.checkDeath();
  r.checkDeath();
  assert.equal(r.ledger.log.filter((l) => l.type === "death").length, 1);
  assert.equal(r.ledger.time, 0);
  assert.equal(r.result, "lose");
});

test("購入と被弾が続いても残高が一致", () => {
  const r = newRun();
  r.ledger.time = 200;
  assert.ok(r.buy(D.shop[0], false));
  r.ledger.change(-8, "hit");
  assert.ok(near(r.ledger.time, 72), String(r.ledger.time));
  assert.ok(near(r.ledger.spent, 128));
});

test("上限3600で切り捨て、画面に通知する", () => {
  const r = newRun();
  r.ledger.time = 3550;
  r.ledger.change(100, "drop");
  assert.ok(r.ledger.time === 3600 && near(r.ledger.truncated, 50));
  assert.ok(r.ledger.notices.length > 0);
});

test("残高ちょうどは払えない（0になる）", () => {
  const r = newRun();
  r.ledger.time = 20;
  assert.ok(!r.ledger.canPay(20));
  assert.ok(r.ledger.canPay(19));
  assert.ok(!r.buy(D.shop[0], false));
  assert.equal(r.ledger.time, 20);
});

// ------------------------------------------------------------------ contracts
test("満期の引き落としは部屋遷移で1回だけ", () => {
  const r = newRun();
  r.debt.sign(contract("short"), r.roomIndex, r.ledger); // +150 / 2部屋後に170
  const t0 = r.ledger.time;
  r.enterNode("shop");
  assert.equal(r.debt.contracts[0].state, "active", "1部屋目では満期にならない");
  r.enterNode("rest");
  const t1 = r.ledger.time;
  r.debt.processDue(r.roomIndex, false, r.ledger);
  r.debt.processDue(r.roomIndex, false, r.ledger);
  assert.ok(near(t0 - t1, 170));
  assert.equal(r.ledger.time, t1);
  assert.equal(r.ledger.log.filter((l) => l.type === "repay").length, 1);
});

test("遷移中の再入は無視", () => {
  const r = newRun();
  r.transitioning = true;
  const notices = r.enterNode("shop");
  assert.ok(r.roomIndex === 0 && notices.length === 0);
});

test("払えなければ滞納 → 回収人が1体 → 撃破で清算", () => {
  const r = newRun(4);
  r.debt.sign(contract("standard"), r.roomIndex, r.ledger);
  r.ledger.time = 100;
  r.enterNode("shop");
  r.enterNode("rest");
  const notices = r.enterNode("battle");
  assert.equal(r.debt.contracts[0].state, "defaulted");
  assert.ok(notices.some((n) => n.kind === "debt"));
  assert.ok(r.ledger.time > 0 && r.result === "", "返済不能でも即死しない（逃げ道が残る）");
  const room = new RoomSim(r, "battle");
  const col = room.foes.filter((f) => f.def.ai === "collector");
  assert.equal(col.length, 1, "回収人は合算で1体");
  col[0].hp = 0;
  room.step(STEP, 0, 0, null, false);
  assert.equal(r.debt.contracts[0].state, "settled");
});

test("差し押さえで完済したら清算", () => {
  const r = newRun();
  r.debt.sign(contract("short"), 0, r.ledger);
  r.ledger.time = 60;
  r.enterNode("shop");
  r.enterNode("battle");
  const c = r.debt.contracts[0];
  assert.equal(c.state, "defaulted");
  assert.ok(r.debt.seize(c.outstanding + 1));
  assert.equal(c.state, "settled");
});

test("回収人の取り立ては借金に充当", () => {
  const r = newRun();
  r.debt.sign(contract("short"), 0, r.ledger);
  r.ledger.time = 60;
  r.enterNode("shop");
  r.enterNode("battle");
  const room = new RoomSim(r, "battle");
  const before = r.debt.contracts[0].outstanding;
  room.hurtPlayer(15, "collector", true);
  assert.ok(near(before - r.debt.contracts[0].outstanding, 15));
});

test("同時に結べる契約は2件まで", () => {
  const r = newRun();
  assert.ok(r.debt.sign(contract("short"), 0, r.ledger));
  assert.ok(r.debt.sign(contract("short"), 0, r.ledger));
  assert.ok(!r.debt.sign(contract("short"), 0, r.ledger));
});

test("ボスの入口で全契約が満期", () => {
  const r = newRun();
  r.debt.sign(contract("large"), 0, r.ledger);
  r.roomIndex = 1;
  const t0 = r.ledger.time;
  r.enterNode("boss");
  assert.ok(r.debt.contracts[0].state === "paid" && near(t0 - r.ledger.time, 650));
});

test("早期返済", () => {
  const r = newRun();
  r.debt.sign(contract("standard"), 0, r.ledger);
  assert.ok(r.debt.repayEarly(r.debt.contracts[0], r.ledger));
  assert.equal(r.debt.total(), 0);
});

// ------------------------------------------------------------------ route / shop / clock
test("区画5で階級ゲート（300秒以上で通行可）", () => {
  const r = newRun();
  r.roomIndex = D.gate_room - 1;
  const ch = r.nextChoices();
  assert.ok(ch[0].kind === "premium" && ch[0].gate);
  r.ledger.time = 299;
  assert.ok(!r.gateOpen());
  r.ledger.time = 300;
  assert.ok(r.gateOpen());
});

test("高級区画で最大寿命を3割引で購入", () => {
  const r = newRun();
  const max0 = r.ledger.maxTime;
  assert.ok(r.buy(D.shop[2], true));
  assert.equal(r.ledger.maxTime, max0 + 300);
  assert.ok(near(r.ledger.spent, Math.round(150 * 0.7)));
});

test("寿命は戦闘中だけ減る", () => {
  const r = newRun();
  const room = new RoomSim(r, "battle");
  const t0 = r.ledger.time;
  for (let i = 0; i < 60; i++) room.step(STEP, 0, 0, { x: 1000, y: 360 }, false);
  assert.ok(t0 - r.ledger.time >= 0.99, String(t0 - r.ledger.time));
  const t1 = r.ledger.time;
  r.nextChoices();
  r.rollRewards();
  assert.equal(r.ledger.time, t1);
});

test("同じseedで部屋候補・敵構成・報酬が一致し、seedが違えば変わる", () => {
  const trace = (seed: number): string => {
    const r = newRun(seed);
    const out: string[] = [];
    for (let i = 0; i < 6; i++) {
      out.push(r.nextChoices().map((n) => n.kind).join(","));
      out.push(JSON.stringify(new RoomSim(r, "battle").waves));
      out.push(r.rollRewards().map((x) => x.id).join(","));
      r.roomIndex++;
    }
    return out.join("|");
  };
  assert.equal(trace(321), trace(321));
  assert.notEqual(trace(321), trace(322));
});

test("タッチ操作: 大きくスワイプした後でも、少し逆に動かすだけで向きが変わる", () => {
  let o = { x: 100, y: 100 };
  const p = { x: 100, y: 100 };
  for (let i = 0; i < 20; i++) { p.x += 10; o = followOrigin(o, p); }
  assert.ok(Math.hypot(p.x - o.x, p.y - o.y) <= JOY_RADIUS + 0.01);
  assert.ok(stickVector(o, p).x > 0.99);
  for (let i = 0; i < 7; i++) { p.x -= 10; o = followOrigin(o, p); }
  assert.ok(stickVector(o, p).x < 0);
});

// ------------------------------------------------------------------ bot
test("ボット: 残高 = 初期 + 獲得 − 支払い、同seedで同じ結果、ランが決着する", () => {
  const lines: string[] = [];
  let digestA = "";
  for (const seed of [42, 42, 7, 1234, 99]) {
    const r = newRun(seed);
    let room = new RoomSim(r, "battle");
    r.route.push("battle");
    const pickNode = (): NodeKind => {
      const ch = r.nextChoices();
      return ch[0].gate && !r.gateOpen() ? ch[1].kind : ch[0].kind;
    };
    for (let guard = 0; r.result === "" && guard < 60 * 60 * 25; guard++) {
      if (room.justCleared && D.nodes[room.kind].reward) r.applyReward(r.rollRewards()[0].id);
      if (room.atDoor()) {
        const pick = pickNode();
        r.enterNode(pick);
        if (pick === "shop" || pick === "premium") { if (r.ledger.time > 500) r.buy(D.shop[0], pick === "premium"); }
        else if (pick === "contract") r.debt.sign(contract("standard"), r.roomIndex, r.ledger);
        else if (pick === "rest") r.rest();
        if (r.result !== "") break;
        let next: NodeKind = D.nodes[pick].combat ? pick : "battle";
        if (!D.nodes[pick].combat) {
          // 非戦闘区画の後はもう一度マップへ
          const pk = pickNode();
          r.enterNode(pk);
          next = D.nodes[pk].combat ? pk : "battle";
        }
        room = new RoomSim(r, next);
        continue;
      }
      const p = room.p;
      let mx = 0, my = 0;
      const norm = (x: number, y: number): void => { const l = Math.hypot(x, y) || 1; mx = x / l; my = y / l; };
      const nf = room.nearestFoe(p.x, p.y);
      if (room.cleared) {
        const dx = room.W - 10, dy = room.H / 2;
        if (room.los(p.x, p.y, dx, dy, p.r + 2)) norm(dx - p.x, dy - p.y);
        else if (p.y > 120) { mx = 0; my = -1; } else { mx = 1; my = 0; }
      } else if (nf && Math.hypot(nf.x - p.x, nf.y - p.y) < 200) {
        norm(p.x - nf.x, p.y - nf.y);
      } else if (room.shards.length > 0) {
        norm(room.shards[0].x - p.x, room.shards[0].y - p.y);
      }
      if (nf && guard % 90 === 0 && r.ledger.time > 200) room.useSkill(0, null);
      room.step(STEP, mx, my, null, false);
      room.drainEvents();
    }
    assert.ok(Math.abs(D.time.start + r.ledger.gained - r.ledger.spent - r.ledger.time) < 0.01, `残高の式が崩れた (seed ${seed})`);
    const line = `${seed}:${r.result || "timeout"} room${r.roomIndex} t=${Math.round(r.elapsed)}s left=${Math.round(r.ledger.time)}s contracts=${r.debt.count}`;
    if (seed === 42) {
      if (digestA === "") digestA = line;
      else assert.equal(line, digestA, "同seed・同入力で同じ結果");
    }
    lines.push(line);
    assert.ok(r.result !== "", `ボットのランが決着する (seed ${seed})`);
  }
  console.log(`    bot: ${lines.join(", ")}`);
});
