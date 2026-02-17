import { useEffect, useMemo, useRef, useState } from "react";

type Phase = {
  id: string;
  label: string;
  seconds: number;
  color: string;
};

type Exercise = {
  id: string;
  name: string;
  sets: number;
  reps: number;
  phases: Phase[];
};

type Workout = {
  id: string;
  name: string;
  exercises: Exercise[];
};

type ExerciseProgress = {
  setsDone: number;
  completed: boolean;
  completedAt?: number;
};

type ProgressState = Record<string, Record<string, ExerciseProgress>>;

type RunPhase = {
  label: string;
  seconds: number;
  color: string;
};

type RunState = {
  workoutId: string;
  exerciseId: string;
  exerciseName: string;
  phases: RunPhase[];
  setsTotal: number;
  repsPerSet: number;
  totalReps: number;
  setsLogged: number;
  repIndex: number;
  phaseIndex: number;
  phaseEndsAt: number;
  remainingMs: number;
  isPaused: boolean;
  pausedAt?: number;
  completed: boolean;
};

const STORAGE_KEY = "tempoColor.workouts.v1";
const PROGRESS_STORAGE_KEY = "tempoColor.progress.v1";
const DEFAULT_TEMPO = "3-1-2-1";
const COLOR_PRESETS = [
  "#ff3b30",
  "#34c759",
  "#0a84ff",
  "#f5f7ff",
  "#ff9f0a",
  "#bf5af2",
  "#64d2ff"
];

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
};

const parseTempo = (input: string): number[] => {
  return input
    .trim()
    .split(/[^0-9.]+/)
    .filter(Boolean)
    .map((value) => Number(value))
    .filter((value) => !Number.isNaN(value) && value >= 0);
};

const formatTempo = (phases: { seconds: number }[]): string => {
  return phases.map((phase) => phase.seconds).join("-");
};

const makePhases = (durations: number[], existing?: Phase[]): Phase[] => {
  return durations.map((seconds, index) => {
    const prior = existing?.[index];
    return {
      id: prior?.id ?? createId(),
      label: prior?.label ?? `Phase ${index + 1}`,
      seconds: Number.isFinite(seconds) ? seconds : 1,
      color: prior?.color ?? COLOR_PRESETS[index % COLOR_PRESETS.length]
    };
  });
};

const makeExercise = (
  name = "Exercise 1",
  tempo = DEFAULT_TEMPO,
  reps = 8,
  sets = 3
): Exercise => {
  const durations = parseTempo(tempo);
  const safeDurations = durations.length > 0 ? durations : parseTempo(DEFAULT_TEMPO);
  return {
    id: createId(),
    name,
    sets,
    reps,
    phases: makePhases(safeDurations)
  };
};

const makeWorkout = (name = "Workout A"): Workout => {
  return {
    id: createId(),
    name,
    exercises: [makeExercise("Exercise 1")]
  };
};

const loadWorkouts = (): Workout[] => {
  if (typeof window === "undefined") {
    return [makeWorkout()];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [makeWorkout()];
    }
    const parsed = JSON.parse(raw) as Workout[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [makeWorkout()];
    }
    return parsed;
  } catch {
    return [makeWorkout()];
  }
};

const loadProgress = (): ProgressState => {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed as ProgressState;
  } catch {
    return {};
  }
};

const formatRemaining = (ms: number): string => {
  const seconds = Math.max(0, ms / 1000);
  if (seconds >= 10) {
    return `${Math.ceil(seconds)}s`;
  }
  return `${seconds.toFixed(1)}s`;
};

const getContrastColor = (hex: string): string => {
  const cleaned = hex.replace("#", "");
  const value = cleaned.length === 3
    ? cleaned
        .split("")
        .map((char) => char + char)
        .join("")
    : cleaned.padEnd(6, "0").slice(0, 6);
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 150 ? "#0b0d12" : "#f7f7fb";
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const getExerciseSetsTarget = (exercise: Exercise): number => {
  return Math.max(1, Math.round(coerceNumber(exercise.sets, 3)));
};

const getExerciseRepsPerSet = (exercise: Exercise): number => {
  return Math.max(1, Math.round(exercise.reps));
};

const getExerciseProgressView = (
  progress: ProgressState,
  workoutId: string,
  exercise: Exercise
): {
  setsDone: number;
  setsTarget: number;
  repsPerSet: number;
  completed: boolean;
  completedAt?: number;
} => {
  const setsTarget = getExerciseSetsTarget(exercise);
  const repsPerSet = getExerciseRepsPerSet(exercise);
  const stored = progress[workoutId]?.[exercise.id] as
    | (ExerciseProgress & { repsDone?: number })
    | undefined;
  const legacySetsDone = typeof stored?.repsDone === "number" ? stored.repsDone : 0;
  const rawSetsDone = stored?.setsDone ?? legacySetsDone;
  const baseDone = clamp(Math.round(rawSetsDone), 0, setsTarget);
  const setsDone = stored?.completed ? setsTarget : baseDone;
  return {
    setsDone,
    setsTarget,
    repsPerSet,
    completed: setsDone >= setsTarget,
    completedAt: stored?.completedAt
  };
};

const getWorkoutProgressView = (
  progress: ProgressState,
  workout: Workout
): {
  completedExercises: number;
  totalExercises: number;
  setsDone: number;
  setsTarget: number;
  percent: number;
} => {
  const totalExercises = workout.exercises.length;
  let completedExercises = 0;
  let setsDone = 0;
  let setsTarget = 0;

  workout.exercises.forEach((exercise) => {
    const exerciseProgress = getExerciseProgressView(progress, workout.id, exercise);
    setsDone += exerciseProgress.setsDone;
    setsTarget += exerciseProgress.setsTarget;
    if (exerciseProgress.completed) {
      completedExercises += 1;
    }
  });

  return {
    completedExercises,
    totalExercises,
    setsDone,
    setsTarget,
    percent: setsTarget > 0 ? (setsDone / setsTarget) * 100 : 0
  };
};

const normalizeHex = (value: string): string | null => {
  const raw = value.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]+$/.test(raw)) {
    return null;
  }
  if (raw.length === 3) {
    const expanded = raw
      .split("")
      .map((char) => char + char)
      .join("");
    return `#${expanded.toLowerCase()}`;
  }
  if (raw.length === 6) {
    return `#${raw.toLowerCase()}`;
  }
  return null;
};

