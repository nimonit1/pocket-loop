import {
  DEFAULT_DRUM_VOLUMES,
  DEFAULT_STEPS,
  DEFAULT_SYNTH_VOLUME,
  DRUM_TRACKS,
  type DrumPattern,
  type SynthPattern,
  type SynthTrack,
  type TrackEffects,
  type Waveform,
} from "./audio";

const DB_NAME = "pocket-loop";
const DB_VERSION = 1;
const STORE_NAME = "projects";
const CURRENT_KEY = "current";

export const PROJECT_VERSION = 3;

export interface Project {
  version: typeof PROJECT_VERSION;
  steps: number;
  bpm: number;
  drumPattern: DrumPattern;
  synthTracks: SynthTrack[];
  volumes: Record<string, number>;
  mutes: Record<string, boolean>;
  effects: Record<string, TrackEffects>;
}

/** フェーズ2(複数シンセトラック、ミキサーのエフェクトなし)で保存されたデータの形 */
interface ProjectV2 {
  version: 2;
  steps: number;
  bpm: number;
  drumPattern: DrumPattern;
  synthTracks: SynthTrack[];
  volumes: Record<string, number>;
  mutes: Record<string, boolean>;
}

/** フェーズ1(シンセ1トラック固定)で保存されたデータの形 */
interface ProjectV1 {
  version: 1;
  bpm: number;
  drumPattern: DrumPattern;
  synthPattern: SynthPattern;
  synthWaveform: Waveform;
  volumes: number[];
  mutes: boolean[];
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function isValidV3(data: unknown): data is Project {
  if (!data || typeof data !== "object") return false;
  const p = data as Project;
  return (
    p.version === PROJECT_VERSION &&
    typeof p.steps === "number" &&
    typeof p.bpm === "number" &&
    Array.isArray(p.drumPattern) &&
    p.drumPattern.length === DRUM_TRACKS.length &&
    p.drumPattern.every((row) => Array.isArray(row) && row.length === p.steps) &&
    Array.isArray(p.synthTracks) &&
    p.synthTracks.every(
      (t) => t && typeof t.id === "string" && Array.isArray(t.pattern) && t.pattern.length === p.steps,
    ) &&
    typeof p.volumes === "object" &&
    typeof p.mutes === "object" &&
    typeof p.effects === "object"
  );
}

function isValidV2(data: unknown): data is ProjectV2 {
  if (!data || typeof data !== "object") return false;
  const p = data as ProjectV2;
  return (
    p.version === 2 &&
    typeof p.steps === "number" &&
    typeof p.bpm === "number" &&
    Array.isArray(p.drumPattern) &&
    p.drumPattern.length === DRUM_TRACKS.length &&
    p.drumPattern.every((row) => Array.isArray(row) && row.length === p.steps) &&
    Array.isArray(p.synthTracks) &&
    p.synthTracks.every(
      (t) => t && typeof t.id === "string" && Array.isArray(t.pattern) && t.pattern.length === p.steps,
    ) &&
    typeof p.volumes === "object" &&
    typeof p.mutes === "object"
  );
}

function isValidV1(data: unknown): data is ProjectV1 {
  if (!data || typeof data !== "object") return false;
  const p = data as ProjectV1;
  return (
    p.version === 1 &&
    typeof p.bpm === "number" &&
    Array.isArray(p.drumPattern) &&
    Array.isArray(p.synthPattern) &&
    Array.isArray(p.volumes) &&
    Array.isArray(p.mutes)
  );
}

/** フェーズ2の保存データ(ミキサーのエフェクトなし)へ、空のエフェクト設定を補って変換する */
function migrateV2(v2: ProjectV2): Project {
  return { ...v2, version: PROJECT_VERSION, effects: {} };
}

/** フェーズ1の保存データ(シンセ1トラック固定)を、フェーズ2の形(複数シンセトラック)へ変換する */
function migrateV1(v1: ProjectV1): Project {
  const synthId = "synth-migrated";
  const volumes: Record<string, number> = {};
  const mutes: Record<string, boolean> = {};
  DRUM_TRACKS.forEach((_, i) => {
    volumes[`drum${i}`] = v1.volumes[i] ?? DEFAULT_DRUM_VOLUMES[`drum${i}`];
    mutes[`drum${i}`] = v1.mutes[i] ?? false;
  });
  volumes[synthId] = v1.volumes[DRUM_TRACKS.length] ?? DEFAULT_SYNTH_VOLUME;
  mutes[synthId] = v1.mutes[DRUM_TRACKS.length] ?? false;

  return migrateV2({
    version: 2,
    steps: DEFAULT_STEPS,
    bpm: v1.bpm,
    drumPattern: v1.drumPattern,
    synthTracks: [{ id: synthId, name: "シンセ", waveform: v1.synthWaveform, pattern: v1.synthPattern }],
    volumes,
    mutes,
  });
}

/** 保存されたプロジェクトを読み込む。未保存・読み込み失敗時は null を返す */
export async function loadProject(): Promise<Project | null> {
  try {
    const db = await openDb();
    const data = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(CURRENT_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (isValidV3(data)) return data;
    if (isValidV2(data)) return migrateV2(data);
    if (isValidV1(data)) return migrateV1(data);
    return null;
  } catch {
    return null;
  }
}

/** プロジェクトを保存する。失敗しても操作は継続させる(ストレージ制限時など) */
export async function saveProject(project: Project): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(project, CURRENT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // 保存失敗は無視する(次の操作時に再度保存を試みる)
  }
}
