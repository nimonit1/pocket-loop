import { STEPS, TRACK_COUNT, type DrumPattern, type SynthPattern, type Waveform } from "./audio";

const DB_NAME = "pocket-loop";
const DB_VERSION = 1;
const STORE_NAME = "projects";
const CURRENT_KEY = "current";

export const PROJECT_VERSION = 1;

export interface Project {
  version: typeof PROJECT_VERSION;
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

/** 保存データの形が壊れていないか最低限確認する(破損時は読み込まない) */
function isValidProject(data: unknown): data is Project {
  if (!data || typeof data !== "object") return false;
  const p = data as Project;
  return (
    p.version === PROJECT_VERSION &&
    typeof p.bpm === "number" &&
    Array.isArray(p.drumPattern) &&
    p.drumPattern.every((row) => Array.isArray(row) && row.length === STEPS) &&
    Array.isArray(p.synthPattern) &&
    p.synthPattern.length === STEPS &&
    Array.isArray(p.volumes) &&
    p.volumes.length === TRACK_COUNT &&
    Array.isArray(p.mutes) &&
    p.mutes.length === TRACK_COUNT
  );
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
    return isValidProject(data) ? data : null;
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
