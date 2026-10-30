import * as Tone from "tone";

export const DRUM_TRACKS = ["キック", "スネア", "ハイハット", "クラップ"] as const;
export const DRUM_CHANNEL_KEYS = DRUM_TRACKS.map((_, i) => `drum${i}`);

export const DEFAULT_STEPS = 16;
/** クオンタイズ(分解能)の選択肢。1ループあたりのステップ数 */
export const STEP_OPTIONS = [8, 16, 32] as const;
export type StepCount = (typeof STEP_OPTIONS)[number];

/** 性能上の上限(R3対策)。ドラム4 + シンセ最大3 = 最大7トラック */
export const MAX_SYNTH_TRACKS = 3;

/** ピアノロール入力用の音階(ハ長調、C3〜C5の2オクターブ) */
export const SCALE = [
  "C3", "D3", "E3", "F3", "G3", "A3", "B3",
  "C4", "D4", "E4", "F4", "G4", "A4", "B4",
  "C5",
] as const;
export type Note = (typeof SCALE)[number];

export type DrumPattern = boolean[][];
export type SynthPattern = (Note | null)[];

export const WAVEFORMS = ["sawtooth", "square", "sine"] as const;
export type Waveform = (typeof WAVEFORMS)[number];
export const WAVEFORM_LABELS: Record<Waveform, string> = {
  sawtooth: "ノコギリ波",
  square: "矩形波",
  sine: "サイン波",
};

export interface SynthTrack {
  id: string;
  name: string;
  waveform: Waveform;
  pattern: SynthPattern;
}

/** トラックごとのミキサー設定(パン・3バンドEQ・リバーブ/ディレイの送り量) */
export interface TrackEffects {
  pan: number; // -100(左)〜100(右)
  eqLow: number; // dB、-12〜12
  eqMid: number;
  eqHigh: number;
  reverbSend: number; // 0〜100(%)
  delaySend: number; // 0〜100(%)
}
export type EqBand = "eqLow" | "eqMid" | "eqHigh";

export function defaultTrackEffects(): TrackEffects {
  return { pan: 0, eqLow: 0, eqMid: 0, eqHigh: 0, reverbSend: 0, delaySend: 0 };
}

export const DEFAULT_DRUM_VOLUMES: Record<string, number> = {
  drum0: 80,
  drum1: 75,
  drum2: 55,
  drum3: 65,
};
export const DEFAULT_SYNTH_VOLUME = 75;

export function emptyDrumPattern(steps: number): DrumPattern {
  return DRUM_TRACKS.map(() => Array<boolean>(steps).fill(false));
}

export function emptySynthPattern(steps: number): SynthPattern {
  return Array<Note | null>(steps).fill(null);
}

/** 最初から音が鳴るよう、定番の4つ打ちパターンを返す(常に16ステップ基準) */
export function defaultDrumPattern(): DrumPattern {
  const p = emptyDrumPattern(DEFAULT_STEPS);
  for (let i = 0; i < DEFAULT_STEPS; i += 4) p[0][i] = true; // キック
  p[1][4] = p[1][12] = true; // スネア
  for (let i = 2; i < DEFAULT_STEPS; i += 4) p[2][i] = true; // ハイハット
  p[3][12] = true; // クラップ
  return p;
}

/** シンセも最初から短いフレーズが鳴るようにする(常に16ステップ基準) */
export function defaultSynthPattern(): SynthPattern {
  const p = emptySynthPattern(DEFAULT_STEPS);
  p[0] = "C4";
  p[6] = "E4";
  p[10] = "G4";
  return p;
}

export function defaultSynthTrack(name: string): SynthTrack {
  return { id: crypto.randomUUID(), name, waveform: "sawtooth", pattern: emptySynthPattern(DEFAULT_STEPS) };
}

/** クオンタイズ(分解能)変更時に、既存パターンを新しいステップ数へ切り詰め/0埋めする */
export function resizeDrumPattern(p: DrumPattern, steps: number): DrumPattern {
  return p.map((row) => {
    const out = Array<boolean>(steps).fill(false);
    for (let i = 0; i < Math.min(row.length, steps); i++) out[i] = row[i];
    return out;
  });
}

export function resizeSynthPattern(p: SynthPattern, steps: number): SynthPattern {
  const out = Array<Note | null>(steps).fill(null);
  for (let i = 0; i < Math.min(p.length, steps); i++) out[i] = p[i];
  return out;
}

type StepListener = (step: number) => void;

interface SynthMeta {
  waveform: Waveform;
  pattern: SynthPattern;
}

