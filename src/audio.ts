import * as Tone from "tone";

export const STEPS = 16;
export const DRUM_TRACKS = ["キック", "スネア", "ハイハット", "クラップ"] as const;
export const SYNTH_TRACK_NAME = "シンセ";
export const TRACK_NAMES = [...DRUM_TRACKS, SYNTH_TRACK_NAME] as const;
export const TRACK_COUNT = TRACK_NAMES.length;
export const SYNTH_INDEX = DRUM_TRACKS.length;

export type DrumPattern = boolean[][];

/** シンセの簡易入力用の音階(1オクターブ、ハ長調) */
export const SCALE = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"] as const;
export type Note = (typeof SCALE)[number];
export type SynthPattern = (Note | null)[];

export const WAVEFORMS = ["sawtooth", "square", "sine"] as const;
export type Waveform = (typeof WAVEFORMS)[number];
export const WAVEFORM_LABELS: Record<Waveform, string> = {
  sawtooth: "ノコギリ波",
  square: "矩形波",
  sine: "サイン波",
};

export function emptyDrumPattern(): DrumPattern {
  return DRUM_TRACKS.map(() => Array<boolean>(STEPS).fill(false));
}

export function emptySynthPattern(): SynthPattern {
  return Array<Note | null>(STEPS).fill(null);
}

/** 最初から音が鳴るよう、定番の4つ打ちパターンを返す */
export function defaultDrumPattern(): DrumPattern {
  const p = emptyDrumPattern();
  for (let i = 0; i < STEPS; i += 4) p[0][i] = true; // キック
  p[1][4] = p[1][12] = true; // スネア
  for (let i = 2; i < STEPS; i += 4) p[2][i] = true; // ハイハット
  p[3][12] = true; // クラップ
  return p;
}

/** シンセも最初から短いフレーズが鳴るようにする */
export function defaultSynthPattern(): SynthPattern {
  const p = emptySynthPattern();
  p[0] = "C4";
  p[6] = "E4";
  p[10] = "G4";
  return p;
}

export function defaultVolumes(): number[] {
  return [80, 75, 55, 65, 75];
}

export function defaultMutes(): boolean[] {
  return Array<boolean>(TRACK_COUNT).fill(false);
}

type StepListener = (step: number) => void;

/**
 * 音声エンジン。UI(React)とは分離し、再描画が再生に影響しないようにする。
 * 音源はすべてWeb Audioで合成する(外部のサンプル取得なし)。
 */
export class AudioEngine {
  private started = false;
  private drumPattern: DrumPattern = defaultDrumPattern();
  private synthPattern: SynthPattern = defaultSynthPattern();
  private waveform: Waveform = "sawtooth";
  private volumes: number[] = defaultVolumes();
  private mutes: boolean[] = defaultMutes();
  private step = 0;
  private onStep: StepListener | null = null;
  private kick!: Tone.MembraneSynth;
  private snare!: Tone.NoiseSynth;
  private hat!: Tone.NoiseSynth;
  private clap!: Tone.NoiseSynth;
  private synth!: Tone.Synth;
  private channels: Tone.Channel[] = [];

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
    this.channels = TRACK_NAMES.map(() => new Tone.Channel().connect(master));

    this.kick = new Tone.MembraneSynth({
      pitchDecay: 0.04,
      octaves: 6,
      envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 },
    }).connect(this.channels[0]);
    this.snare = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.18, sustain: 0 },
    }).connect(new Tone.Filter(1800, "highpass").connect(this.channels[1]));
    this.hat = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0 },
      volume: -12,
    }).connect(new Tone.Filter(7000, "highpass").connect(this.channels[2]));
    this.clap = new Tone.NoiseSynth({
      noise: { type: "pink" },
      envelope: { attack: 0.002, decay: 0.15, sustain: 0 },
    }).connect(new Tone.Filter(1200, "bandpass").connect(this.channels[3]));
    this.synth = new Tone.Synth({
      oscillator: { type: this.waveform },
      envelope: { attack: 0.01, decay: 0.15, sustain: 0.1, release: 0.2 },
    }).connect(this.channels[SYNTH_INDEX]);

    TRACK_NAMES.forEach((_, i) => this.applyChannel(i));

    Tone.getTransport().scheduleRepeat((time) => this.tick(time), "16n");
    this.started = true;
  }

  private applyChannel(i: number): void {
    const ch = this.channels[i];
    if (!ch) return;
    const gain = this.volumes[i] / 100;
    ch.volume.value = gain <= 0 ? -Infinity : Tone.gainToDb(gain);
    ch.mute = this.mutes[i];
  }

  private tick(time: number): void {
    const s = this.step;
    const d = this.drumPattern;
    if (d[0][s]) this.kick.triggerAttackRelease("C1", "8n", time);
    if (d[1][s]) this.snare.triggerAttackRelease("16n", time);
    if (d[2][s]) this.hat.triggerAttackRelease("32n", time);
    if (d[3][s]) this.clap.triggerAttackRelease("16n", time);
    const note = this.synthPattern[s];
    if (note) this.synth.triggerAttackRelease(note, "8n", time);
    // 画面の再生位置表示は、音のタイミングに合わせて更新する
    Tone.getDraw().schedule(() => this.onStep?.(s), time);
    this.step = (s + 1) % STEPS;
  }

  setDrumPattern(p: DrumPattern): void {
    this.drumPattern = p;
  }

  setSynthPattern(p: SynthPattern): void {
    this.synthPattern = p;
  }

  setWaveform(w: Waveform): void {
    this.waveform = w;
    this.synth?.set({ oscillator: { type: w } });
  }

  setVolume(trackIndex: number, percent: number): void {
    this.volumes[trackIndex] = percent;
    this.applyChannel(trackIndex);
  }

  setMute(trackIndex: number, muted: boolean): void {
    this.mutes[trackIndex] = muted;
    this.applyChannel(trackIndex);
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
