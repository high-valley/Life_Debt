// テスト共通: データ読み込みとランの作成
import { readFileSync } from "node:fs";
import { loadBalance } from "../src/data/dataLoader.ts";
import type { ContractDef } from "../src/data/types.ts";
import { RunState } from "../src/sim/runState.ts";

export const RAW_TEXT = readFileSync(new URL("../data/balance.json", import.meta.url), "utf8");
export const loaded = loadBalance(JSON.parse(RAW_TEXT));
export const D = loaded.D;

export const newRun = (seed = 1): RunState => new RunState(D, seed);
export const contract = (id: string): ContractDef => D.contracts.find((c) => c.id === id)!;
export const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
