// data/balance.json の型。バランス値はコードに書かず、すべてここから参照する。

export interface Skill { id: string; name: string; cost: number; cd: number; damage?: number; radius?: number; length?: number; slow?: number; slow_time?: number; bonus?: number; desc: string }

export interface EnemyDef {
  id: string; name: string; hp: number; speed: number; radius: number; damage: number; drop: number;
  ai: "chase" | "ranged" | "collector" | "boss"; color: string;
  range?: number; interval?: number; elite?: boolean; hp_per_debt?: number;
  aoe?: { damage: number; radius: number; interval: number; windup: number };
  summon_interval?: number; volley_interval?: number;
}

export interface ContractDef { id: string; name: string; principal: number; repay: number; due: number }
export interface ShopItem { id: string; name: string; price: number; desc: string }
export interface RewardDef { id: string; name: string; desc: string }
export interface NodeDef { name: string; icon: string; desc: string; combat?: boolean; reward?: boolean; risk?: boolean; safe?: boolean; drop_mul?: number }

export type NodeKind = "battle" | "elite" | "shop" | "contract" | "rest" | "premium" | "alley" | "boss";

export interface Balance {
  schema_version: number;
  time: { start: number; max: number; gate_threshold: number; drain_per_sec: number };
  player: { speed: number; radius: number; dash_speed: number; dash_time: number; dash_cd: number; hit_iframe: number; shot_interval: number; shot_speed: number; shot_damage: number; pickup_radius: number };
  skills: Skill[];
  enemies: Record<string, EnemyDef>;
  area_hp_scale: number;
  contracts: ContractDef[];
  max_contracts: number;
  seize_rate: number;
  shop: ShopItem[];
  premium_discount: number;
  rest_gain: number;
  rewards: RewardDef[];
  nodes: Record<NodeKind, NodeDef>;
  node_weights: Partial<Record<NodeKind, number>>;
  rooms_total: number;
  gate_room: number;
  room_size: [number, number];
  geometries: [number, number, number][][];
}
