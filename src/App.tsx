import { useEffect, useMemo, useRef, useState } from "react";
import * as Tone from "tone";
import {
  AudioEngine,
  DEFAULT_STEPS,
  DRUM_CHANNEL_KEYS,
  DRUM_TRACKS,
  MAX_SYNTH_TRACKS,
  SCALE,
  STEP_OPTIONS,
  WAVEFORMS,
  WAVEFORM_LABELS,
  defaultDrumPattern,
  defaultSynthTrack,
  defaultTrackEffects,
  emptyDrumPattern,
  emptySynthPattern,
  resizeDrumPattern,
  resizeSynthPattern,
  type DrumPattern,
  type Note,
  type StepCount,
  type SynthTrack,
  type TrackEffects,
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
  const [steps, setSteps] = useState<number>(DEFAULT_STEPS);
  const [drumPattern, setDrumPattern] = useState<DrumPattern>(defaultDrumPattern);
  const [synthTracks, setSynthTracks] = useState<SynthTrack[]>(() => [defaultSynthTrack("シンセ")]);
  const [volumes, setVolumes] = useState<Record<string, number>>(() =>
    Object.fromEntries(synthTracks.map((t) => [t.id, 75])),
  );
  const [mutes, setMutes] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(synthTracks.map((t) => [t.id, false])),
  );
  const [selectedNotes, setSelectedNotes] = useState<Record<string, Note>>(() =>
    Object.fromEntries(synthTracks.map((t) => [t.id, "C4" as Note])),
  );
  const [effects, setEffects] = useState<Record<string, TrackEffects>>(() =>
    Object.fromEntries(synthTracks.map((t) => [t.id, defaultTrackEffects()])),
  );
  const [expandedTracks, setExpandedTracks] = useState<Set<string>>(() => new Set());
  const [showMixer, setShowMixer] = useState(false);
  const [current, setCurrent] = useState(-1);
  const [latencyInfo, setLatencyInfo] = useState("");
  const busy = useRef(false);
  const loaded = useRef(false);
  const [restored, setRestored] = useState(false);

  // 起動時に保存済みプロジェクトを読み込み、音声エンジンへシンセトラックを登録する
  useEffect(() => {
    (async () => {
      const project = await loadProject();
      let finalTracks = synthTracks;
      if (project) {
        setBpm(project.bpm);
        setSteps(project.steps);
        setDrumPattern(project.drumPattern);
        setSynthTracks(project.synthTracks);
        setVolumes(project.volumes);
        setMutes(project.mutes);
        setEffects(project.effects);
        const notes: Record<string, Note> = {};
        project.synthTracks.forEach((t) => (notes[t.id] = "C4"));
        setSelectedNotes(notes);
        finalTracks = project.synthTracks;
      }
      finalTracks.forEach((t) => engine.addSynthTrack(t.id, t.waveform, t.pattern));
      loaded.current = true;
      setRestored(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engine.setStepListener(setCurrent);
    return () => engine.setStepListener(null);
  }, [engine]);

  useEffect(() => engine.setSteps(steps), [engine, steps]);
  useEffect(() => engine.setDrumPattern(drumPattern), [engine, drumPattern]);
  useEffect(() => {
    synthTracks.forEach((t) => {
      engine.setSynthPattern(t.id, t.pattern);
      engine.setSynthWaveform(t.id, t.waveform);
    });
  }, [engine, synthTracks]);
  useEffect(() => {
    Object.entries(volumes).forEach(([k, v]) => engine.setVolume(k, v));
  }, [engine, volumes]);
  useEffect(() => {
    Object.entries(mutes).forEach(([k, m]) => engine.setMute(k, m));
  }, [engine, mutes]);
  useEffect(() => {
    Object.entries(effects).forEach(([k, fx]) => {
      engine.setPan(k, fx.pan);
      engine.setEq(k, "eqLow", fx.eqLow);
      engine.setEq(k, "eqMid", fx.eqMid);
      engine.setEq(k, "eqHigh", fx.eqHigh);
      engine.setReverbSend(k, fx.reverbSend);
      engine.setDelaySend(k, fx.delaySend);
    });
  }, [engine, effects]);
  useEffect(() => {
    if (ready) engine.setBpm(bpm);
  }, [engine, ready, bpm]);

  // 読み込み完了後、変更があれば自動保存する(操作を妨げないよう少し待ってまとめて保存)
  useEffect(() => {
    if (!loaded.current) return;
    const project: Project = {
      version: PROJECT_VERSION,
      steps,
      bpm,
      drumPattern,
      synthTracks,
      volumes,
      mutes,
      effects,
    };
    const timer = setTimeout(() => saveProject(project), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [steps, bpm, drumPattern, synthTracks, volumes, mutes, effects]);

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

  const toggleSynthStep = (trackId: string, s: number) => {
    const note = selectedNotes[trackId] ?? "C4";
    setSynthTracks((prev) =>
      prev.map((t) =>
        t.id === trackId ? { ...t, pattern: t.pattern.map((n, j) => (j === s ? (n === note ? null : note) : n)) } : t,
      ),
    );
  };

  const selectNote = (trackId: string, note: Note) => {
    setSelectedNotes((prev) => ({ ...prev, [trackId]: note }));
  };

  const setSynthWaveform = (trackId: string, waveform: Waveform) => {
    setSynthTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, waveform } : t)));
  };

  const addSynthTrack = () => {
    if (synthTracks.length >= MAX_SYNTH_TRACKS) return;
    const track = defaultSynthTrack(`シンセ${synthTracks.length + 1}`);
    const resized = { ...track, pattern: resizeSynthPattern(track.pattern, steps) };
    engine.addSynthTrack(resized.id, resized.waveform, resized.pattern);
    setSynthTracks((prev) => [...prev, resized]);
    setVolumes((prev) => ({ ...prev, [resized.id]: 75 }));
    setMutes((prev) => ({ ...prev, [resized.id]: false }));
    setSelectedNotes((prev) => ({ ...prev, [resized.id]: "C4" }));
    setEffects((prev) => ({ ...prev, [resized.id]: defaultTrackEffects() }));
  };

  const removeSynthTrack = (trackId: string) => {
    engine.removeSynthTrack(trackId);
    setSynthTracks((prev) => prev.filter((t) => t.id !== trackId));
    setVolumes((prev) => {
      const next = { ...prev };
      delete next[trackId];
      return next;
    });
    setMutes((prev) => {
      const next = { ...prev };
      delete next[trackId];
      return next;
    });
    setSelectedNotes((prev) => {
      const next = { ...prev };
      delete next[trackId];
      return next;
    });
    setEffects((prev) => {
      const next = { ...prev };
      delete next[trackId];
      return next;
    });
    setExpandedTracks((prev) => {
      const next = new Set(prev);
      next.delete(trackId);
      return next;
    });
  };

  const setQuantize = (next: StepCount) => {
    if (next === steps) return;
    setDrumPattern((prev) => resizeDrumPattern(prev, next));
    setSynthTracks((prev) => prev.map((t) => ({ ...t, pattern: resizeSynthPattern(t.pattern, next) })));
    setSteps(next);
  };

  const clearAll = () => {
    setDrumPattern(emptyDrumPattern(steps));
    setSynthTracks((prev) => prev.map((t) => ({ ...t, pattern: emptySynthPattern(steps) })));
  };

  const setVolume = (key: string, v: number) => {
    setVolumes((prev) => ({ ...prev, [key]: v }));
  };

  const setMute = (key: string) => {
    setMutes((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const updateEffect = (key: string, patch: Partial<TrackEffects>) => {
    setEffects((prev) => ({ ...prev, [key]: { ...(prev[key] ?? defaultTrackEffects()), ...patch } }));
  };

  const toggleExpanded = (key: string) => {
    setExpandedTracks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderMixerRow = (key: string, label: string) => {
    const fx = effects[key] ?? defaultTrackEffects();
    const expanded = expandedTracks.has(key);
    return (
      <div className="mixer-track" key={key}>
        <div className="mixer-row">
          <span className="mixer-name">{label}</span>
          <input
            className="mixer-slider"
            type="range"
            min={0}
            max={100}
            value={volumes[key] ?? 0}
            onChange={(e) => setVolume(key, Number(e.target.value))}
            aria-label={`${label} 音量`}
          />
          <button
            className={"mute-btn" + (mutes[key] ? " is-muted" : "")}
            onClick={() => setMute(key)}
            aria-label={`${label} ミュート`}
            aria-pressed={!!mutes[key]}
          >
            M
          </button>
          <button
            className="expand-btn"
            onClick={() => toggleExpanded(key)}
            aria-label={`${label} エフェクト詳細`}
            aria-expanded={expanded}
          >
            {expanded ? "▴" : "▾"}
          </button>
        </div>
        {expanded && (
          <div className="mixer-detail">
            <label className="detail-row">
              <span>パン</span>
              <input
                type="range"
                min={-100}
                max={100}
                value={fx.pan}
                onChange={(e) => updateEffect(key, { pan: Number(e.target.value) })}
                aria-label={`${label} パン`}
              />
            </label>
            <label className="detail-row">
              <span>低音</span>
              <input
                type="range"
                min={-12}
                max={12}
                value={fx.eqLow}
                onChange={(e) => updateEffect(key, { eqLow: Number(e.target.value) })}
                aria-label={`${label} 低音`}
              />
            </label>
            <label className="detail-row">
              <span>中音</span>
              <input
                type="range"
                min={-12}
                max={12}
                value={fx.eqMid}
                onChange={(e) => updateEffect(key, { eqMid: Number(e.target.value) })}
                aria-label={`${label} 中音`}
              />
            </label>
            <label className="detail-row">
              <span>高音</span>
              <input
                type="range"
                min={-12}
                max={12}
                value={fx.eqHigh}
                onChange={(e) => updateEffect(key, { eqHigh: Number(e.target.value) })}
                aria-label={`${label} 高音`}
              />
            </label>
            <label className="detail-row">
              <span>リバーブ</span>
              <input
                type="range"
                min={0}
                max={100}
                value={fx.reverbSend}
                onChange={(e) => updateEffect(key, { reverbSend: Number(e.target.value) })}
                aria-label={`${label} リバーブ`}
              />
            </label>
            <label className="detail-row">
              <span>ディレイ</span>
              <input
                type="range"
                min={0}
                max={100}
                value={fx.delaySend}
                onChange={(e) => updateEffect(key, { delaySend: Number(e.target.value) })}
                aria-label={`${label} ディレイ`}
              />
            </label>
          </div>
        )}
      </div>
    );
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

        {synthTracks.map((track) => (
          <section className="track" key={track.id}>
            <div className="synth-track-header">
              <h2 className="track-name">{track.name}</h2>
              <div className="segmented mini">
                {WAVEFORMS.map((w) => (
                  <button
                    key={w}
                    className={"segmented-btn" + (w === track.waveform ? " is-selected" : "")}
                    onClick={() => setSynthWaveform(track.id, w)}
                    aria-pressed={w === track.waveform}
                    aria-label={`${track.name} 波形 ${WAVEFORM_LABELS[w]}`}
                  >
                    {WAVEFORM_LABELS[w].slice(0, 2)}
                  </button>
                ))}
              </div>
              <button
                className="remove-btn"
                onClick={() => removeSynthTrack(track.id)}
                aria-label={`${track.name} を削除`}
              >
                ✕
              </button>
            </div>
            <div className="note-picker">
              {SCALE.map((n) => (
                <button
                  key={n}
                  className={"note" + (n === selectedNotes[track.id] ? " is-selected" : "")}
                  onClick={() => selectNote(track.id, n)}
                  aria-label={`${track.name} 音階 ${n}`}
                  aria-pressed={n === selectedNotes[track.id]}
                >
                  {n.replace("5", "'")}
                </button>
              ))}
            </div>
            <div className="grid">
              {track.pattern.map((note, s) => (
                <button
                  key={s}
                  className={
                    "step" +
                    (note ? " is-on" : "") +
                    (s % 4 === 0 ? " is-beat" : "") +
                    (s === current ? " is-current" : "")
                  }
                  onClick={() => toggleSynthStep(track.id, s)}
                  aria-label={`${track.name} ${s + 1}${note ? ` ${note}` : ""}`}
                  aria-pressed={!!note}
                >
                  {note ? note.replace("5", "'") : ""}
                </button>
              ))}
            </div>
          </section>
        ))}

        {synthTracks.length < MAX_SYNTH_TRACKS && (
          <button className="ghost add-track" onClick={addSynthTrack}>
            + シンセを追加
          </button>
        )}
      </main>

      <footer className="footer">
        <button className="ghost" onClick={clearAll}>
          全消去
        </button>
        <p className="info">
          {latencyInfo || "フェーズ3:ミキサー(パン・EQ・リバーブ/ディレイ)に対応"}
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

            <div className="mixer-row quantize-row">
              <span className="mixer-name">クオンタイズ</span>
              <div className="segmented">
                {STEP_OPTIONS.map((n) => (
                  <button
                    key={n}
                    className={"segmented-btn" + (n === steps ? " is-selected" : "")}
                    onClick={() => setQuantize(n)}
                    aria-pressed={n === steps}
                  >
                    1/{n}
                  </button>
                ))}
              </div>
            </div>

            {DRUM_TRACKS.map((name, i) => renderMixerRow(DRUM_CHANNEL_KEYS[i], name))}
            {synthTracks.map((track) => renderMixerRow(track.id, track.name))}
          </div>
        </div>
      )}
    </div>
  );
}
