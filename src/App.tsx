import { useEffect, useMemo, useState } from "react";

type Phase = {
  id: string;
  label: string;
  seconds: number;
  color: string;
};

type Exercise = {
  id: string;
  name: string;
  reps: number;
  phases: Phase[];
};

type Workout = {
  id: string;
  name: string;
  exercises: Exercise[];
};

type RunPhase = {
  label: string;
  seconds: number;
  color: string;
};

type RunState = {
  exerciseName: string;
  phases: RunPhase[];
  repsTotal: number;
  repIndex: number;
  phaseIndex: number;
  phaseEndsAt: number;
  remainingMs: number;
  isPaused: boolean;
  pausedAt?: number;
  completed: boolean;
};

const STORAGE_KEY = "tempoColor.workouts.v1";
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

const makeExercise = (name = "Exercise 1", tempo = DEFAULT_TEMPO, reps = 8): Exercise => {
  const durations = parseTempo(tempo);
  const safeDurations = durations.length > 0 ? durations : parseTempo(DEFAULT_TEMPO);
  return {
    id: createId(),
    name,
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

const advanceRun = (state: RunState, now: number): RunState => {
  let phaseIndex = state.phaseIndex;
  let repIndex = state.repIndex;
  let phaseEndsAt = state.phaseEndsAt;
  let remaining = phaseEndsAt - now;
  let loops = 0;
  const maxLoops = Math.min(200, state.phases.length * state.repsTotal + 2);

  while (remaining <= 0 && loops < maxLoops) {
    let nextPhaseIndex = phaseIndex + 1;
    let nextRepIndex = repIndex;

    if (nextPhaseIndex >= state.phases.length) {
      nextPhaseIndex = 0;
      nextRepIndex += 1;
    }

    if (nextRepIndex > state.repsTotal) {
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
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(null);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);
  const [tempoDraft, setTempoDraft] = useState<string>("");
  const [tempoError, setTempoError] = useState<string>("");
  const [run, setRun] = useState<RunState | null>(null);

  const selectedWorkout = useMemo(() => {
    return workouts.find((workout) => workout.id === selectedWorkoutId) ?? workouts[0];
  }, [workouts, selectedWorkoutId]);

  const selectedExercise = useMemo(() => {
    return (
      selectedWorkout?.exercises.find((exercise) => exercise.id === selectedExerciseId) ??
      selectedWorkout?.exercises[0]
    );
  }, [selectedWorkout, selectedExerciseId]);

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
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workouts));
    } catch {
      // Ignore storage failures (private mode, quota, etc.).
    }
  }, [workouts]);

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

  const startRun = (exercise: Exercise) => {
    const phases: RunPhase[] = exercise.phases.map((phase) => ({
      label: phase.label,
      seconds: phase.seconds,
      color: phase.color
    }));
    if (phases.length === 0) {
      return;
    }
    const repsTotal = Math.max(1, Math.round(exercise.reps));
    const now = performance.now();
    const durationMs = Math.max(0, phases[0].seconds * 1000);
    setRun({
      exerciseName: exercise.name,
      phases,
      repsTotal,
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
            disabled={!selectedExercise}
            onClick={() => selectedExercise && startRun(selectedExercise)}
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
            {workouts.map((workout) => (
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
              </button>
            ))}
          </div>
          <div className="panel-actions">
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
            {selectedWorkout?.exercises.map((exercise) => (
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
                </button>
                <button className="btn ghost tiny" type="button" onClick={() => startRun(exercise)}>
                  Run
                </button>
              </div>
            ))}
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
                <label>Reps</label>
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

              <div className="panel-subtitle">Phases</div>
              <div className="phase-list">
                {selectedExercise.phases.map((phase) => (
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
                    <input
                      className="color"
                      type="color"
                      value={phase.color}
                      onChange={(event) =>
                        updateExercise(selectedExercise.id, (exercise) => ({
                          ...exercise,
                          phases: exercise.phases.map((item) =>
                            item.id === phase.id ? { ...item, color: event.target.value } : item
                          )
                        }))
                      }
                    />
                    <button className="btn ghost tiny" type="button" onClick={() => removePhase(phase.id)}>
                      Remove
                    </button>
                  </div>
                ))}
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
                Rep {run.repIndex} / {run.repsTotal}
              </div>
            </div>
            <div className="run-status">{run.isPaused ? "Paused" : run.completed ? "Complete" : "Live"}</div>
          </div>

          <div className="run-center">
            <div className="run-time">{run.completed ? "Done" : formatRemaining(run.remainingMs)}</div>
            <div className="run-phase">{run.phases[run.phaseIndex]?.label ?? "Phase"}</div>
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
