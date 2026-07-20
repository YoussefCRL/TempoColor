import { APP_VERSION } from "./appVersion";

export type WeightProgressLog = {
  id: string;
  userId: string;
  programId: string | null;
  programName: string | null;
  dayId: string | null;
  dayName: string | null;
  workoutId: string;
  workoutName: string;
  exerciseId: string;
  exerciseName: string;
  setIndex: number;
  setsLogged: number;
  weightKg: number;
  reps: number;
  rir: number | null;
  note: string;
  loggedAt: number;
  createdAt: number;
  updatedAt: number;
};

export type ProgramDayCompletionLog = {
  id: string;
  userId: string;
  programId: string;
  programName: string;
  dayId: string;
  dayName: string;
  workoutId: string | null;
  workoutName: string | null;
  weekKey: string;
  completed: boolean;
  completedAt: number | null;
  updatedAt: number;
};

export type AppDataPayload = {
  workouts?: unknown;
  progress?: unknown;
  runPreferences?: unknown;
  favoriteWorkoutIds?: unknown;
  recentWorkoutIds?: unknown;
  trainHints?: unknown;
  quickStartSeen?: unknown;
  programPlansPayload?: unknown;
  programCompletion?: unknown;
  weightProgressLogs?: unknown;
  dayCompletionHistory?: unknown;
  skillBlocks?: unknown;
  recoveryCheck?: unknown;
};

export type AuthUser = {
  username: string;
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");

const normalizeUsername = (value: string): string => value.trim().toLowerCase();

const makeApiUrl = (path: string): string => {
  const separator = path.includes("?") ? "&" : "?";
  return `${API_BASE_URL}${path}${separator}v=${encodeURIComponent(APP_VERSION)}`;
};

const apiRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(makeApiUrl(path), {
    ...init,
    cache: "no-store",
    credentials: "omit",
    headers
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with ${response.status}.`);
  }
  return payload as T;
};

export const loadAuthSummary = async (): Promise<{ userCount: number }> =>
  apiRequest("/auth/summary");

export const registerAuthUser = async (
  username: string,
  password: string
): Promise<AuthUser> => {
  const payload = await apiRequest<{ user: AuthUser }>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
  return payload.user;
};

export const loginAuthUser = async (username: string, password: string): Promise<AuthUser> => {
  const payload = await apiRequest<{ user: AuthUser }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
  return payload.user;
};

export const loadUserData = async (username: string): Promise<AppDataPayload> => {
  const payload = await apiRequest<{ data: AppDataPayload }>(
    `/users/${encodeURIComponent(normalizeUsername(username))}/state`
  );
  return payload.data ?? {};
};

export const saveUserData = async (
  username: string,
  data: AppDataPayload
): Promise<void> => {
  await apiRequest(`/users/${encodeURIComponent(normalizeUsername(username))}/state`, {
    method: "PUT",
    body: JSON.stringify({ data })
  });
};

export const saveWeightProgressLog = async (log: WeightProgressLog): Promise<void> => {
  await apiRequest(`/users/${encodeURIComponent(normalizeUsername(log.userId))}/weight-progress`, {
    method: "POST",
    body: JSON.stringify({ log })
  });
};

export const saveProgramDayCompletionLog = async (
  log: ProgramDayCompletionLog
): Promise<void> => {
  await apiRequest(`/users/${encodeURIComponent(normalizeUsername(log.userId))}/day-completions`, {
    method: "POST",
    body: JSON.stringify({ log })
  });
};

export const loadRecentWeightProgressLogs = async (
  username: string,
  maxItems = 80
): Promise<WeightProgressLog[]> => {
  const payload = await apiRequest<{ logs: WeightProgressLog[] }>(
    `/users/${encodeURIComponent(normalizeUsername(username))}/weight-progress?limit=${maxItems}`
  );
  return payload.logs ?? [];
};

export const loadRecentProgramDayCompletionLogs = async (
  username: string,
  maxItems = 80
): Promise<ProgramDayCompletionLog[]> => {
  const payload = await apiRequest<{ logs: ProgramDayCompletionLog[] }>(
    `/users/${encodeURIComponent(normalizeUsername(username))}/day-completions?limit=${maxItems}`
  );
  return payload.logs ?? [];
};