/**
 * 音声エンジン。UI(React)とは分離し、再描画が再生に影響しないようにする。
 * 音源はすべてWeb Audioで合成する(外部のサンプル取得なし)。
 *
 * ミキサー構成(R3対策):リバーブ・ディレイはトラックごとに生成せず、
 * 共有の1バスに各トラックから送り量(センド)で混ぜる方式にして負荷を抑える。
 * [楽器] → EQ3 → ┬→ Channel(音量/パン/ミュート) → master
 *                ├→ reverbSend(Gain) → 共有Reverb → master
 *                └→ delaySend(Gain) → 共有Delay  → master
 */
export class AudioEngine {
  private started = false;
  private steps: number = DEFAULT_STEPS;
  private drumPattern: DrumPattern = defaultDrumPattern();
  private volumes: Record<string, number> = { ...DEFAULT_DRUM_VOLUMES };
  private mutes: Record<string, boolean> = {};
  private effects: Record<string, TrackEffects> = {};
  private step = 0;
  private onStep: StepListener | null = null;
  private master: Tone.Gain | null = null;
  private reverb: Tone.JCReverb | null = null;
  private delay: Tone.FeedbackDelay | null = null;
  private kick!: Tone.MembraneSynth;
  private snare!: Tone.NoiseSynth;
  private hat!: Tone.NoiseSynth;
  private clap!: Tone.NoiseSynth;
  private channels = new Map<string, Tone.Channel>();
  private eqs = new Map<string, Tone.EQ3>();
  private reverbSends = new Map<string, Tone.Gain>();
  private delaySends = new Map<string, Tone.Gain>();
  private synthMeta = new Map<string, SynthMeta>();
  private synths = new Map<string, Tone.Synth>();

