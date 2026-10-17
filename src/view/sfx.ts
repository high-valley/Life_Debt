// 仮の効果音。短い波形をコードで生成する（音源ファイル不要）。
// iPhone のブラウザは「画面に触れた後」でないと音を出せないので、最初の操作で unlock() する。
// [開始Hz, 終了Hz, 秒, 波形, 音量dB]
const SOUNDS: Record<string, [number, number, number, "sine" | "square" | "saw" | "tri", number]> = {
  shot: [900, 700, 0.04, "square", -18], hit: [200, 90, 0.08, "square", -8], gain: [1200, 1800, 0.06, "sine", -12],
  skill: [300, 1200, 0.18, "tri", -8], pay: [600, 300, 0.25, "sine", -6], loan: [300, 900, 0.3, "tri", -6],
  fail: [200, 160, 0.1, "square", -10], beat: [70, 50, 0.12, "sine", -2], boss: [90, 50, 0.5, "saw", -8], door: [440, 880, 0.2, "tri", -8],
};

export class Sfx {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private lastPlay = new Map<string, number>();
  volume = 0.6;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
      this.setVolume(this.volume);
      for (const name of Object.keys(SOUNDS)) this.buffers.set(name, this.make(SOUNDS[name]));
    } catch {
      this.ctx = null;
    }
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.gain) this.gain.gain.value = v * 0.5;
  }

  play(name: string): void {
    const ctx = this.ctx, buf = this.buffers.get(name);
    if (!ctx || !buf || !this.gain || this.volume <= 0.001) return;
    const now = ctx.currentTime;
    if (now - (this.lastPlay.get(name) ?? -1) < 0.03) return;   // 同じ音の連打を間引く
    this.lastPlay.set(name, now);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain);
    src.start();
  }

  private make([f0, f1, dur, wave, db]: [number, number, number, string, number]): AudioBuffer {
    const amp = Math.pow(10, (db + 6) / 20);
    const ctx = this.ctx!;
    const rate = ctx.sampleRate, n = Math.floor(rate * dur);
    const buf = ctx.createBuffer(1, n, rate);
    const d = buf.getChannelData(0);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const k = i / n;
      phase = (phase + (f0 * Math.pow(f1 / f0, k)) / rate) % 1;
      let v: number;
      if (wave === "sine") v = Math.sin(phase * Math.PI * 2);
      else if (wave === "square") v = phase < 0.5 ? 1 : -1;
      else if (wave === "saw") v = phase * 2 - 1;
      else v = 1 - Math.abs(phase * 4 - 2);
      d[i] = v * Math.exp(-k * 5) * 0.5 * amp;
    }
    return buf;
  }
}
