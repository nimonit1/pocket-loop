import { useEffect, useMemo, useRef, useState } from "react";
import * as Tone from "tone";
import { AudioEngine, STEPS, TRACKS, defaultPattern, type Pattern } from "./audio";

const MIN_BPM = 60;
const MAX_BPM = 200;

export default function App() {
  const engine = useMemo(() => new AudioEngine(), []);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [pattern, setPattern] = useState<Pattern>(defaultPattern);
  const [current, setCurrent] = useState(-1);
  const [latencyInfo, setLatencyInfo] = useState("");
  const busy = useRef(false);

  useEffect(() => {
    engine.setStepListener(setCurrent);
    return () => engine.setStepListener(null);
  }, [engine]);

  useEffect(() => engine.setPattern(pattern), [engine, pattern]);
  useEffect(() => {
    if (ready) engine.setBpm(bpm);
  }, [engine, ready, bpm]);

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

  const toggleStep = (t: number, s: number) => {
    setPattern((prev) => prev.map((row, i) => (i === t ? row.map((v, j) => (j === s ? !v : v)) : row)));
  };

  const clearAll = () => setPattern(TRACKS.map(() => Array<boolean>(STEPS).fill(false)));

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
      </header>

      {!ready && (
        <p className="notice">
          「再生」を押すと音が出ます。iPhoneで音が出ない場合は、本体横のマナースイッチ(消音)と音量を確認してください。
        </p>
      )}

      <main className="tracks">
        {TRACKS.map((name, t) => (
          <section className="track" key={name}>
            <h2 className="track-name">{name}</h2>
            <div className="grid">
              {pattern[t].map((on, s) => (
                <button
                  key={s}
                  className={
                    "step" +
                    (on ? " is-on" : "") +
                    (s % 4 === 0 ? " is-beat" : "") +
                    (s === current ? " is-current" : "")
                  }
                  onClick={() => toggleStep(t, s)}
                  aria-label={`${name} ${s + 1}`}
                  aria-pressed={on}
                />
              ))}
            </div>
          </section>
        ))}
      </main>

      <footer className="footer">
        <button className="ghost" onClick={clearAll}>
          全消去
        </button>
        <p className="info">{latencyInfo || "フェーズ0:音の遅延・音切れの検証用"}</p>
      </footer>
    </div>
  );
}
