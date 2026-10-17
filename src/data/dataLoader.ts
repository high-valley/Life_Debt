// data/balance.json を検証する。項目を足したら、ここにも検証を足す。
import type { Balance } from "./types.ts";

const TOP = ["schema_version", "time", "player", "skills", "enemies", "area_hp_scale", "contracts", "max_contracts", "seize_rate",
  "shop", "premium_discount", "rest_gain", "rewards", "nodes", "node_weights", "rooms_total", "gate_room", "room_size", "geometries"];
const ENEMY_AI = ["chase", "ranged", "collector", "boss"];

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);

export function loadBalance(raw: unknown): { D: Balance; errors: string[] } {
  const errors: string[] = [];
  const need = (o: unknown, keys: string[], label: string): boolean => {
    if (!isDict(o)) {
      errors.push(`${label}: 辞書ではない`);
      return false;
    }
    let ok = true;
    for (const k of keys) if (!(k in o)) { errors.push(`${label}: '${k}' がない`); ok = false; }
    return ok;
  };
  const d = raw as Balance;
  if (!need(raw, TOP, "balance")) return { D: d, errors };
  need(d.time, ["start", "max", "gate_threshold", "drain_per_sec"], "time");
  if (!(d.time.start > 0 && d.time.start <= d.time.max)) errors.push("time: start は 0 より大きく max 以下");
  need(d.player, ["speed", "radius", "dash_speed", "dash_time", "dash_cd", "hit_iframe", "shot_interval", "shot_speed", "shot_damage", "pickup_radius"], "player");
  if (d.skills.length !== 3) errors.push("skills: MVPは3つ固定");
  d.skills.forEach((s, i) => need(s, ["id", "name", "cost", "cd"], `skills[${i}]`));
  for (const k of ["debtor", "officer", "enforcer", "collector", "regulator"]) if (!(k in d.enemies)) errors.push(`enemies: '${k}' が必要`);
  for (const id of Object.keys(d.enemies)) {
    const e = d.enemies[id];
    if (!need(e, ["name", "hp", "speed", "radius", "damage", "drop", "ai", "color"], `enemies[${id}]`)) continue;
    e.id = id;
    if (!ENEMY_AI.includes(e.ai)) errors.push(`enemies[${id}]: ai は ${ENEMY_AI.join("/")} のどれか`);
    if (!(e.hp > 0)) errors.push(`enemies[${id}]: hp は正の数`);
    if (!/^#[0-9a-fA-F]{6}$/.test(String(e.color))) errors.push(`enemies[${id}]: color が不正`);
  }
  for (const c of d.contracts) {
    if (!need(c, ["id", "name", "principal", "repay", "due"], `contracts[${String((c as unknown as Dict).id ?? "?")}]`)) continue;
    if (c.repay < c.principal) errors.push(`contracts[${c.id}]: 返済額が元本より少ない（無限増殖になる）`);
    if (c.due < 1) errors.push(`contracts[${c.id}]: due は1部屋以上`);
  }
  for (const s of d.shop) need(s, ["id", "name", "price", "desc"], `shop[${s.id ?? "?"}]`);
  for (const r of d.rewards) need(r, ["id", "name", "desc"], `rewards[${r.id ?? "?"}]`);
  for (const k of Object.keys(d.node_weights)) if (!(k in d.nodes)) errors.push(`node_weights: '${k}' が nodes にない`);
  for (const k of ["battle", "elite", "shop", "contract", "rest", "premium", "alley", "boss"]) if (!(k in d.nodes)) errors.push(`nodes: '${k}' が必要`);
  if (!(d.gate_room > 0 && d.gate_room < d.rooms_total)) errors.push("gate_room は 1〜rooms_total-1");
  if (d.geometries.length === 0) errors.push("geometries: 部屋プリセットが1つもない");
  return { D: d, errors };
}