  /** 初回のタップ内で呼ぶ(自動再生制限の解除) */
  async start(): Promise<void> {
    if (this.started) {
      await Tone.start();
      return;
    }
    await Tone.start();
    // 反応速度を優先(スマホでは値を上げると音切れしにくい)
    Tone.getContext().lookAhead = 0.05;

    this.master = new Tone.Gain(0.8).toDestination();
    this.reverb = new Tone.JCReverb({ roomSize: 0.4 }).connect(this.master);
    this.reverb.wet.value = 1; // センドバスとして使うため、全量を処理音にする
    this.delay = new Tone.FeedbackDelay({ delayTime: "8n", feedback: 0.3 }).connect(this.master);
    this.delay.wet.value = 1;

    DRUM_CHANNEL_KEYS.forEach((key) => this.createChannelChain(key));

    this.kick = new Tone.MembraneSynth({
      pitchDecay: 0.04,
      octaves: 6,
      envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 },
    }).connect(this.eqs.get(DRUM_CHANNEL_KEYS[0])!);
    const snareFilter = new Tone.Filter(1800, "highpass").connect(this.eqs.get(DRUM_CHANNEL_KEYS[1])!);
    this.snare = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.18, sustain: 0 },
    }).connect(snareFilter);
    const hatFilter = new Tone.Filter(7000, "highpass").connect(this.eqs.get(DRUM_CHANNEL_KEYS[2])!);
    this.hat = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0 },
      volume: -12,
    }).connect(hatFilter);
    const clapFilter = new Tone.Filter(1200, "bandpass").connect(this.eqs.get(DRUM_CHANNEL_KEYS[3])!);
    this.clap = new Tone.NoiseSynth({
      noise: { type: "pink" },
      envelope: { attack: 0.002, decay: 0.15, sustain: 0 },
    }).connect(clapFilter);

    for (const id of this.synthMeta.keys()) this.instantiateSynth(id);

    Tone.getTransport().scheduleRepeat((time) => this.tick(time), "16n");
    this.started = true;
  }

  /** トラック1つ分のミキサー経路(EQ→Channel、EQ→各センド)を作る */
  private createChannelChain(key: string): Tone.EQ3 {
    const channel = new Tone.Channel().connect(this.master!);
    const eq = new Tone.EQ3().connect(channel);
    const reverbSend = new Tone.Gain(0).connect(this.reverb!);
    const delaySend = new Tone.Gain(0).connect(this.delay!);
    eq.connect(reverbSend);
    eq.connect(delaySend);
    this.channels.set(key, channel);
    this.eqs.set(key, eq);
    this.reverbSends.set(key, reverbSend);
    this.delaySends.set(key, delaySend);
    this.applyChannel(key);
    this.applyEffects(key);
    return eq;
  }

  private instantiateSynth(id: string): void {
    const meta = this.synthMeta.get(id);
    if (!meta || !this.master) return;
    const eq = this.createChannelChain(id);
    const synth = new Tone.Synth({
      oscillator: { type: meta.waveform },
      envelope: { attack: 0.01, decay: 0.15, sustain: 0.1, release: 0.2 },
    }).connect(eq);
    this.synths.set(id, synth);
  }

  private applyChannel(key: string): void {
    const channel = this.channels.get(key);
    if (!channel) return;
    const gain = (this.volumes[key] ?? DEFAULT_SYNTH_VOLUME) / 100;
    channel.volume.value = gain <= 0 ? -Infinity : Tone.gainToDb(gain);
    channel.mute = this.mutes[key] ?? false;
  }

  private applyEffects(key: string): void {
    const fx = this.effects[key] ?? defaultTrackEffects();
    const channel = this.channels.get(key);
    const eq = this.eqs.get(key);
    const reverbSend = this.reverbSends.get(key);
    const delaySend = this.delaySends.get(key);
    if (channel) channel.pan.value = fx.pan / 100;
    if (eq) {
      eq.low.value = fx.eqLow;
      eq.mid.value = fx.eqMid;
      eq.high.value = fx.eqHigh;
    }
    if (reverbSend) reverbSend.gain.value = fx.reverbSend / 100;
    if (delaySend) delaySend.gain.value = fx.delaySend / 100;
  }

  private tick(time: number): void {
    const s = this.step;
    const d = this.drumPattern;
    if (d[0]?.[s]) this.kick.triggerAttackRelease("C1", "8n", time);
    if (d[1]?.[s]) this.snare.triggerAttackRelease("16n", time);
    if (d[2]?.[s]) this.hat.triggerAttackRelease("32n", time);
    if (d[3]?.[s]) this.clap.triggerAttackRelease("16n", time);
    for (const [id, meta] of this.synthMeta) {
      const note = meta.pattern[s];
      if (note) this.synths.get(id)?.triggerAttackRelease(note, "8n", time);
    }
    // 画面の再生位置表示は、音のタイミングに合わせて更新する
    Tone.getDraw().schedule(() => this.onStep?.(s), time);
    this.step = (s + 1) % this.steps;
  }

  setSteps(steps: number): void {
    this.steps = steps;
    this.step = 0;
  }

  setDrumPattern(p: DrumPattern): void {
    this.drumPattern = p;
  }

  addSynthTrack(id: string, waveform: Waveform, pattern: SynthPattern): void {
    this.synthMeta.set(id, { waveform, pattern });
    if (this.started) this.instantiateSynth(id);
  }

  removeSynthTrack(id: string): void {
    this.synthMeta.delete(id);
    this.synths.get(id)?.dispose();
    this.synths.delete(id);
    this.eqs.get(id)?.dispose();
    this.eqs.delete(id);
    this.reverbSends.get(id)?.dispose();
    this.reverbSends.delete(id);
    this.delaySends.get(id)?.dispose();
    this.delaySends.delete(id);
    this.channels.get(id)?.dispose();
    this.channels.delete(id);
    delete this.volumes[id];
    delete this.mutes[id];
    delete this.effects[id];
  }

  setSynthPattern(id: string, pattern: SynthPattern): void {
    const meta = this.synthMeta.get(id);
    if (meta) meta.pattern = pattern;
  }

  setSynthWaveform(id: string, waveform: Waveform): void {
    const meta = this.synthMeta.get(id);
    if (meta) meta.waveform = waveform;
    this.synths.get(id)?.set({ oscillator: { type: waveform } });
  }

  setVolume(key: string, percent: number): void {
    this.volumes[key] = percent;
    this.applyChannel(key);
  }

  setMute(key: string, muted: boolean): void {
    this.mutes[key] = muted;
    this.applyChannel(key);
  }

  setPan(key: string, pan: number): void {
    this.effects[key] = { ...(this.effects[key] ?? defaultTrackEffects()), pan };
    this.applyEffects(key);
  }

  setEq(key: string, band: EqBand, db: number): void {
    this.effects[key] = { ...(this.effects[key] ?? defaultTrackEffects()), [band]: db };
    this.applyEffects(key);
  }

  setReverbSend(key: string, percent: number): void {
    this.effects[key] = { ...(this.effects[key] ?? defaultTrackEffects()), reverbSend: percent };
    this.applyEffects(key);
  }

  setDelaySend(key: string, percent: number): void {
    this.effects[key] = { ...(this.effects[key] ?? defaultTrackEffects()), delaySend: percent };
    this.applyEffects(key);
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