const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const normalized = normalizeHex(hex) ?? "#000000";
  const raw = normalized.replace("#", "");
  return {
    r: parseInt(raw.slice(0, 2), 16),
    g: parseInt(raw.slice(2, 4), 16),
    b: parseInt(raw.slice(4, 6), 16)
  };
};

const hexToHsl = (hex: string): { h: number; s: number; l: number } => {
  const { r, g, b } = hexToRgb(hex);
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const delta = max - min;
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    switch (max) {
      case rNorm:
        h = (gNorm - bNorm) / delta + (gNorm < bNorm ? 6 : 0);
        break;
      case gNorm:
        h = (bNorm - rNorm) / delta + 2;
        break;
      default:
        h = (rNorm - gNorm) / delta + 4;
        break;
    }
    h *= 60;
  }

  return {
    h: Math.round(h),
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  };
};

const hslToHex = (h: number, s: number, l: number): string => {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 100) / 100;
  const light = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (hue < 60) {
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  const toHex = (value: number) => Math.round((value + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toLowerCase();
};

const coerceNumber = (value: unknown, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

const coerceWorkout = (input: unknown, index = 0): Workout | null => {
  if (!input || typeof input !== "object") {
    return null;
  }
  const raw = input as Partial<Workout>;
  const rawExercises = Array.isArray(raw.exercises) ? raw.exercises : [];
  const exercises: Exercise[] = rawExercises.map((exerciseInput, exerciseIndex) => {
    const exercise = (exerciseInput ?? {}) as Partial<Exercise>;
    const rawPhases = Array.isArray(exercise.phases) ? exercise.phases : [];
    const phases: Phase[] =
      rawPhases.length > 0
        ? rawPhases.map((phaseInput, phaseIndex) => {
            const phase = (phaseInput ?? {}) as Partial<Phase>;
            const normalizedColor =
              normalizeHex(typeof phase.color === "string" ? phase.color : "") ??
              COLOR_PRESETS[phaseIndex % COLOR_PRESETS.length];
            return {
              id: createId(),
              label:
                typeof phase.label === "string" && phase.label.trim()
                  ? phase.label.trim()
                  : `Phase ${phaseIndex + 1}`,
              seconds: Math.max(0, coerceNumber(phase.seconds, 1)),
              color: normalizedColor
            };
          })
        : makePhases(parseTempo(DEFAULT_TEMPO));

    return {
      id: createId(),
      name:
        typeof exercise.name === "string" && exercise.name.trim()
          ? exercise.name.trim()
          : `Exercise ${exerciseIndex + 1}`,
      sets: Math.max(1, Math.round(coerceNumber(exercise.sets, 3))),
      reps: Math.max(1, Math.round(coerceNumber(exercise.reps, 8))),
      phases
    };
  });

  const safeExercises = exercises.length > 0 ? exercises : [makeExercise("Exercise 1")];
  return {
    id: createId(),
    name:
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim()
        : `Workout ${index + 1}`,
    exercises: safeExercises
  };
};

const advanceRun = (state: RunState, now: number): RunState => {
  let phaseIndex = state.phaseIndex;
  let repIndex = state.repIndex;
  let phaseEndsAt = state.phaseEndsAt;
  let remaining = phaseEndsAt - now;
  let loops = 0;
  const maxLoops = Math.min(200, state.phases.length * state.totalReps + 2);

  while (remaining <= 0 && loops < maxLoops) {
    let nextPhaseIndex = phaseIndex + 1;
    let nextRepIndex = repIndex;

    if (nextPhaseIndex >= state.phases.length) {
      nextPhaseIndex = 0;
      nextRepIndex += 1;
    }

    if (nextRepIndex > state.totalReps) {
      return { ...state, completed: true, remainingMs: 0 };
    }

    phaseIndex = nextPhaseIndex;
    repIndex = nextRepIndex;
    const durationMs = Math.max(0, state.phases[phaseIndex].seconds * 1000);
    phaseEndsAt = now + durationMs;
    remaining = phaseEndsAt - now;
    loops += 1;
  }

  if (loops >= maxLoops && remaining <= 0) {
    return { ...state, completed: true, remainingMs: 0 };
  }

  return {
    ...state,
    phaseIndex,
    repIndex,
    phaseEndsAt,
    remainingMs: Math.max(0, remaining)
  };
};

export default function App() {
  const [workouts, setWorkouts] = useState<Workout[]>(() => loadWorkouts());
  const [progress, setProgress] = useState<ProgressState>(() => loadProgress());
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(null);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);
  const [tempoDraft, setTempoDraft] = useState<string>("");
  const [tempoError, setTempoError] = useState<string>("");
  const [run, setRun] = useState<RunState | null>(null);
  const [hexDrafts, setHexDrafts] = useState<Record<string, string>>({});
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const selectedWorkout = useMemo(() => {
    return workouts.find((workout) => workout.id === selectedWorkoutId) ?? workouts[0];
  }, [workouts, selectedWorkoutId]);

  const selectedExercise = useMemo(() => {
    return (
      selectedWorkout?.exercises.find((exercise) => exercise.id === selectedExerciseId) ??
      selectedWorkout?.exercises[0]
    );
  }, [selectedWorkout, selectedExerciseId]);

  const selectedWorkoutProgress = useMemo(() => {
    if (!selectedWorkout) {
      return null;
    }
    return getWorkoutProgressView(progress, selectedWorkout);
  }, [progress, selectedWorkout]);

  const selectedExerciseProgress = useMemo(() => {
    if (!selectedWorkout || !selectedExercise) {
      return null;
    }
    return getExerciseProgressView(progress, selectedWorkout.id, selectedExercise);
  }, [progress, selectedExercise, selectedWorkout]);

  useEffect(() => {
    setWorkouts((prev) => {
      let changed = false;
      const next = prev.map((workout) => {
        const exercises = workout.exercises.map((exercise) => {
          const normalizedSets = getExerciseSetsTarget(exercise);
          const normalizedReps = getExerciseRepsPerSet(exercise);
          if (exercise.sets === normalizedSets && exercise.reps === normalizedReps) {
            return exercise;
          }
          changed = true;
          return {
            ...exercise,
            sets: normalizedSets,
            reps: normalizedReps
          };
        });
        return changed ? { ...workout, exercises } : workout;
      });
      return changed ? next : prev;
    });
  }, []);

  useEffect(() => {
    if (!selectedWorkoutId && workouts.length > 0) {
      setSelectedWorkoutId(workouts[0].id);
    } else if (selectedWorkoutId && !workouts.some((workout) => workout.id === selectedWorkoutId)) {
      setSelectedWorkoutId(workouts[0]?.id ?? null);
    }
  }, [workouts, selectedWorkoutId]);

  useEffect(() => {
    if (!selectedWorkout) {
      return;
    }
    if (!selectedExerciseId && selectedWorkout.exercises.length > 0) {
      setSelectedExerciseId(selectedWorkout.exercises[0].id);
    } else if (
      selectedExerciseId &&
      !selectedWorkout.exercises.some((exercise) => exercise.id === selectedExerciseId)
    ) {
      setSelectedExerciseId(selectedWorkout.exercises[0]?.id ?? null);
    }
  }, [selectedWorkout, selectedExerciseId]);

  useEffect(() => {
    if (selectedExercise) {
      setTempoDraft(formatTempo(selectedExercise.phases));
      setTempoError("");
    }
  }, [selectedExercise?.id]);

  useEffect(() => {
    if (!selectedExercise) {
      setHexDrafts({});
      return;
    }
    setHexDrafts((prev) => {
      const next: Record<string, string> = {};
      selectedExercise.phases.forEach((phase) => {
        next[phase.id] = prev[phase.id] ?? phase.color;
      });
      return next;
    });
  }, [selectedExercise?.id, selectedExercise?.phases.length]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workouts));
    } catch {
      // Ignore storage failures (private mode, quota, etc.).
    }
  }, [workouts]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
    } catch {
      // Ignore storage failures (private mode, quota, etc.).
    }
  }, [progress]);

  useEffect(() => {
    if (!run || run.completed || run.isPaused) {
      return;
    }

    const timer = window.setInterval(() => {
      setRun((prev) => {
        if (!prev || prev.completed || prev.isPaused) {
          return prev;
        }
        const now = performance.now();
        const remaining = prev.phaseEndsAt - now;
        if (remaining > 0) {
          return { ...prev, remainingMs: remaining };
        }
        return advanceRun(prev, now);
      });
    }, 100);

    return () => window.clearInterval(timer);
  }, [run?.completed, run?.isPaused, run?.exerciseName]);

  useEffect(() => {
    if (!run) {
      return;
    }
    const completedReps = run.completed ? run.totalReps : Math.max(0, run.repIndex - 1);
    const setsToRecord = run.completed ? run.setsTotal : Math.floor(completedReps / run.repsPerSet);
    if (setsToRecord <= run.setsLogged) {
      return;
    }
    const delta = setsToRecord - run.setsLogged;
    const exercise = workouts
      .find((workout) => workout.id === run.workoutId)
      ?.exercises.find((item) => item.id === run.exerciseId);
    if (!exercise) {
      return;
    }
    const setsTarget = getExerciseSetsTarget(exercise);
    setProgress((prev) => {
      const workoutProgress = prev[run.workoutId] ?? {};
      const current = workoutProgress[run.exerciseId] ?? { setsDone: 0, completed: false };
      const nextSetsDone = clamp(current.setsDone + delta, 0, setsTarget);
      const nextCompleted = nextSetsDone >= setsTarget;
      const nextItem: ExerciseProgress = {
        setsDone: nextSetsDone,
        completed: nextCompleted,
        completedAt: nextCompleted ? current.completedAt ?? Date.now() : undefined
      };
      return {
        ...prev,
        [run.workoutId]: {
          ...workoutProgress,
          [run.exerciseId]: nextItem
        }
      };
    });
    setRun((prev) => (prev ? { ...prev, setsLogged: setsToRecord } : prev));
  }, [
    run?.completed,
    run?.exerciseId,
    run?.repIndex,
    run?.repsPerSet,
    run?.setsLogged,
    run?.setsTotal,
    run?.totalReps,
    run?.workoutId,
    workouts
  ]);

  const updateWorkout = (workoutId: string, update: (workout: Workout) => Workout) => {
    setWorkouts((prev) => prev.map((workout) => (workout.id === workoutId ? update(workout) : workout)));
  };

  const updateExercise = (exerciseId: string, update: (exercise: Exercise) => Exercise) => {
    if (!selectedWorkoutId) {
      return;
    }
    updateWorkout(selectedWorkoutId, (workout) => ({
      ...workout,
      exercises: workout.exercises.map((exercise) =>
        exercise.id === exerciseId ? update(exercise) : exercise
      )
    }));
  };

  const setExerciseProgressSets = (workoutId: string, exerciseId: string, setsDone: number) => {
    const exercise = workouts
      .find((workout) => workout.id === workoutId)
      ?.exercises.find((item) => item.id === exerciseId);
    if (!exercise) {
      return;
    }
    const setsTarget = getExerciseSetsTarget(exercise);
    setProgress((prev) => {
      const workoutProgress = prev[workoutId] ?? {};
      const current = workoutProgress[exerciseId] ?? { setsDone: 0, completed: false };
      const nextSetsDone = clamp(Math.round(setsDone), 0, setsTarget);
      const nextCompleted = nextSetsDone >= setsTarget;
      const nextItem: ExerciseProgress = {
        setsDone: nextSetsDone,
        completed: nextCompleted,
        completedAt: nextCompleted ? current.completedAt ?? Date.now() : undefined
      };
      return {
        ...prev,
        [workoutId]: {
          ...workoutProgress,
          [exerciseId]: nextItem
        }
      };
    });
  };

  const addWorkout = () => {
    const newWorkout = makeWorkout(`Workout ${workouts.length + 1}`);
    setWorkouts((prev) => [...prev, newWorkout]);
    setSelectedWorkoutId(newWorkout.id);
    setSelectedExerciseId(newWorkout.exercises[0]?.id ?? null);
  };

  const deleteWorkout = () => {
    if (!selectedWorkout) {
      return;
    }
    if (!window.confirm(`Delete ${selectedWorkout.name}?`)) {
      return;
    }
    setWorkouts((prev) => {
      const filtered = prev.filter((workout) => workout.id !== selectedWorkout.id);
      return filtered.length > 0 ? filtered : [makeWorkout("Workout 1")];
    });
    setProgress((prev) => {
      const next = { ...prev };
      delete next[selectedWorkout.id];
      return next;
    });
  };

  const addExercise = () => {
    if (!selectedWorkout) {
      return;
    }
    const newExercise = makeExercise(`Exercise ${selectedWorkout.exercises.length + 1}`);
    updateWorkout(selectedWorkout.id, (workout) => ({
      ...workout,
      exercises: [...workout.exercises, newExercise]
    }));
    setSelectedExerciseId(newExercise.id);
  };

  const deleteExercise = () => {
    if (!selectedWorkout || !selectedExercise) {
      return;
    }
    if (!window.confirm(`Delete ${selectedExercise.name}?`)) {
      return;
    }
    updateWorkout(selectedWorkout.id, (workout) => {
      const remaining = workout.exercises.filter((exercise) => exercise.id !== selectedExercise.id);
      return {
        ...workout,
        exercises: remaining.length > 0 ? remaining : [makeExercise("Exercise 1")]
      };
    });
    setProgress((prev) => {
      const workoutProgress = prev[selectedWorkout.id];
      if (!workoutProgress) {
        return prev;
      }
      const nextWorkoutProgress = { ...workoutProgress };
      delete nextWorkoutProgress[selectedExercise.id];
      const next = { ...prev };
      if (Object.keys(nextWorkoutProgress).length === 0) {
        delete next[selectedWorkout.id];
      } else {
        next[selectedWorkout.id] = nextWorkoutProgress;
      }
      return next;
    });
  };

  const setPhaseColor = (phaseId: string, color: string) => {
    if (!selectedExercise) {
      return;
    }
    const normalized = normalizeHex(color) ?? color;
    updateExercise(selectedExercise.id, (exercise) => ({
      ...exercise,
      phases: exercise.phases.map((item) =>
        item.id === phaseId ? { ...item, color: normalized } : item
      )
    }));
    setHexDrafts((prev) => ({ ...prev, [phaseId]: normalized }));
  };

  const handleHexDraftChange = (phaseId: string, value: string) => {
    setHexDrafts((prev) => ({ ...prev, [phaseId]: value }));
    const normalized = normalizeHex(value);
    if (normalized) {
      setPhaseColor(phaseId, normalized);
    }
  };

  const handleHexDraftBlur = (phaseId: string) => {
    setHexDrafts((prev) => {
      const raw = prev[phaseId] ?? "";
      const normalized = normalizeHex(raw);
      if (normalized) {
        return { ...prev, [phaseId]: normalized };
      }
      const fallback =
        selectedExercise?.phases.find((phase) => phase.id === phaseId)?.color ?? "#000000";
      return { ...prev, [phaseId]: fallback };
    });
  };

  const applyTempo = () => {
    if (!selectedExercise) {
      return;
    }
    const durations = parseTempo(tempoDraft);
    if (durations.length === 0) {
      setTempoError("Enter a tempo like 3-1-2-1.");
      return;
    }
    updateExercise(selectedExercise.id, (exercise) => ({
      ...exercise,
      phases: makePhases(durations, exercise.phases)
    }));
    setTempoDraft(durations.join("-"));
    setTempoError("");
  };

  const addPhase = () => {
    if (!selectedExercise) {
      return;
    }
    updateExercise(selectedExercise.id, (exercise) => {
      const nextIndex = exercise.phases.length;
      const newPhase: Phase = {
        id: createId(),
        label: `Phase ${nextIndex + 1}`,
        seconds: 1,
        color: COLOR_PRESETS[nextIndex % COLOR_PRESETS.length]
      };
      return { ...exercise, phases: [...exercise.phases, newPhase] };
    });
  };

  const removePhase = (phaseId: string) => {
    if (!selectedExercise) {
      return;
    }
    updateExercise(selectedExercise.id, (exercise) => {
      const remaining = exercise.phases.filter((phase) => phase.id !== phaseId);
      return {
        ...exercise,
        phases: remaining.length > 0 ? remaining : exercise.phases
      };
    });
  };

  const exportWorkout = () => {
    if (!selectedWorkout) {
      return;
    }
    const payload = JSON.stringify(selectedWorkout, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeName =
      selectedWorkout.name
        .trim()
        .replace(/[^a-z0-9-_]+/gi, "_")
        .replace(/^_+|_+$/g, "") || "workout";
    link.href = url;
    link.download = `${safeName}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importWorkout = async (file: File) => {
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const payloads = Array.isArray(parsed) ? parsed : [parsed];
      const imported = payloads
        .map((item, index) => coerceWorkout(item, index))
        .filter((item): item is Workout => Boolean(item));
      if (imported.length === 0) {
        window.alert("No valid workouts found in that file.");
        return;
      }
      setWorkouts((prev) => [...prev, ...imported]);
      setSelectedWorkoutId(imported[0].id);
      setSelectedExerciseId(imported[0].exercises[0]?.id ?? null);
    } catch {
      window.alert("That file could not be imported. Please check the JSON format.");
    } finally {
      if (importInputRef.current) {
        importInputRef.current.value = "";
      }
    }
  };

  const startRun = (exercise: Exercise, workoutId: string) => {
    const phases: RunPhase[] = exercise.phases.map((phase) => ({
      label: phase.label,
      seconds: phase.seconds,
      color: phase.color
    }));
    if (phases.length === 0) {
      return;
    }
    const setsTotal = getExerciseSetsTarget(exercise);
    const repsPerSet = getExerciseRepsPerSet(exercise);
    const totalReps = setsTotal * repsPerSet;
    const now = performance.now();
    const durationMs = Math.max(0, phases[0].seconds * 1000);
    setRun({
      workoutId,
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      phases,
      setsTotal,
      repsPerSet,
      totalReps,
      setsLogged: 0,
      repIndex: 1,
      phaseIndex: 0,
      phaseEndsAt: now + durationMs,
      remainingMs: durationMs,
      isPaused: false,
      completed: false
    });
  };

  const stopRun = () => {
    setRun(null);
  };

  const pauseRun = () => {
    setRun((prev) =>
      prev
        ? {
            ...prev,
            isPaused: true,
            pausedAt: performance.now()
          }
        : prev
    );
  };

  const resumeRun = () => {
    setRun((prev) => {
      if (!prev || !prev.isPaused || !prev.pausedAt) {
        return prev;
      }
      const now = performance.now();
      const pausedFor = now - prev.pausedAt;
      return {
        ...prev,
        isPaused: false,
        pausedAt: undefined,
        phaseEndsAt: prev.phaseEndsAt + pausedFor
      };
    });
  };

  const phaseColor = run ? run.phases[run.phaseIndex]?.color ?? "#0f1116" : "#0f1116";
  const runTextColor = run ? getContrastColor(phaseColor) : "#f7f7fb";
  const runCompletedReps = run ? (run.completed ? run.totalReps : Math.max(0, run.repIndex - 1)) : 0;
  const runCompletedSets = run ? Math.floor(runCompletedReps / run.repsPerSet) : 0;
  const runCurrentSet = run
    ? run.completed
      ? run.setsTotal
      : clamp(Math.floor((run.repIndex - 1) / run.repsPerSet) + 1, 1, run.setsTotal)
    : 0;
  const runRepInSet = run
    ? run.completed
      ? run.repsPerSet
      : ((run.repIndex - 1) % run.repsPerSet) + 1
    : 0;
  const runSetProgress = run
    ? Math.min(run.setsTotal, runCompletedSets + (runRepInSet - 1) / run.repsPerSet)
    : 0;
  const runCompletionPercent = run ? (runSetProgress / run.setsTotal) * 100 : 0;

  return (
    <div className="app">
      <header className="header">
        <div>
          <div className="brand">TempoColor</div>
          <div className="subtitle">Color-timed tempo training with saved presets.</div>
        </div>
        <div className="header-actions">
          <span className="pill">PWA-ready</span>
          <button
            className="btn primary"
            type="button"
            disabled={!selectedExercise || !selectedWorkout}
            onClick={() =>
              selectedExercise && selectedWorkout && startRun(selectedExercise, selectedWorkout.id)
            }
          >
            Start
          </button>
        </div>
      </header>

      <aside className="sidebar">
        <section className="panel">
          <div className="panel-title">
            <h2>Workouts</h2>
            <button className="btn ghost small" type="button" onClick={addWorkout}>
              + Workout
            </button>
          </div>
          <div className="list">
            {workouts.map((workout) => {
              const workoutProgress = getWorkoutProgressView(progress, workout);
              return (
                <button
                  key={workout.id}
                  className={`list-item ${workout.id === selectedWorkout?.id ? "active" : ""}`}
                  type="button"
                  onClick={() => {
                    setSelectedWorkoutId(workout.id);
                    setSelectedExerciseId(workout.exercises[0]?.id ?? null);
                  }}
                >
                  <span className="list-title">{workout.name}</span>
                  <span className="list-meta">{workout.exercises.length} exercises</span>
                  <span className="list-meta">
                    {workoutProgress.setsDone}/{workoutProgress.setsTarget} sets
                  </span>
                  <div className="mini-progress">
                    <div style={{ width: `${workoutProgress.percent}%` }} />
                  </div>
                </button>
              );
            })}
          </div>
          <div className="panel-actions">
            <input
              ref={importInputRef}
              className="file-input"
              type="file"
              accept="application/json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void importWorkout(file);
                }
              }}
            />
            <button
              className="btn ghost small"
              type="button"
              onClick={() => importInputRef.current?.click()}
            >
              Import Workout
            </button>
            <button
              className="btn ghost small"
              type="button"
              disabled={!selectedWorkout}
              onClick={exportWorkout}
            >
              Export Workout
            </button>
            <button
              className="btn danger small"
              type="button"
              disabled={!selectedWorkout}
              onClick={deleteWorkout}
            >
              Delete Workout
            </button>
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <h2>Exercises</h2>
            <button className="btn ghost small" type="button" onClick={addExercise}>
              + Exercise
            </button>
          </div>
          <div className="list">
            {selectedWorkout?.exercises.map((exercise) => {
              const exerciseProgress = getExerciseProgressView(progress, selectedWorkout.id, exercise);
              return (
                <div
                  key={exercise.id}
                  className={`exercise-row ${exercise.id === selectedExercise?.id ? "active" : ""}`}
                >
                  <button
                    className="exercise-main"
                    type="button"
                    onClick={() => setSelectedExerciseId(exercise.id)}
                  >
                    <span>{exercise.name}</span>
                    <span className="list-meta">{formatTempo(exercise.phases)}</span>
                    <span className={`list-meta ${exerciseProgress.completed ? "complete-meta" : ""}`}>
                      {exerciseProgress.setsDone}/{exerciseProgress.setsTarget} sets
                    </span>
                  </button>
                  <button
                    className="btn ghost tiny"
                    type="button"
                    onClick={() => selectedWorkout && startRun(exercise, selectedWorkout.id)}
                  >
                    Run
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </aside>

      <main className="main">
        <section className="panel">
          <div className="panel-title">
            <h2>Editor</h2>
            <span className="pill subtle">Auto-saved</span>
          </div>
          {!selectedWorkout || !selectedExercise ? (
            <div className="empty">Select or create an exercise to start editing.</div>
          ) : (
            <div className="editor">
              <div className="field">
                <label>Workout Name</label>
                <input
                  className="input"
                  type="text"
                  value={selectedWorkout.name}
                  onChange={(event) =>
                    updateWorkout(selectedWorkout.id, (workout) => ({
                      ...workout,
                      name: event.target.value
                    }))
                  }
                />
              </div>
              <div className="field">
                <label>Exercise Name</label>
                <input
                  className="input"
                  type="text"
                  value={selectedExercise.name}
                  onChange={(event) =>
                    updateExercise(selectedExercise.id, (exercise) => ({
                      ...exercise,
                      name: event.target.value
                    }))
                  }
                />
              </div>
              <div className="field">
                <label>Sets</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  step={1}
                  value={selectedExercise.sets ?? 3}
                  onChange={(event) => {
                    const value = Math.max(1, Number(event.target.value));
                    updateExercise(selectedExercise.id, (exercise) => ({
                      ...exercise,
                      sets: Number.isNaN(value) ? 3 : value
                    }));
                  }}
                />
              </div>
              <div className="field">
                <label>Reps / Set</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  step={1}
                  value={selectedExercise.reps}
                  onChange={(event) => {
                    const value = Math.max(1, Number(event.target.value));
                    updateExercise(selectedExercise.id, (exercise) => ({
                      ...exercise,
                      reps: Number.isNaN(value) ? 1 : value
                    }));
                  }}
                />
              </div>
              <div className="field">
                <label>Tempo</label>
                <div className="inline">
                  <input
                    className="input"
                    type="text"
                    value={tempoDraft}
                    onChange={(event) => setTempoDraft(event.target.value)}
                    placeholder="3-1-2-1"
                  />
                  <button className="btn ghost" type="button" onClick={applyTempo}>
                    Apply
                  </button>
                </div>
                {tempoError ? <div className="error">{tempoError}</div> : null}
              </div>

              <div className="progress-card">
                <div className="progress-header">
                  <div className="panel-subtitle progress-heading">Set Tracker</div>
                  <div className="list-meta">
                    {selectedWorkoutProgress?.completedExercises ?? 0}/
                    {selectedWorkoutProgress?.totalExercises ?? selectedWorkout.exercises.length} exercises done
                  </div>
                </div>
                <div className="progress-bar">
                  <div
                    style={{
                      width: `${
                        selectedExerciseProgress
                          ? (selectedExerciseProgress.setsDone / selectedExerciseProgress.setsTarget) * 100
                          : 0
                      }%`
                    }}
                  />
                </div>
                <div className="progress-meta">
                  <span>
                    {selectedExerciseProgress?.setsDone ?? 0}/
                    {selectedExerciseProgress?.setsTarget ?? getExerciseSetsTarget(selectedExercise)} sets done
                  </span>
                  <span>
                    {selectedExerciseProgress?.completed ? "Exercise complete" : "In progress"}
                  </span>
                </div>
                <div className="set-grid">
                  {Array.from({
                    length: selectedExerciseProgress?.setsTarget ?? getExerciseSetsTarget(selectedExercise)
                  }).map((_, index) => {
                    const setsDone = selectedExerciseProgress?.setsDone ?? 0;
                    const isDone = index < setsDone;
                    const isCurrent = index === setsDone && !selectedExerciseProgress?.completed;
                    const nextSetsDone = isDone ? index : index + 1;
                    return (
                      <button
                        key={`set-${selectedExercise.id}-${index + 1}`}
                        className={`set-chip ${isDone ? "done" : ""} ${isCurrent ? "current" : ""}`}
                        type="button"
                        onClick={() =>
                          setExerciseProgressSets(selectedWorkout.id, selectedExercise.id, nextSetsDone)
                        }
                      >
                        {index + 1}
                      </button>
                    );
                  })}
                </div>
                <div className="panel-actions">
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() =>
                      setExerciseProgressSets(
                        selectedWorkout.id,
                        selectedExercise.id,
                        (selectedExerciseProgress?.setsDone ?? 0) + 1
                      )
                    }
                  >
                    +1 Set
                  </button>
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() =>
                      setExerciseProgressSets(
                        selectedWorkout.id,
                        selectedExercise.id,
                        (selectedExerciseProgress?.setsDone ?? 0) - 1
                      )
                    }
                  >
                    Undo Set
                  </button>
                  <button
                    className="btn primary small"
                    type="button"
                    onClick={() =>
                      setExerciseProgressSets(
                        selectedWorkout.id,
                        selectedExercise.id,
                        selectedExerciseProgress?.setsTarget ?? getExerciseSetsTarget(selectedExercise)
                      )
                    }
                  >
                    Finish Exercise
                  </button>
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() => setExerciseProgressSets(selectedWorkout.id, selectedExercise.id, 0)}
                  >
                    Reset Progress
                  </button>
                </div>
              </div>

              <div className="panel-subtitle">Phases</div>
              <div className="phase-list">
                {selectedExercise.phases.map((phase) => {
                  const hsl = hexToHsl(phase.color);
                  return (
                    <div key={phase.id} className="phase-row">
                      <input
                        className="input"
                        type="text"
                        value={phase.label}
                        onChange={(event) =>
                          updateExercise(selectedExercise.id, (exercise) => ({
                            ...exercise,
                            phases: exercise.phases.map((item) =>
                              item.id === phase.id ? { ...item, label: event.target.value } : item
                            )
                          }))
                        }
                      />
                      <input
                        className="input"
                        type="number"
                        min={0}
                        step={0.1}
                        value={phase.seconds}
                        onChange={(event) => {
                          const value = Math.max(0, Number(event.target.value));
                          updateExercise(selectedExercise.id, (exercise) => ({
                            ...exercise,
                            phases: exercise.phases.map((item) =>
                              item.id === phase.id
                                ? { ...item, seconds: Number.isNaN(value) ? 0 : value }
                                : item
                            )
                          }));
                        }}
                      />
                      <div className="color-group">
                        <div className="color-top">
                          <input
                            className="color"
                            type="color"
                            value={phase.color}
                            onChange={(event) => setPhaseColor(phase.id, event.target.value)}
                          />
                          <input
                            className="input color-hex"
                            type="text"
                            value={hexDrafts[phase.id] ?? phase.color}
                            onChange={(event) => handleHexDraftChange(phase.id, event.target.value)}
                            onBlur={() => handleHexDraftBlur(phase.id)}
                            placeholder="#RRGGBB"
                            autoCapitalize="none"
                            spellCheck={false}
                          />
                        </div>
                        <div className="color-sliders">
                          <div className="color-slider">
                            <span>Hue</span>
                            <input
                              type="range"
                              min={0}
                              max={360}
                              value={hsl.h}
                              onChange={(event) =>
                                setPhaseColor(
                                  phase.id,
                                  hslToHex(Number(event.target.value), hsl.s, hsl.l)
                                )
                              }
                            />
                          </div>
                          <div className="color-slider">
                            <span>Sat</span>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={hsl.s}
                              onChange={(event) =>
                                setPhaseColor(
                                  phase.id,
                                  hslToHex(hsl.h, Number(event.target.value), hsl.l)
                                )
                              }
                            />
                          </div>
                          <div className="color-slider">
                            <span>Light</span>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={hsl.l}
                              onChange={(event) =>
                                setPhaseColor(
                                  phase.id,
                                  hslToHex(hsl.h, hsl.s, Number(event.target.value))
                                )
                              }
                            />
                          </div>
                        </div>
                      </div>
                      <button className="btn ghost tiny" type="button" onClick={() => removePhase(phase.id)}>
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="panel-actions">
                <button className="btn ghost" type="button" onClick={addPhase}>
                  + Phase
                </button>
                <button className="btn danger" type="button" onClick={deleteExercise}>
                  Delete Exercise
                </button>
              </div>
            </div>
          )}
        </section>
      </main>

      {run ? (
        <div className="run-overlay" style={{ backgroundColor: phaseColor, color: runTextColor }}>
          <div className="run-top">
            <div>
              <div className="run-title">{run.exerciseName}</div>
              <div className="run-meta">
                Set {runCurrentSet} / {run.setsTotal} • Rep {runRepInSet} / {run.repsPerSet}
              </div>
            </div>
            <div className="run-status">{run.isPaused ? "Paused" : run.completed ? "Complete" : "Live"}</div>
          </div>

          <div className="run-center">
            <div className="run-time">{run.completed ? "Done" : formatRemaining(run.remainingMs)}</div>
            <div className="run-phase">{run.phases[run.phaseIndex]?.label ?? "Phase"}</div>
            <div className="run-progress-wrap">
              <div className="run-progress-bar">
                <div style={{ width: `${runCompletionPercent}%` }} />
              </div>
              <div className="run-progress-meta">
                {runCompletedSets}/{run.setsTotal} sets completed
              </div>
            </div>
          </div>

          <div className="run-controls">
            {run.completed ? (
              <button className="btn primary" type="button" onClick={stopRun}>
                Close
              </button>
            ) : run.isPaused ? (
              <button className="btn primary" type="button" onClick={resumeRun}>
                Resume
              </button>
            ) : (
              <button className="btn primary" type="button" onClick={pauseRun}>
                Pause
              </button>
            )}
            {!run.completed ? (
              <button className="btn ghost" type="button" onClick={stopRun}>
                Stop
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
