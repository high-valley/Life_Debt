// HUDとタッチボタンの配置（CSSピクセル）。描画と当たり判定で同じ値を使う。
export interface Btn { x: number; y: number; r: number; label: string; skill?: number }

/** 画面の大きさに合わせた拡大率（スマホ横向き≒0.9、PC≒1.5） */
export const uiScale = (W: number, H: number): number => Math.max(0.85, Math.min(1.6, Math.min(H / 500, W / 900)));

export const pad = (W: number, H: number): number => 14 * uiScale(W, H);

export function touchButtons(W: number, H: number): Record<"dash" | "s0" | "s1" | "s2" | "pause" | "book", Btn> {
  const p = pad(W, H);
  const r = Math.max(32, Math.min(46, H * 0.1));
  const sr = r * 0.82;
  const bx = W - p - r, by = H - p - r;
  return {
    dash: { x: bx, y: by, r, label: "ダッシュ" },
    s0: { x: bx - r * 2.3, y: by + r * 0.15, r: sr, label: "", skill: 0 },
    s1: { x: bx - r * 1.9, y: by - r * 1.75, r: sr, label: "", skill: 1 },
    s2: { x: bx - r * 0.2, y: by - r * 2.35, r: sr, label: "", skill: 2 },
    pause: { x: W - p - 22, y: p + 22, r: 22, label: "II" },
    book: { x: W - p - 72, y: p + 22, r: 22, label: "契" },
  };
}

export const hitButton = (x: number, y: number, b: Btn): boolean => Math.hypot(x - b.x, y - b.y) <= b.r + 10;
