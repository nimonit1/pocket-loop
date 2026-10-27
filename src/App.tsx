import { useEffect, useMemo, useRef, useState } from "react";
import * as Tone from "tone";
import {
  AudioEngine,
  DRUM_TRACKS,
  SCALE,
  SYNTH_TRACK_NAME,
  TRACK_NAMES,
  WAVEFORMS,
  WAVEFORM_LABELS,
  defaultDrumPattern,
  defaultMutes,
  defaultSynthPattern,
  defaultVolumes,
  emptyDrumPattern,
  emptySynthPattern,
  type DrumPattern,
  type Note,
  type SynthPattern,
  type Waveform,
} from "./audio";
import { loadProject, saveProject, PROJECT_VERSION, type Project } from "./storage";

const MIN_BPM = 60;
const MAX_BPM = 200;
const SAVE_DELAY_MS = 500;

export default function App() {
  const engine = useMemo(() => new AudioEngine(), []);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [drumPattern, setDrumPattern] = useState<DrumPattern>(defaultDrumPattern);
  const [synthPattern, setSynthPattern] = useState<SynthPattern>(defaultSynthPattern);
  const [synthWaveform, setSynthWaveform] = useState<Waveform>("sawtooth");
  const [volumes, setVolumes] = useState<number[]>(defaultVolumes);
  const [mutes, setMutes] = useState<boolean[]>(defaultMutes);
  const [selectedNote, setSelectedNote] = useState<Note>("C4");
  const [showMixer, setShowMixer] = useState(false);
  const [current, setCurrent] = useState(-1);
  const [latencyInfo, setLatencyInfo] = useState("");
  const busy = useRef(false);
  const loaded = useRef(false);
  const [restored, setRestored] = useState(false);

  // 起動時に保存済みプロジェクトを読み込む
  useEffect(() => {
    (async () => {
      const project = await loadProject();
      if (project) {
        setBpm(project.bpm);
        setDrumPattern(project.drumPattern);
        setSynthPattern(project.synthPattern);
        setSynthWaveform(project.synthWaveform);
        setVolumes(project.volumes);
        setMutes(project.mutes);
      }
      loaded.current = true;
      setRestored(true);
    })();
  }, []);

  useEffect(() => {
    engine.setStepListener(setCurrent);
    return () => engine.setStepListener(null);
  }, [engine]);

  useEffect(() => engine.setDrumPattern(drumPattern), [engine, drumPattern]);
  useEffect(() => engine.setSynthPattern(synthPattern), [engine, synthPattern]);
  useEffect(() => engine.setWaveform(synthWaveform), [engine, synthWaveform]);
  useEffect(() => {
    volumes.forEach((v, i) => engine.setVolume(i, v));
  }, [engine, volumes]);
  useEffect(() => {
    mutes.forEach((m, i) => engine.setMute(i, m));
  }, [engine, mutes]);
  useEffect(() => {
    if (ready) engine.setBpm(bpm);
  }, [engine, ready, bpm]);

  // 読み込み完了後、変更があれば自動保存する(操作を妨げないよう少し待ってまとめて保存)
  useEffect(() => {
    if (!loaded.current) return;
    const project: Project = {
      version: PROJECT_VERSION,
      bpm,
      drumPattern,
      synthPattern,
      synthWaveform,
      volumes,
      mutes,
    };
    const timer = setTimeout(() => saveProject(project), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [bpm, drumPattern, synthPattern, synthWaveform, volumes, mutes]);

  // 画面が隠れたら停止する(バックグラウンドでは音声が止まるため状態を揃える)
  useEffect(() => {
    const onHide = () => {
      if (document.hidden && playing) {
        engine.stop();
        setPlaying(false);
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [engine, playing]);

  const togglePlay = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (!ready) {
        // 初回のタップ内でAudioContextを開始する
        await engine.start();
        engine.setBpm(bpm);
        setReady(true);
        const ctx = Tone.getContext().rawContext as AudioContext;
        const base = ctx.baseLatency?.toFixed(3) ?? "不明";
        const out = ctx.outputLatency?.toFixed(3) ?? "不明";
        setLatencyInfo(
          `状態: ${ctx.state} / ${ctx.sampleRate}Hz / baseLatency ${base}s / outputLatency ${out}s`,
        );
      }
      if (playing) {
        engine.stop();
        setPlaying(false);
      } else {
        engine.play();
        setPlaying(true);
      }
    } finally {
      busy.current = false;
    }
  };

  const toggleDrumStep = (t: number, s: number) => {
    setDrumPattern((prev) => prev.map((row, i) => (i === t ? row.map((v, j) => (j === s ? !v : v)) : row)));
  };

  const toggleSynthStep = (s: number) => {
    setSynthPattern((prev) => prev.map((n, j) => (j === s ? (n === selectedNote ? null : selectedNote) : n)));
  };

  const clearAll = () => {
    setDrumPattern(emptyDrumPattern());
    setSynthPattern(emptySynthPattern());
  };

  const setVolume = (i: number, v: number) => {
    setVolumes((prev) => prev.map((x, j) => (j === i ? v : x)));
  };

  const setMute = (i: number) => {
    setMutes((prev) => prev.map((x, j) => (j === i ? !x : x)));
  };

  return (
    <div className="app">
      <header className="header">
        <button
          className={"play" + (playing ? " is-playing" : "")}
          onClick={togglePlay}
          aria-label={playing ? "停止" : "再生"}
        >
          {playing ? "■ 停止" : "▶ 再生"}
        </button>
        <div className="bpm">
          <span className="bpm-label">BPM</span>
          <button className="bpm-btn" onClick={() => setBpm((b) => Math.max(MIN_BPM, b - 5))} aria-label="BPMを下げる">
            −
          </button>
          <span className="bpm-value">{bpm}</span>
          <button className="bpm-btn" onClick={() => setBpm((b) => Math.min(MAX_BPM, b + 5))} aria-label="BPMを上げる">
            ＋
          </button>
        </div>
        <button className="menu-btn" onClick={() => setShowMixer(true)} aria-label="トラック設定">
          ⋯
        </button>
      </header>

      {!ready && (
        <p className="notice">
          「再生」を押すと音が出ます。iPhoneで音が出ない場合は、本体横のマナースイッチ(消音)と音量を確認してください。
        </p>
      )}

      <main className="tracks">
        {DRUM_TRACKS.map((name, t) => (
          <section className="track" key={name}>
            <h2 className="track-name">{name}</h2>
            <div className="grid">
              {drumPattern[t].map((on, s) => (
                <button
                  key={s}
                  className={
                    "step" +
                    (on ? " is-on" : "") +
                    (s % 4 === 0 ? " is-beat" : "") +
                    (s === current ? " is-current" : "")
                  }
                  onClick={() => toggleDrumStep(t, s)}
                  aria-label={`${name} ${s + 1}`}
                  aria-pressed={on}
                />
              ))}
            </div>
          </section>
        ))}

        <section className="track">
          <h2 className="track-name">{SYNTH_TRACK_NAME}</h2>
          <div className="note-picker">
            {SCALE.map((n) => (
              <button
                key={n}
                className={"note" + (n === selectedNote ? " is-selected" : "")}
                onClick={() => setSelectedNote(n)}
                aria-label={`音階 ${n}`}
                aria-pressed={n === selectedNote}
              >
                {n.replace("4", "").replace("5", "'")}
              </button>
            ))}
          </div>
          <div className="grid">
            {synthPattern.map((note, s) => (
              <button
                key={s}
                className={
                  "step" +
                  (note ? " is-on" : "") +
                  (s % 4 === 0 ? " is-beat" : "") +
                  (s === current ? " is-current" : "")
                }
                onClick={() => toggleSynthStep(s)}
                aria-label={`${SYNTH_TRACK_NAME} ${s + 1}${note ? ` ${note}` : ""}`}
                aria-pressed={!!note}
              >
                {note ? note.replace("4", "").replace("5", "'") : ""}
              </button>
            ))}
          </div>
        </section>
      </main>

      <footer className="footer">
        <button className="ghost" onClick={clearAll}>
          全消去
        </button>
        <p className="info">
          {latencyInfo || "フェーズ1:MVP(保存・音量/ミュート・シンセ入力に対応)"}
          {restored ? "" : " / 読込中…"}
        </p>
      </footer>

      {showMixer && (
        <div className="sheet-backdrop" onClick={() => setShowMixer(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-header">
              <h2>トラック設定</h2>
              <button className="ghost" onClick={() => setShowMixer(false)} aria-label="閉じる">
                閉じる
              </button>
            </div>
            {TRACK_NAMES.map((name, i) => (
              <div className="mixer-row" key={name}>
                <span className="mixer-name">{name}</span>
                <input
                  className="mixer-slider"
                  type="range"
                  min={0}
                  max={100}
                  value={volumes[i]}
                  onChange={(e) => setVolume(i, Number(e.target.value))}
                  aria-label={`${name} 音量`}
                />
                <button
                  className={"mute-btn" + (mutes[i] ? " is-muted" : "")}
                  onClick={() => setMute(i)}
                  aria-label={`${name} ミュート`}
                  aria-pressed={mutes[i]}
                >
                  M
                </button>
              </div>
            ))}
            <div className="mixer-row waveform-row">
              <span className="mixer-name">シンセ波形</span>
              <div className="waveform-group">
                {WAVEFORMS.map((w) => (
                  <button
                    key={w}
                    className={"waveform-btn" + (w === synthWaveform ? " is-selected" : "")}
                    onClick={() => setSynthWaveform(w)}
                    aria-pressed={w === synthWaveform}
                  >
                    {WAVEFORM_LABELS[w]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
