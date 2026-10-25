import * as Tone from "tone";

export const STEPS = 16;
export const TRACKS = ["キック", "スネア", "ハイハット", "クラップ"] as const;
export type Pattern = boolean[][];

export function emptyPattern(): Pattern {
  return TRACKS.map(() => Array<boolean>(STEPS).fill(false));
}

/** 最初から音が鳴るよう、定番の4つ打ちパターンを返す */
export function defaultPattern(): Pattern {
  const p = emptyPattern();
  for (let i = 0; i < STEPS; i += 4) p[0][i] = true; // キック
  p[1][4] = p[1][12] = true; // スネア
  for (let i = 2; i < STEPS; i += 4) p[2][i] = true; // ハイハット
  p[3][12] = true; // クラップ
  return p;
}

type StepListener = (step: number) => void;

/**
 * 音声エンジン。UI(React)とは分離し、再描画が再生に影響しないようにする。
 * 音源はすべてWeb Audioで合成する(外部のサンプル取得なし)。
 */
export class AudioEngine {
  private started = false;
  private pattern: Pattern = defaultPattern();
  private step = 0;
  private onStep: StepListener | null = null;
  private kick!: Tone.MembraneSynth;
  private snare!: Tone.NoiseSynth;
  private hat!: Tone.NoiseSynth;
  private clap!: Tone.NoiseSynth;

  /** 初回のタップ内で呼ぶ(自動再生制限の解除) */
  async start(): Promise<void> {
    if (this.started) {
      await Tone.start();
      return;
    }
    await Tone.start();
    // 反応速度を優先(スマホでは値を上げると音切れしにくい)
    Tone.getContext().lookAhead = 0.05;

    const master = new Tone.Gain(0.8).toDestination();
    this.kick = new Tone.MembraneSynth({
      pitchDecay: 0.04,
      octaves: 6,
      envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 },
    }).connect(master);
    this.snare = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.18, sustain: 0 },
    }).connect(new Tone.Filter(1800, "highpass").connect(master));
    this.hat = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0 },
      volume: -12,
    }).connect(new Tone.Filter(7000, "highpass").connect(master));
    this.clap = new Tone.NoiseSynth({
      noise: { type: "pink" },
      envelope: { attack: 0.002, decay: 0.15, sustain: 0 },
    }).connect(new Tone.Filter(1200, "bandpass").connect(master));

    Tone.getTransport().scheduleRepeat((time) => this.tick(time), "16n");
    this.started = true;
  }

  private tick(time: number): void {
    const s = this.step;
    const p = this.pattern;
    if (p[0][s]) this.kick.triggerAttackRelease("C1", "8n", time);
    if (p[1][s]) this.snare.triggerAttackRelease("16n", time);
    if (p[2][s]) this.hat.triggerAttackRelease("32n", time);
    if (p[3][s]) this.clap.triggerAttackRelease("16n", time);
    // 画面の再生位置表示は、音のタイミングに合わせて更新する
    Tone.getDraw().schedule(() => this.onStep?.(s), time);
    this.step = (s + 1) % STEPS;
  }

  setPattern(p: Pattern): void {
    this.pattern = p;
  }

  setBpm(bpm: number): void {
    Tone.getTransport().bpm.value = bpm;
  }

  setStepListener(fn: StepListener | null): void {
    this.onStep = fn;
  }

  play(): void {
    this.step = 0;
    Tone.getTransport().start();
  }

  stop(): void {
    Tone.getTransport().stop();
    this.step = 0;
    this.onStep?.(-1);
  }
}
