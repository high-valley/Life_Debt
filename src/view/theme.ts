// 色と書体（Canvas と DOM の両方で使う）。日本語は端末に入っている書体を使う（iPhone=ヒラギノ、Windows=游ゴシック/メイリオ）。
export const FONT = `"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Yu Gothic", Meiryo, "Noto Sans JP", "Noto Sans CJK JP", sans-serif`;
export const MONO = `ui-monospace, "SF Mono", Menlo, Consolas, monospace`;

export const C = {
  ink: "#0e1015",
  slate: "#181b23",
  edge: "#2a2f3b",
  paper: "#efe7d6",     // 文字・契約書の紙
  paperInk: "#24201a",
  muted: "#9a9688",
  brass: "#f2b544",     // 強調・寿命
  shard: "#5fe0c8",     // 時間片・良い知らせ
  debt: "#e5484d",      // 借金・危険
  ok: "#7be08a",
} as const;

export const TOAST_COLOR: Record<string, string> = { debt: C.debt, warn: C.brass, good: C.shard };
