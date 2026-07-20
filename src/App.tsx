import { type CSSProperties, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  loadAuthSummary,
  loadRecentProgramDayCompletionLogs,
  loadRecentWeightProgressLogs,
  loadUserData,
  loginAuthUser,
  registerAuthUser,
  saveProgramDayCompletionLog,
  saveUserData,
  saveWeightProgressLog,
  type AppDataPayload,
  type ProgramDayCompletionLog,
  type WeightProgressLog
} from "./progressApi";
import { APP_VERSION } from "./appVersion";

type Phase = {
  id: string;
  label: string;
  seconds: number;
  color: string;
};

type Exercise = {
  id: string;
  name: string;
  advice: string;
  weight: string;
  progression: string;
  loadProgression?: string;
  repProgression?: string;
  effortCapRir?: number;
  setType?: SetType;
  intentTags?: ExerciseIntentTag[];
  repRange: string;
  sets: number;
  reps: number;
  restRange?: string;
  restSeconds?: number;
  phases: Phase[];
};

type Workout = {
  id: string;
  name: string;
  hidden: boolean;
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

type MainViewMode = "train" | "edit";
type AppPage = "dashboard" | "program" | "train" | "workouts" | "skills" | "recovery";

type TrainingGoal = "strength" | "hypertrophy" | "endurance";

type RunMode = "work" | "rest" | "countdown" | "ready";

type RunPreferences = {
  goal: TrainingGoal;
  restSeconds: number;
  autoStartNextSet: boolean;
  countdownSeconds: number;
};

type WorkoutFilter = "all" | "presets" | "custom";

type TrainHintState = {
  startTimer: boolean;
  setTracker: boolean;
};

type RunState = {
  workoutId: string;
  exerciseId: string;
  exerciseName: string;
  setType: SetType;
  targetLabel: string;
  phases: RunPhase[];
  setsTotal: number;
  repsPerSet: number;
  totalReps: number;
  setsLogged: number;
  repIndex: number;
  phaseIndex: number;
  mode: RunMode;
  segmentEndsAt: number;
  segmentDurationMs: number;
  remainingMs: number;
  restMs: number;
  autoStartNextSet: boolean;
  countdownMs: number;
  isPaused: boolean;
  pausedAt?: number;
  completed: boolean;
};

type AuthMode = "login" | "register";

type SetType = "reps" | "per_leg" | "hold_seconds" | "duration_block";

type ExerciseIntentTag =
  | "upper_glute"
  | "side_glute"
  | "projection"
  | "skill"
  | "pump"
  | "strength";

type ProgramTemplateDay = {
  id: string;
  dayIndex: number;
  name: string;
  optional: boolean;
  workoutId: string | null;
  notes: string;
};

type ProgramPlan = {
  id: string;
  name: string;
  description: string;
  days: ProgramTemplateDay[];
};

type ProgramCompletionByWeek = Record<string, Record<string, boolean>>;

type SkillLevel = {
  label: string;
  seconds: number;
};

type SkillBlock = {
  id: string;
  name: string;
  rounds: number;
  roundSeconds: number;
  levelIndex: number;
  levels: SkillLevel[];
  sessionsCompleted: number;
  personalBestSeconds: number;
};

type SkillSessionState = {
  blockId: string;
  round: number;
  totalRounds: number;
  endsAt: number;
  remainingMs: number;
  roundDurationMs: number;
  completed: boolean;
  rewardApplied?: boolean;
};

type RecoveryCheck = {
  sleepHours: number;
  soreness: number;
  stress: number;
  recommendation: "full" | "moderate" | "light";
  note: string;
  updatedAt: number;
};

type ProgramSessionContext = {
  programId: string;
  dayId: string;
};

type DatabaseSyncState = {
  status: "local" | "syncing" | "synced" | "error";
  message: string;
};

const DEFAULT_TEMPO = "3-1-2-1";
const REST_PRESETS: Record<TrainingGoal, number> = {
  strength: 120,
  hypertrophy: 75,
  endurance: 45
};
const DEFAULT_RUN_PREFERENCES: RunPreferences = {
  goal: "hypertrophy",
  restSeconds: REST_PRESETS.hypertrophy,
  autoStartNextSet: false,
  countdownSeconds: 3
};
const DEFAULT_TRAIN_HINTS: TrainHintState = {
  startTimer: false,
  setTracker: false
};
const PHASE_COLOR_HOLD = "#ff0000";
const PHASE_COLOR_NEGATIVE = "#0000ff";
const PHASE_COLOR_POSITIVE = "#00ff00";
const PHASE_COLOR_NEUTRAL = "#8e8e93";
const RUN_REST_COLOR = "#2c2c2e";
const RUN_COUNTDOWN_COLOR = "#3a3a3d";
const RUN_READY_COLOR = "#ff3b30";
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,32}$/;
const PRIVILEGED_HIDDEN_USERNAME = "youssef";
const APP_PAGE_ITEMS: Array<{ id: AppPage; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "program", label: "Program" },
  { id: "train", label: "Train" },
  { id: "workouts", label: "Workouts" },
  { id: "skills", label: "Skills" },
  { id: "recovery", label: "Recovery" }
];
const INTENT_TAGS: Array<{ id: ExerciseIntentTag; label: string }> = [
  { id: "upper_glute", label: "Upper Glute" },
  { id: "side_glute", label: "Side Glute" },
  { id: "projection", label: "Projection" },
  { id: "skill", label: "Skill" },
  { id: "pump", label: "Pump" },
  { id: "strength", label: "Strength" }
];
const SET_TYPE_OPTIONS: Array<{ id: SetType; label: string; helper: string }> = [
  { id: "reps", label: "Reps", helper: "Standard rep targets per set" },
  { id: "per_leg", label: "Per Leg", helper: "Rep target applies to each side" },
  { id: "hold_seconds", label: "Hold (sec)", helper: "Single hold per set in seconds" },
  { id: "duration_block", label: "Duration Block", helper: "Timed block per set/round" }
];
const SET_TYPE_LABELS: Record<SetType, string> = {
  reps: "Reps",
  per_leg: "Per Leg",
  hold_seconds: "Hold",
  duration_block: "Duration"
};
const DEFAULT_PROGRAM_TEMPLATE: ProgramTemplateDay[] = Array.from({ length: 7 }).map((_, index) => ({
  id: `day-${index + 1}`,
  dayIndex: index + 1,
  name: `Day ${index + 1}`,
  optional: index === 5 || index === 6,
  workoutId: null,
  notes: ""
}));
const DEFAULT_SKILL_BLOCKS: SkillBlock[] = [
  {
    id: "skill-l-sit",
    name: "L-Sit",
    rounds: 3,
    roundSeconds: 15,
    levelIndex: 0,
    levels: [
      { label: "Tuck Hold", seconds: 10 },
      { label: "One-Leg Extension", seconds: 15 },
      { label: "Full L-Sit", seconds: 20 },
      { label: "L-Sit + Pulses", seconds: 25 }
    ],
    sessionsCompleted: 0,
    personalBestSeconds: 15
  },
  {
    id: "skill-toes-to-bar",
    name: "Toes-to-Bar",
    rounds: 3,
    roundSeconds: 20,
    levelIndex: 0,
    levels: [
      { label: "Knee Raises", seconds: 15 },
      { label: "Controlled Toes-to-Bar", seconds: 20 },
      { label: "Strict Reps", seconds: 25 },
      { label: "Strict + Pause", seconds: 30 }
    ],
    sessionsCompleted: 0,
    personalBestSeconds: 20
  },
  {
    id: "skill-handstand",
    name: "Handstand Practice",
    rounds: 5,
    roundSeconds: 30,
    levelIndex: 0,
    levels: [
      { label: "Wall Hold", seconds: 20 },
      { label: "Wall Shoulder Taps", seconds: 30 },
      { label: "Freestanding Attempts", seconds: 40 },
      { label: "Freestanding Holds", seconds: 50 }
    ],
    sessionsCompleted: 0,
    personalBestSeconds: 30
  }
];
const DEFAULT_RECOVERY_CHECK: RecoveryCheck = {
  sleepHours: 7,
  soreness: 4,
  stress: 4,
  recommendation: "moderate",
  note: "Ready for quality work. Keep 1-2 reps in reserve on compounds.",
  updatedAt: Date.now()
};
const DEFAULT_DATABASE_SYNC_STATE: DatabaseSyncState = {
  status: "local",
  message: "MySQL sync ready."
};

const YOUSSEF_COACH_PLAN_WORKOUTS_SOURCE: unknown[] = [
  {
    name: "Day 1 - Upper Glute & Side Focus (Heavy)",
    hidden: false,
    exercises: [
      {
        name: "Lean-Away Cable Abduction (Heavy Top Hold)",
        weight: "Moderate-Heavy",
        progression:
          "Add one rep per side until all sets hit 12 with a clean 2-sec top hold, then add the smallest stack jump.",
        loadProgression: "Micro-load only if the pelvis stays locked and the front hip never takes over.",
        repProgression: "Stay in 8-12 per side; own the top hold before adding load.",
        advice:
          "Main upper-side width builder. Lean away, lead with heel, toes slightly down, and pause hard at the top without hiking the hip.",
        sets: 5,
        reps: "8-12 / side",
        rest: "60-75 sec",
        effortCapRir: 1,
        setType: "per_leg",
        intentTags: ["upper_glute", "side_glute", "strength"],
        phases: [
          { label: "Lift", seconds: 2, color: "#7adcb0" },
          { label: "Top Hold", seconds: 2, color: "#64b4ff" },
          { label: "Lower", seconds: 3, color: "#ff8f86" }
        ]
      },
      {
        name: "Cable Kickback (High + Out Upper Shelf)",
        weight: "Moderate",
        progression:
          "Increase weight after every set hits 15 per side with pelvis square, heel path diagonal, and a full top squeeze.",
        advice:
          "Drive the heel back and slightly out, not straight behind you. This should hit upper-outer glute, not low back or hamstring.",
        sets: 4,
        reps: "10-15 / side",
        rest: "60-75 sec",
        effortCapRir: 1,
        setType: "per_leg",
        intentTags: ["upper_glute", "side_glute", "pump"],
        phases: [
          { label: "Kick", seconds: 2, color: "#7adcb0" },
          { label: "Squeeze", seconds: 2, color: "#64b4ff" },
          { label: "Return", seconds: 2, color: "#ff8f86" }
        ]
      },
      {
        name: "Barbell Hip Thrust (Wide Stance + PPT)",
        weight: "Heavy",
        progression: "Add 2.5-5 kg once all sets hit 10 clean reps with a hard lockout pause and no lumbar arch.",
        loadProgression: "Micro-load weekly if top reps are achieved without form drift.",
        repProgression: "Stay in 8-10; hit all sets at 10 before load increase.",
        advice:
          "Support upper shelf and projection without stealing the day. Use a slightly wider stance, knees out, ribs down, and finish through glutes.",
        sets: 4,
        reps: "8-10",
        rest: "120 sec",
        effortCapRir: 1,
        setType: "reps",
        intentTags: ["upper_glute", "projection", "strength"],
        phases: [
          { label: "Drive", seconds: 2, color: "#7adcb0" },
          { label: "Top Hold", seconds: 2, color: "#64b4ff" },
          { label: "Lower", seconds: 3, color: "#ff8f86" }
        ]
      },
      {
        name: "Dumbbell Bulgarian Split Squat (Glute Bias)",
        weight: "Dumbbells",
        progression:
          "Add reps until every set reaches 12 per side with the front glute leading, then increase each dumbbell by the smallest jump.",
        advice:
          "Replace the step-up with a more loadable upper-glute mass builder. Use a long stance, slight forward torso lean, vertical-ish front shin, and drive through the front heel without bouncing off the rear leg.",
        sets: 4,
        reps: "8-12 / side",
        rest: "90-120 sec",
        effortCapRir: 2,
        setType: "per_leg",
        intentTags: ["upper_glute", "projection", "strength"],
        phases: [
          { label: "Lower", seconds: 3, color: "#ff8f86" },
          { label: "Stretch", seconds: 1, color: "#64b4ff" },
          { label: "Drive", seconds: 2, color: "#7adcb0" },
          { label: "Top Squeeze", seconds: 1, color: "#64b4ff" }
        ]
      },
      {
        name: "Seated Abduction Machine (Heavy Partials + Hold)",
        weight: "Moderate-Heavy",
        progression:
          "Add load only after every set keeps the full reps strict, the top partials honest, and the final hold wide.",
        advice:
          "Finish with pure side-glute width. Sit slightly forward, keep the waist still, do 12-15 full reps, 10-15 top partials, then a 10-20 sec open hold on the last set.",
        sets: 4,
        reps: "12-15 full + 10-15 top partials",
        rest: "60 sec",
        effortCapRir: 1,
        setType: "reps",
        intentTags: ["upper_glute", "side_glute", "pump"],
        phases: [
          { label: "Open", seconds: 2, color: "#7adcb0" },
          { label: "Top Pulse", seconds: 1, color: "#64b4ff" },
          { label: "Close", seconds: 2, color: "#ff8f86" }
        ]
      }
    ]
  },
  {
    name: "Day 2 - Pull & Core",
    hidden: false,
    exercises: [
      {
        name: "Weighted Pull-Up",
        weight: "Bodyweight + load",
        progression: "Add load when all sets reach 12 reps with strict range.",
        advice:
          "Strict strength only. Use the minimum volume needed to stay capable and stop before chasing big lat or arm growth.",
        sets: 5,
        reps: "6-12",
        rest: "120 sec",
        effortCapRir: 2,
        setType: "reps",
        intentTags: ["strength", "skill"],
        phases: [
          { label: "Pull", seconds: 2, color: "#7adcb0" },
          { label: "Lower", seconds: 3, color: "#ff8f86" }
        ]
      },
      {
        name: "Chest-Supported Dumbbell Row",
        weight: "Moderate",
        progression: "Add load once 12 reps are reached on all sets without torso momentum.",
        advice:
          "Support pulling strength without building a thick upper back. Smooth reps, no torso swing, no huge back pump.",
        sets: 4,
        reps: "8-12",
        rest: "90 sec",
        effortCapRir: 2,
        setType: "reps",
        intentTags: ["strength"],
        phases: [
          { label: "Row", seconds: 2, color: "#7adcb0" },
          { label: "Return", seconds: 3, color: "#ff8f86" }
        ]
      },
      {
        name: "Lat Pulldown (Wide Grip)",
        weight: "Moderate",
        progression: "Increase load after hitting top reps with clean shoulder control.",
        advice:
          "Scapula first, controlled pull second. Keep this as support work, not a lat-width session.",
        sets: 3,
        reps: "10-12",
        rest: "90 sec",
        effortCapRir: 2,
        setType: "reps",
        intentTags: ["pump", "strength"],
        phases: [
          { label: "Pull", seconds: 2, color: "#7adcb0" },
          { label: "Return", seconds: 3, color: "#ff8f86" }
        ]
      },
      {
        name: "Face Pull",
        weight: "Light",
        progression: "Progress reps first; keep shoulder position strict.",
        advice:
          "Use this for shoulder balance and posture, not rear-delt size. Keep it light and clean.",
        sets: 4,
        reps: "15-20",
        rest: "60 sec",
        effortCapRir: 3,
        setType: "reps",
        intentTags: ["pump"],
        phases: [
          { label: "Pull", seconds: 2, color: "#7adcb0" },
          { label: "Hold", seconds: 1, color: "#64b4ff" },
          { label: "Return", seconds: 2, color: "#ff8f86" }
        ]
      },
      {
        name: "Hanging Leg Raise",
        weight: "Bodyweight",
        progression: "Add reps before adding ankle load.",
        advice:
          "Posteriorly tilt the pelvis hard to train a tighter waistline and cleaner lines. No swing, no rib flare.",
        sets: 3,
        reps: "12-15",
        rest: "60 sec",
        effortCapRir: 2,
        setType: "reps",
        intentTags: ["skill", "strength"],
        phases: [
          { label: "Raise", seconds: 2, color: "#7adcb0" },
          { label: "Lower", seconds: 3, color: "#ff8f86" }
        ]
      },
      {
        name: "L-Sit Hold",
        weight: "Bodyweight",
        progression: "Increase hold time by 2-5 sec weekly.",
        advice:
          "Think long legs, locked knees, and compressed waist. This is line and control work, not hip-flexor suffering.",
        sets: 3,
        reps: "10-15 sec hold",
        rest: "45 sec",
        effortCapRir: 2,
        setType: "hold_seconds",
        intentTags: ["skill"],
        phases: [{ label: "Hold", seconds: 15, color: "#64b4ff" }]
      }
    ]
  },
  {
    name: "Day 3 - Glute Pump & Shape",
    hidden: false,
    exercises: [
      {
        name: "Frog Pump",
        weight: "Bodyweight or light plate",
        progression: "Increase reps to top range before adding load.",
        advice:
          "Constant tension for lower-glute fullness and shape. Keep pressure in glutes, not hamstrings or low back.",
        sets: 3,
        reps: "25-30",
        rest: "45 sec",
        effortCapRir: 2,
        setType: "reps",
        intentTags: ["pump", "side_glute"],
        phases: [
          { label: "Up", seconds: 1, color: "#7adcb0" },
          { label: "Squeeze", seconds: 1, color: "#64b4ff" },
          { label: "Down", seconds: 1, color: "#ff8f86" }
        ]
      },
      {
        name: "Cable Pull-Through",
        weight: "Moderate",
        progression: "Increase load once all sets hit 15 with full stretch control.",
        advice:
          "Use the stretch to lengthen the rear line, then drive through glutes for projection. Do not let it become a hamstring-dominant hinge.",
        sets: 3,
        reps: "12-15",
        rest: "75 sec",
        effortCapRir: 2,
        setType: "reps",
        intentTags: ["projection", "pump"],
        phases: [
          { label: "Hinge", seconds: 3, color: "#ff8f86" },
          { label: "Drive", seconds: 2, color: "#7adcb0" }
        ]
      },
      {
        name: "Incline Dumbbell Hip Thrust",
        weight: "Moderate",
        progression: "Increase load after reaching top reps all sets with clean pause.",
        advice:
          "Pelvis tucked and ribs down so the upper glute does the shaping. Smooth squeeze, no grinding.",
        sets: 3,
        reps: "12-15",
        rest: "90 sec",
        effortCapRir: 2,
        setType: "reps",
        intentTags: ["upper_glute", "projection", "pump"],
        phases: [
          { label: "Drive", seconds: 2, color: "#7adcb0" },
          { label: "Squeeze", seconds: 2, color: "#64b4ff" },
          { label: "Lower", seconds: 3, color: "#ff8f86" }
        ]
      },
      {
        name: "Side-Lying Band Leg Lift",
        weight: "Band",
        progression: "Progress reps to 20 strict each side then increase band tension.",
        advice:
          "Keep the heel slightly behind the body to stay on upper and side glute. No torso rocking.",
        sets: 3,
        reps: "20 / side",
        rest: "45 sec",
        effortCapRir: 2,
        setType: "per_leg",
        intentTags: ["side_glute", "pump"],
        phases: [
          { label: "Lift", seconds: 2, color: "#7adcb0" },
          { label: "Hold", seconds: 1, color: "#64b4ff" },
          { label: "Lower", seconds: 2, color: "#ff8f86" }
        ]
      },
      {
        name: "Incline Walk / Stair Climber",
        weight: "Cardio",
        progression: "Add 1-2 min or slight incline weekly without raising fatigue.",
        advice:
          "Easy blood-flow work only. Keep the glutes full and fresh, not flattened by extra fatigue.",
        sets: 1,
        reps: "10-15 min block",
        rest: "30 sec",
        effortCapRir: 3,
        setType: "duration_block",
        intentTags: ["pump"],
        phases: [{ label: "Block", seconds: 600, color: "#64b4ff" }]
      }
    ]
  },
  {
    name: "Day 4 - Push / Shoulder / Skills",
    hidden: false,
    exercises: [
      {
        name: "Dips",
        weight: "Bodyweight or weighted",
        progression: "Add load once 12 strict reps are reached all sets.",
        advice:
          "Only enough pressing strength to stay capable. Do not turn this into chest or triceps mass work.",
        sets: 4,
        reps: "6-12",
        rest: "120 sec",
        effortCapRir: 2,
        setType: "reps",
        intentTags: ["strength"],
        phases: [
          { label: "Lower", seconds: 2, color: "#ff8f86" },
          { label: "Press", seconds: 2, color: "#7adcb0" }
        ]
      },
      {
        name: "Cable Chest Fly",
        weight: "Light",
        progression: "Increase reps before load; keep shoulder-friendly path.",
        advice:
          "Keep this very light or skip if chest fullness starts hurting the silhouette. This is not a growth priority.",
        sets: 3,
        reps: "12-15",
        rest: "75 sec",
        effortCapRir: 3,
        setType: "reps",
        intentTags: ["pump"],
        phases: [
          { label: "Stretch", seconds: 2, color: "#ff8f86" },
          { label: "Squeeze", seconds: 2, color: "#64b4ff" },
          { label: "Return", seconds: 2, color: "#7adcb0" }
        ]
      },
      {
        name: "Pike Push-Up / Shoulder Press",
        weight: "Bodyweight or machine",
        progression: "Progress reps first, then load.",
        advice:
          "Use the minimum effective pressing dose. Build skill and capacity without chasing shoulder size.",
        sets: 3,
        reps: "8-12",
        rest: "90 sec",
        effortCapRir: 2,
        setType: "reps",
        intentTags: ["strength", "skill"],
        phases: [
          { label: "Lower", seconds: 2, color: "#ff8f86" },
          { label: "Press", seconds: 2, color: "#7adcb0" }
        ]
      },
      {
        name: "Lateral Raise",
        weight: "Light",
        progression: "Move through reps before any load jump.",
        advice:
          "Keep these light and conservative. If side delts start widening the silhouette too much, this is the first thing to cut.",
        sets: 4,
        reps: "15-20",
        rest: "60 sec",
        effortCapRir: 2,
        setType: "reps",
        intentTags: ["pump"],
        phases: [
          { label: "Raise", seconds: 2, color: "#7adcb0" },
          { label: "Lower", seconds: 3, color: "#ff8f86" }
        ]
      },
      {
        name: "Handstand Practice",
        weight: "Bodyweight",
        progression: "Add one quality round before extending hold time.",
        advice:
          "Line quality over max time. Build skill without turning the session into a delt-pump challenge.",
        sets: 5,
        reps: "45 sec round",
        rest: "45 sec",
        effortCapRir: 3,
        setType: "duration_block",
        intentTags: ["skill"],
        phases: [{ label: "Practice", seconds: 45, color: "#64b4ff" }]
      },
      {
        name: "Plank + Hollow Hold",
        weight: "Bodyweight",
        progression: "Increase hold time in small steps without form loss.",
        advice:
          "Ribs down, pelvis tucked, and waist tight. This supports a smaller-looking midsection and cleaner body lines.",
        sets: 3,
        reps: "45-60 sec hold",
        rest: "45 sec",
        effortCapRir: 2,
        setType: "hold_seconds",
        intentTags: ["skill", "pump"],
        phases: [{ label: "Hold", seconds: 45, color: "#64b4ff" }]
      }
    ]
  },
  {
    name: "Day 5 - Glute Max Projection",
    hidden: false,
    exercises: [
      {
        name: "Barbell Hip Thrust (Pause + PPT)",
        weight: "Heavy",
        progression: "Add 2.5-5 kg once all sets hit 10 clean reps with a hard lockout pause and no low-back arch.",
        advice:
          "Primary rear-projection builder. Posterior pelvic tilt, ribs down, knees slightly out, and lock out through glutes. Last set can reach 0-1 RIR if the pause stays clean.",
        sets: 5,
        reps: "6-10",
        rest: "120-150 sec",
        effortCapRir: 1,
        setType: "reps",
        intentTags: ["upper_glute", "projection", "strength"],
        phases: [
          { label: "Drive", seconds: 2, color: "#7adcb0" },
          { label: "Top Hold", seconds: 2, color: "#64b4ff" },
          { label: "Lower", seconds: 3, color: "#ff8f86" }
        ]
      },
      {
        name: "Heavy Dumbbell Romanian Deadlift (Glute Bias)",
        weight: "2 heavy dumbbells",
        progression:
          "Increase load when all sets hit 10 clean reps with a deep glute stretch, stable torso, and no low-back takeover.",
        advice:
          "More stable and loadable than the B-stance version. Soft knees, hips back, dumbbells close, long eccentric, and drive up by squeezing glutes rather than extending the low back.",
        sets: 4,
        reps: "8-10",
        rest: "120 sec",
        effortCapRir: 1,
        setType: "reps",
        intentTags: ["projection", "strength"],
        phases: [
          { label: "Lower", seconds: 3, color: "#ff8f86" },
          { label: "Stretch", seconds: 1, color: "#64b4ff" },
          { label: "Drive", seconds: 2, color: "#7adcb0" }
        ]
      },
      {
        name: "Reverse Lunge (Long Stride)",
        weight: "Dumbbells",
        progression: "Progress reps first, then increase load.",
        advice:
          "Long stride and heel pressure so the glute max builds projection instead of front-leg quad size.",
        sets: 4,
        reps: "8-12 / leg",
        rest: "90-120 sec",
        effortCapRir: 1,
        setType: "per_leg",
        intentTags: ["projection", "upper_glute", "strength"],
        phases: [
          { label: "Lower", seconds: 3, color: "#ff8f86" },
          { label: "Drive", seconds: 1, color: "#7adcb0" }
        ]
      },
      {
        name: "45-Degree Back Extension (Glute Bias)",
        weight: "Bodyweight + plate optional",
        progression: "Increase reps first, then add load only if the glutes stay fully in charge.",
        advice:
          "Deep glute stretch and hard top squeeze for rear projection. Round the upper back slightly and do not let the low back steal the line. Let the last set finish around 0-1 RIR if the glutes are still leading the movement.",
        sets: 4,
        reps: "10-15",
        rest: "75 sec",
        effortCapRir: 1,
        setType: "reps",
        intentTags: ["projection", "upper_glute", "pump"],
        phases: [
          { label: "Lower", seconds: 3, color: "#ff8f86" },
          { label: "Squeeze", seconds: 2, color: "#64b4ff" },
          { label: "Rise", seconds: 2, color: "#7adcb0" }
        ]
      },
      {
        name: "Cable Kickback (Straight Back)",
        weight: "Moderate",
        progression: "Increase load after all sets hit 20/side with strict squeeze and no pelvis drift.",
        advice:
          "Straight-back path for pure rear projection. Keep the pelvis square, pause at peak, and stop before the low back starts helping.",
        sets: 3,
        reps: "15-20 / side",
        rest: "60-75 sec",
        effortCapRir: 2,
        setType: "per_leg",
        intentTags: ["projection", "pump"],
        phases: [
          { label: "Kick", seconds: 2, color: "#7adcb0" },
          { label: "Squeeze", seconds: 1, color: "#64b4ff" },
          { label: "Return", seconds: 2, color: "#ff8f86" }
        ]
      },
    ]
  },
  {
    name: "Day 6 - Optional Skills / Pump",
    hidden: false,
    exercises: [
      {
        name: "L-Sit / V-Sit Progressions",
        weight: "Bodyweight",
        progression: "Increase hold duration while maintaining full control.",
        advice:
          "Keep the rounds crisp and elegant. This is line and compression work, not a fatigue contest.",
        sets: 3,
        reps: "15-20 sec hold",
        rest: "45 sec",
        effortCapRir: 2,
        setType: "hold_seconds",
        intentTags: ["skill"],
        phases: [{ label: "Hold", seconds: 20, color: "#64b4ff" }]
      },
      {
        name: "Cable Kickback / Glute Bridge Combo",
        weight: "Light-Moderate",
        progression: "Progress reps first. Keep low fatigue.",
        advice:
          "Low-fatigue glute detail only. Get shape and blood flow without interfering with the next hard lower day.",
        sets: 3,
        reps: "15-20",
        rest: "60 sec",
        effortCapRir: 3,
        setType: "reps",
        intentTags: ["pump", "side_glute"],
        phases: [
          { label: "Work", seconds: 2, color: "#7adcb0" },
          { label: "Control", seconds: 2, color: "#ff8f86" }
        ]
      },
      {
        name: "Side-Lying Band Kickback",
        weight: "Band",
        progression: "Increase reps to 20+ before changing tension.",
        advice:
          "Pure side-glute detail work. Keep the waist quiet and let the glute do the motion.",
        sets: 3,
        reps: "20 / side",
        rest: "45 sec",
        effortCapRir: 3,
        setType: "per_leg",
        intentTags: ["side_glute", "pump"],
        phases: [
          { label: "Lift", seconds: 2, color: "#7adcb0" },
          { label: "Lower", seconds: 2, color: "#ff8f86" }
        ]
      },
      {
        name: "Light Incline Walk / Stairmaster",
        weight: "Cardio",
        progression: "Keep intensity low; extend duration only if fresh.",
        advice:
          "Recovery only. This should refresh the lower body, not make the glutes feel flatter.",
        sets: 1,
        reps: "10 min block",
        rest: "30 sec",
        effortCapRir: 4,
        setType: "duration_block",
        intentTags: ["pump"],
        phases: [{ label: "Block", seconds: 600, color: "#64b4ff" }]
      },
      {
        name: "Mobility & Stretch",
        weight: "Bodyweight",
        progression: "Increase control and range, not intensity.",
        advice:
          "Restore hips, hamstrings, and posture so the lower-body shape sessions stay productive.",
        sets: 1,
        reps: "12 min block",
        rest: "30 sec",
        effortCapRir: 4,
        setType: "duration_block",
        intentTags: ["skill", "pump"],
        phases: [{ label: "Mobility", seconds: 720, color: "#64b4ff" }]
      }
    ]
  },
  {
    name: "Day 2 - Pull Skill / Waist Control",
    hidden: false,
    exercises: [
      {
        name: "Scapular Pull-Up + Active Hang",
        weight: "Bodyweight",
        progression: "Add 2 reps or 5 sec of hang time once shoulder position stays clean.",
        advice:
          "Shoulder-position practice only. Clean depression, short range, and stop before lats or arms get a growth-level pump.",
        sets: 3,
        reps: "6-8 + 10 sec hang",
        rest: "60 sec",
        effortCapRir: 3,
        setType: "reps",
        intentTags: ["skill", "strength"],
        phases: [
          { label: "Depress", seconds: 1, color: "#7adcb0" },
          { label: "Hang", seconds: 10, color: "#64b4ff" },
          { label: "Return", seconds: 2, color: "#ff8f86" }
        ]
      },
      {
        name: "Strict Chin-Up",
        weight: "Bodyweight or light load",
        progression: "Add reps first; only add small load once both sets hit the top range clean.",
        advice:
          "Keep this as minimum-effective pulling strength. Crisp reps, no grinding, and no extra back volume.",
        sets: 2,
        reps: "3-5",
        rest: "120-150 sec",
        effortCapRir: 2,
        setType: "reps",
        intentTags: ["skill", "strength"],
        phases: [
          { label: "Pull", seconds: 2, color: "#7adcb0" },
          { label: "Lower", seconds: 3, color: "#ff8f86" }
        ]
      },
      {
        name: "Hanging Knee Raise / Toes-to-Bar Progression",
        weight: "Bodyweight",
        progression: "Own the pelvic tuck first, then extend range or move toward toes-to-bar.",
        advice:
          "Posteriorly tilt the pelvis hard so the waist stays tight and the line stays clean. No swing and no rib flare.",
        sets: 4,
        reps: "8-12",
        rest: "60 sec",
        effortCapRir: 2,
        setType: "reps",
        intentTags: ["skill", "strength"],
        phases: [
          { label: "Raise", seconds: 2, color: "#7adcb0" },
          { label: "Lower", seconds: 3, color: "#ff8f86" }
        ]
      },
      {
        name: "L-Sit Progression",
        weight: "Bodyweight",
        progression: "Increase hold time by 2-5 sec while keeping knees locked and hips lifted.",
        advice:
          "Think compressed waist, long legs, and clean support. This is for shape control and skill, not bulk.",
        sets: 4,
        reps: "12-20 sec hold",
        rest: "45 sec",
        effortCapRir: 2,
        setType: "hold_seconds",
        intentTags: ["skill"],
        phases: [{ label: "Hold", seconds: 20, color: "#64b4ff" }]
      },
      {
        name: "Abdominal Vacuum Holds",
        weight: "Bodyweight",
        progression: "Add 5 sec per hold before increasing total rounds.",
        advice:
          "Waist-control work only. Pull inward and upward to make the waist look tighter while keeping the obliques quiet.",
        sets: 5,
        reps: "30-45 sec hold",
        rest: "30 sec",
        effortCapRir: 3,
        setType: "hold_seconds",
        intentTags: ["skill", "pump"],
        phases: [
          { label: "Exhale", seconds: 5, color: "#ff9f0a" },
          { label: "Vacuum Hold", seconds: 30, color: "#64b4ff" },
          { label: "Release", seconds: 5, color: "#7adcb0" }
        ]
      },
      {
        name: "Chest-Supported Row (Low Volume)",
        weight: "Moderate",
        progression: "Add reps first, then add a small load only if torso position and shoulder control stay strict.",
        advice:
          "Keeps Day 2 as an upper-body pull day without stealing recovery from the glute days. Smooth row, chest glued to the pad, no heavy back-pump chasing.",
        sets: 3,
        reps: "8-12",
        rest: "90 sec",
        effortCapRir: 3,
        setType: "reps",
        intentTags: ["strength"],
        phases: [
          { label: "Row", seconds: 2, color: "#7adcb0" },
          { label: "Hold", seconds: 1, color: "#64b4ff" },
          { label: "Return", seconds: 3, color: "#ff8f86" }
        ]
      }
    ]
  },
  {
    name: "Day 3 - Side Glute Width Builder",
    hidden: false,
    exercises: [
      {
        name: "Abductor Machine - Heavy Full Range + Top Partials",
        weight: "Heavy",
        progression:
          "Add load only after all sets keep the full reps clean, the top partials honest, and the last-set hold wide without hip-flexor takeover.",
        advice:
          "Primary width overload. Do 8-12 full reps first, then 8-12 top partials in the outer third. On the last set, finish with a 20-sec open-position hold.",
        sets: 5,
        reps: "8-12 full + 8-12 top partials",
        rest: "60-75 sec",
        effortCapRir: 1,
        setType: "reps",
        intentTags: ["side_glute", "pump"],
        phases: [
          { label: "Open", seconds: 2, color: "#7adcb0" },
          { label: "Top Pulse", seconds: 1, color: "#64b4ff" },
          { label: "Close", seconds: 2, color: "#ff8f86" }
        ]
      },
      {
        name: "Lean-Away Cable Abduction",
        weight: "Moderate-Heavy",
        progression: "Progress reps to the top range before changing the stack; keep the 2-sec top hold honest on every rep.",
        advice:
          "Heel leads, toes slightly down, and pelvis locked. Pause 2 sec at the top every rep and do not let the torso lean steal the tension. This is one of your main width builders, so every rep should bite the outer hip.",
        sets: 5,
        reps: "10-15 / side",
        rest: "45-60 sec",
        effortCapRir: 1,
        setType: "per_leg",
        intentTags: ["side_glute", "upper_glute", "pump"],
        phases: [
          { label: "Lift", seconds: 2, color: "#7adcb0" },
          { label: "Top Hold", seconds: 2, color: "#64b4ff" },
          { label: "Lower", seconds: 2, color: "#ff8f86" }
        ]
      },
      {
        name: "Rainbow Kickback (Outward Arc)",
        weight: "Moderate",
        progression:
          "Add reps until all sets hit 15 per side with a clean outward arc and no pelvis rotation, then add the smallest stack jump.",
        advice:
          "This replaces the redundant standing abduction with a different resistance path. Drive the heel back and out on a diagonal rainbow arc so the upper-outer glute works without turning the set into hip-flexor work. Form hint: https://www.youtube.com/shorts/nzCA9n-RLU0",
        sets: 3,
        reps: "12-15 / side",
        rest: "60 sec",
        effortCapRir: 2,
        setType: "per_leg",
        intentTags: ["upper_glute", "side_glute", "projection"],
        phases: [
          { label: "Arc Out", seconds: 2, color: "#7adcb0" },
          { label: "Squeeze", seconds: 2, color: "#64b4ff" },
          { label: "Return", seconds: 2, color: "#ff8f86" }
        ]
      },
      {
        name: "Cable Kickback (Up + Out)",
        weight: "Moderate",
        progression: "Increase weight after all sets hit 20 per side with a clean top squeeze and no pelvis drift.",
        advice:
          "Drive diagonally back and out for upper-outer sweep. Keep the waist still, squeeze hard at the top, and on the last set finish with a 10-15 sec top hold per side.",
        sets: 4,
        reps: "15-20 / side",
        rest: "60 sec",
        effortCapRir: 2,
        setType: "per_leg",
        intentTags: ["upper_glute", "side_glute", "pump"],
        phases: [
          { label: "Kick", seconds: 2, color: "#7adcb0" },
          { label: "Squeeze", seconds: 2, color: "#64b4ff" },
          { label: "Return", seconds: 2, color: "#ff8f86" }
        ]
      },
      {
        name: "Seated Abduction Machine - Mechanical Drop Set",
        weight: "Moderate-Heavy",
        progression: "Add load only after every round keeps the full reps, partials, hold, and drop-set partials clean with zero bouncing.",
        advice:
          "Do 12 full reps, then 15 top partials, then hold open for 20 sec, then drop the weight 20-25% and do 10 more top partials. Stay in the outer range and force the side glute to stay lit from start to finish.",
        sets: 3,
        reps: "12 full + 15 partials + 20 sec hold + drop 20-25% + 10 partials",
        rest: "60 sec",
        effortCapRir: 1,
        setType: "reps",
        intentTags: ["side_glute", "upper_glute", "pump"],
        phases: [
          { label: "Open", seconds: 2, color: "#7adcb0" },
          { label: "Pulse", seconds: 1, color: "#64b4ff" },
          { label: "Close", seconds: 2, color: "#ff8f86" }
        ]
      }
    ]
  },
  {
    name: "Day 4 - Push Skill / Line Control",
    hidden: false,
    exercises: [
      {
        name: "Wall Handstand Line Drill",
        weight: "Bodyweight",
        progression: "Add one clean round before extending time.",
        advice:
          "Stack wrists, shoulders, hips, and ribs. Keep this technical so it supports posture without stealing recovery from glutes.",
        sets: 4,
        reps: "30-45 sec round",
        rest: "45 sec",
        effortCapRir: 3,
        setType: "duration_block",
        intentTags: ["skill"],
        phases: [{ label: "Practice", seconds: 45, color: "#64b4ff" }]
      },
      {
        name: "Pike Push-Up / HSPU Eccentric",
        weight: "Bodyweight",
        progression: "Progress reps first, then move to harder leverage or slower eccentrics.",
        advice:
          "Minimum effective pressing only. Stay stacked and stop before shoulders or triceps get a growth-level pump.",
        sets: 2,
        reps: "3-5",
        rest: "120 sec",
        effortCapRir: 3,
        setType: "reps",
        intentTags: ["skill", "strength"],
        phases: [
          { label: "Lower", seconds: 3, color: "#ff8f86" },
          { label: "Press", seconds: 2, color: "#7adcb0" }
        ]
      },
      {
        name: "Parallel Bar Support Hold",
        weight: "Bodyweight",
        progression: "Add 5 sec per set before turning it into an L-support progression.",
        advice:
          "Support strength and control, not chest or triceps burnout. Crisp holds only.",
        sets: 2,
        reps: "20-30 sec hold",
        rest: "45 sec",
        effortCapRir: 2,
        setType: "hold_seconds",
        intentTags: ["skill", "strength"],
        phases: [{ label: "Hold", seconds: 25, color: "#64b4ff" }]
      },
      {
        name: "Dips / Push-Up Strength",
        weight: "Bodyweight or light load",
        progression: "Add reps first; add load only if shoulders stay clean and pressing does not create recovery drag.",
        advice:
          "Keeps Day 4 upper-body focused. Controlled pressing strength only, with enough effort to maintain skill and shape without chasing chest or triceps mass.",
        sets: 3,
        reps: "6-10",
        rest: "90 sec",
        effortCapRir: 2,
        setType: "reps",
        intentTags: ["skill", "strength"],
        phases: [
          { label: "Lower", seconds: 3, color: "#ff8f86" },
          { label: "Press", seconds: 2, color: "#7adcb0" }
        ]
      },
      {
        name: "Light Dumbbell Lateral Raise",
        weight: "Light dumbbells",
        progression: "Add reps before load, and keep the movement strict enough that it never becomes a heavy delt-growth priority.",
        advice:
          "Small dose for shoulder line and posture. Keep it light, clean, and below the point where side delts start competing with the hip-width silhouette.",
        sets: 3,
        reps: "15-20",
        rest: "45-60 sec",
        effortCapRir: 3,
        setType: "reps",
        intentTags: ["pump"],
        phases: [
          { label: "Raise", seconds: 2, color: "#7adcb0" },
          { label: "Control", seconds: 1, color: "#64b4ff" },
          { label: "Lower", seconds: 3, color: "#ff8f86" }
        ]
      },
      {
        name: "Hollow Body Hold",
        weight: "Bodyweight",
        progression: "Add 5 sec once pelvis stays tucked for the full round.",
        advice:
          "Ribs down and pelvis tucked to reinforce a tighter-looking waist and cleaner lines.",
        sets: 3,
        reps: "20-30 sec hold",
        rest: "45 sec",
        effortCapRir: 2,
        setType: "hold_seconds",
        intentTags: ["skill", "pump"],
        phases: [{ label: "Hold", seconds: 25, color: "#64b4ff" }]
      },
      {
        name: "Abdominal Vacuum Holds",
        weight: "Bodyweight",
        progression: "Add 5 sec or one extra round only if neck and shoulders stay relaxed.",
        advice:
          "Direct silhouette work: tighter-looking waist, quieter obliques, and no neck or shoulder strain.",
        sets: 4,
        reps: "30-40 sec hold",
        rest: "30 sec",
        effortCapRir: 3,
        setType: "hold_seconds",
        intentTags: ["skill", "pump"],
        phases: [
          { label: "Exhale", seconds: 5, color: "#ff9f0a" },
          { label: "Vacuum Hold", seconds: 30, color: "#64b4ff" },
          { label: "Release", seconds: 5, color: "#7adcb0" }
        ]
      }
    ]
  },
  {
    name: "Day 6 - Pump & Shape Finish",
    hidden: false,
    exercises: [
      {
        name: "Single-Leg Hip Thrust",
        weight: "Dumbbell or machine",
        progression: "Add reps until all sets hit 15 per side with a clean lockout, then add load only if Day 5 recovery stays excellent.",
        advice:
          "Controlled glute-max stimulus without heavy loading after Day 5. Keep ribs down, posteriorly tilt the pelvis, squeeze cleanly at lockout, and avoid grinding.",
        sets: 3,
        reps: "12-15 / side",
        rest: "75-90 sec",
        effortCapRir: 2,
        setType: "per_leg",
        intentTags: ["projection", "upper_glute", "pump"],
        phases: [
          { label: "Drive", seconds: 2, color: "#7adcb0" },
          { label: "Squeeze", seconds: 2, color: "#64b4ff" },
          { label: "Lower", seconds: 3, color: "#ff8f86" }
        ]
      },
      {
        name: "Cable Kickback (Up + Out)",
        weight: "Light-Moderate",
        progression: "Add small load only after every rep keeps a clean 1-2 sec peak squeeze and the last-set iso hold stays honest.",
        advice:
          "Upper shelf and upper-outer fullness. Lean slightly forward, brace the waist, and drive the heel back and slightly out without pelvis drift.",
        sets: 3,
        reps: "15-20 / side",
        rest: "45-60 sec",
        effortCapRir: 2,
        setType: "per_leg",
        intentTags: ["upper_glute", "side_glute", "pump"],
        phases: [
          { label: "Kick", seconds: 2, color: "#7adcb0" },
          { label: "Squeeze", seconds: 2, color: "#64b4ff" },
          { label: "Return", seconds: 2, color: "#ff8f86" }
        ]
      },
      {
        name: "Rainbow Kickback",
        weight: "Light-Moderate",
        progression: "Add reps until all sets hit 15 per side with a slow outward arc and no pelvis rotation, then add the smallest stack jump.",
        advice:
          "Side-glute roundness and width. Move the heel through a slow outward rainbow arc, keep the pelvis still, and make the upper-side glute control the whole path.",
        sets: 3,
        reps: "12-15 / side",
        rest: "45-60 sec",
        effortCapRir: 2,
        setType: "per_leg",
        intentTags: ["upper_glute", "side_glute", "projection"],
        phases: [
          { label: "Arc Out", seconds: 2, color: "#7adcb0" },
          { label: "Squeeze", seconds: 2, color: "#64b4ff" },
          { label: "Return", seconds: 2, color: "#ff8f86" }
        ]
      },
      {
        name: "Seated Abduction Machine",
        weight: "Moderate",
        progression:
          "Add reps first; add load only when every set keeps constant tension and a controlled 1-2 sec open-position hold.",
        sets: 3,
        reps: "20-30",
        rest: "45-60 sec",
        effortCapRir: 2,
        setType: "reps",
        intentTags: ["pump", "side_glute"],
        advice:
          "Glute medius thickness and width. Sit slightly forward, keep the waist still, hold 1-2 sec fully open, and keep constant tension instead of bouncing.",
        phases: [
          { label: "Open", seconds: 2, color: "#7adcb0" },
          { label: "Hold", seconds: 2, color: "#64b4ff" },
          { label: "Close", seconds: 2, color: "#ff8f86" }
        ]
      },
      {
        name: "Frog Pumps",
        weight: "Bodyweight or light plate",
        progression: "Increase reps to the top range before adding load. Keep it pump-focused after Day 5.",
        advice:
          "Maximum glute pump and fullness. Soles together, knees wide, pelvis tucked, continuous tension, and a hard squeeze every rep.",
        sets: 3,
        reps: "30-50",
        rest: "30-45 sec",
        effortCapRir: 3,
        setType: "reps",
        intentTags: ["pump", "side_glute"],
        phases: [
          { label: "Up", seconds: 1, color: "#7adcb0" },
          { label: "Squeeze", seconds: 1, color: "#64b4ff" },
          { label: "Down", seconds: 1, color: "#ff8f86" }
        ]
      },
      {
        name: "Optional Abduction Burnout (Recovery Excellent Only)",
        weight: "Light-Moderate",
        progression: "Use only when Day 5 recovery is excellent. Progress control first, not load.",
        advice:
          "Optional finisher only. Do 20 full reps, 20 top partial reps, then hold open for 20 seconds. Skip this if Day 5 left deep soreness or performance is dropping.",
        sets: 1,
        reps: "20 full + 20 partials + 20 sec hold",
        rest: "30 sec",
        effortCapRir: 2,
        setType: "reps",
        intentTags: ["side_glute", "pump"],
        phases: [
          { label: "Full Reps", seconds: 2, color: "#7adcb0" },
          { label: "Partials", seconds: 1, color: "#64b4ff" },
          { label: "Hold Open", seconds: 20, color: "#ff9f0a" }
        ]
      }
    ]
  },
  {
    name: "Day 6 - Alternative",
    hidden: false,
    exercises: [
      {
        name: "Incline Walk / Stair Climber Glute Flush",
        weight: "Cardio",
        progression: "Add 1-2 minutes only if legs feel fresher after the block.",
        advice:
          "Use this when Day 5 cooked the glutes. Easy blood flow only: long stride, slight forward lean, no breathless conditioning.",
        sets: 1,
        reps: "10-15 min block",
        rest: "30 sec",
        effortCapRir: 4,
        setType: "duration_block",
        intentTags: ["pump"],
        phases: [{ label: "Block", seconds: 600, color: "#64b4ff" }]
      },
      {
        name: "Banded Abduction + Frog Pump Superset",
        weight: "Light band",
        progression: "Add reps before adding band tension. This should restore the glute pump, not create soreness.",
        advice:
          "Do banded abductions first, then frog pumps with pelvis tucked. Keep constant tension and stop well before failure.",
        sets: 3,
        reps: "25 abductions + 30 frog pumps",
        rest: "45 sec",
        effortCapRir: 4,
        setType: "reps",
        intentTags: ["side_glute", "pump"],
        phases: [
          { label: "Open", seconds: 1, color: "#7adcb0" },
          { label: "Squeeze", seconds: 1, color: "#64b4ff" },
          { label: "Close", seconds: 1, color: "#ff8f86" }
        ]
      },
      {
        name: "Lean-Away Cable Abduction (Very Light)",
        weight: "Light",
        progression: "Add reps only. Keep the load light enough that the side glute feels better after the set.",
        advice:
          "Technique and blood flow. Heel leads, pelvis locked, and smooth reps in the outer half of the range.",
        sets: 2,
        reps: "20-25 / side",
        rest: "30-45 sec",
        effortCapRir: 4,
        setType: "per_leg",
        intentTags: ["upper_glute", "side_glute", "pump"],
        phases: [
          { label: "Lift", seconds: 2, color: "#7adcb0" },
          { label: "Top Hold", seconds: 1, color: "#64b4ff" },
          { label: "Lower", seconds: 2, color: "#ff8f86" }
        ]
      },
      {
        name: "Hip Flexor Couch Stretch + Glute Squeeze",
        weight: "Bodyweight",
        progression: "Add hold quality before adding time. Keep the low back neutral.",
        advice:
          "Open the front of the hip so the glute can project without lumbar extension. Squeeze the rear-side glute throughout the hold.",
        sets: 2,
        reps: "30-45 sec / side",
        rest: "30 sec",
        effortCapRir: 4,
        setType: "hold_seconds",
        intentTags: ["skill", "pump"],
        phases: [
          { label: "Set Position", seconds: 5, color: "#ff9f0a" },
          { label: "Glute Squeeze Hold", seconds: 30, color: "#64b4ff" },
          { label: "Release", seconds: 5, color: "#7adcb0" }
        ]
      },
      {
        name: "Abdominal Vacuum Holds",
        weight: "Bodyweight",
        progression: "Add 5 sec per hold before adding rounds.",
        advice:
          "Direct waist contrast work. Pull in, stay tall, and keep obliques quiet so the glute width stands out more.",
        sets: 4,
        reps: "30-45 sec hold",
        rest: "30 sec",
        effortCapRir: 3,
        setType: "hold_seconds",
        intentTags: ["skill", "pump"],
        phases: [
          { label: "Exhale", seconds: 5, color: "#ff9f0a" },
          { label: "Vacuum Hold", seconds: 30, color: "#64b4ff" },
          { label: "Release", seconds: 5, color: "#7adcb0" }
        ]
      }
    ]
  }
];

const PRESET_WORKOUTS_SOURCE: unknown[] = [
  {
    name: "Full Body - Free Weights",
    hidden: false,
    exercises: [
      {
        name: "Goblet Squat",
        weight: "1 x 20-32 kg dumbbell",
        progression:
          "When all sets reach 12 clean reps with full depth, increase load by 2-4 kg.",
        advice: "Brace before each rep and keep knees tracking over mid-foot.",
        sets: 4,
        reps: "8-12",
        phases: [
          { label: "Lower", seconds: 3, color: "#ff3b30" },
          { label: "Bottom", seconds: 1, color: "#ff9f0a" },
          { label: "Stand", seconds: 2, color: "#34c759" },
          { label: "Top", seconds: 0, color: "#0a84ff" }
        ]
      },
      {
        name: "Barbell Romanian Deadlift",
        weight: "40-80 kg barbell",
        progression:
          "Add 2.5-5 kg after all sets hit top reps without losing hamstring tension.",
        advice: "Hips back, neutral spine, bar close to legs.",
        sets: 4,
        reps: "6-10",
        phases: [
          { label: "Lower", seconds: 3, color: "#ff3b30" },
          { label: "Stretch", seconds: 1, color: "#ff9f0a" },
          { label: "Rise", seconds: 2, color: "#34c759" },
          { label: "Top", seconds: 0, color: "#0a84ff" }
        ]
      },
      {
        name: "Dumbbell Flat Bench Press",
        weight: "2 x 16-30 kg dumbbells",
        progression:
          "Increase each dumbbell by 1-2 kg when all sets hit top reps with full control.",
        advice: "Shoulders down and back, touch same depth each rep.",
        sets: 4,
        reps: "8-12",
        phases: [
          { label: "Lower", seconds: 3, color: "#ff3b30" },
          { label: "Pause", seconds: 1, color: "#ff9f0a" },
          { label: "Press", seconds: 1, color: "#34c759" },
          { label: "Top", seconds: 0, color: "#0a84ff" }
        ]
      },
      {
        name: "One Arm Dumbbell Row",
        weight: "1 x 20-40 kg dumbbell",
        progression:
          "Increase load once all sets hit top reps with no torso twist.",
        advice: "Drive elbow to hip and pause at top.",
        sets: 3,
        reps: "10-14",
        phases: [
          { label: "Lower", seconds: 2, color: "#ff3b30" },
          { label: "Stretch", seconds: 1, color: "#ff9f0a" },
          { label: "Row", seconds: 2, color: "#34c759" },
          { label: "Top", seconds: 1, color: "#0a84ff" }
        ]
      },
      {
        name: "Standing Dumbbell Overhead Press",
        weight: "2 x 10-22 kg dumbbells",
        progression:
          "Add 1-2 kg per dumbbell when all sets reach top reps with no back sway.",
        advice: "Squeeze glutes and keep ribs down during press.",
        sets: 3,
        reps: "6-10",
        phases: [
          { label: "Lower", seconds: 2, color: "#ff3b30" },
          { label: "Bottom", seconds: 0, color: "#ff9f0a" },
          { label: "Press", seconds: 1, color: "#34c759" },
          { label: "Top", seconds: 1, color: "#0a84ff" }
        ]
      }
    ]
  },
  {
    name: "Upper Body - Free Weights",
    hidden: false,
    exercises: [
      {
        name: "Incline Dumbbell Press",
        weight: "2 x 14-28 kg dumbbells",
        progression:
          "Increase each dumbbell by 1-2 kg when all sets reach top reps with strict range.",
        advice: "Keep shoulder blades pinned and wrists stacked.",
        sets: 4,
        reps: "8-12",
        phases: [
          { label: "Lower", seconds: 3, color: "#ff3b30" },
          { label: "Pause", seconds: 1, color: "#ff9f0a" },
          { label: "Press", seconds: 1, color: "#34c759" },
          { label: "Top", seconds: 0, color: "#0a84ff" }
        ]
      },
      {
        name: "Barbell Bent Over Row",
        weight: "35-70 kg barbell",
        progression:
          "Add 2.5-5 kg once all sets hit top reps with fixed torso position.",
        advice: "Hinge once, row to lower ribs, control the descent.",
        sets: 4,
        reps: "6-10",
        phases: [
          { label: "Lower", seconds: 2, color: "#ff3b30" },
          { label: "Stretch", seconds: 1, color: "#ff9f0a" },
          { label: "Row", seconds: 1, color: "#34c759" },
          { label: "Top", seconds: 1, color: "#0a84ff" }
        ]
      },
      {
        name: "Standing Dumbbell Overhead Press",
        weight: "2 x 10-22 kg dumbbells",
        progression:
          "Increase each dumbbell by 1-2 kg after all sets hit top reps pain free.",
        advice: "Brace hard and avoid lumbar extension.",
        sets: 3,
        reps: "6-10",
        phases: [
          { label: "Lower", seconds: 2, color: "#ff3b30" },
          { label: "Bottom", seconds: 0, color: "#ff9f0a" },
          { label: "Press", seconds: 1, color: "#34c759" },
          { label: "Top", seconds: 1, color: "#0a84ff" }
        ]
      },
      {
        name: "Dumbbell Lateral Raise",
        weight: "2 x 5-12 kg dumbbells",
        progression:
          "Increase load only after all sets reach top reps with strict no-swing form.",
        advice: "Lead with elbows and stop around shoulder height.",
        sets: 3,
        reps: "12-18",
        phases: [
          { label: "Raise", seconds: 2, color: "#34c759" },
          { label: "Top", seconds: 1, color: "#0a84ff" },
          { label: "Lower", seconds: 3, color: "#ff3b30" },
          { label: "Bottom", seconds: 0, color: "#ff9f0a" }
        ]
      },
      {
        name: "Dumbbell Hammer Curl",
        weight: "2 x 8-18 kg dumbbells",
        progression:
          "Add 1-2 kg per dumbbell when all sets reach top reps with full extension.",
        advice: "Keep elbows still and avoid torso swing.",
        sets: 3,
        reps: "10-14",
        phases: [
          { label: "Lower", seconds: 3, color: "#ff3b30" },
          { label: "Bottom", seconds: 0, color: "#ff9f0a" },
          { label: "Curl", seconds: 2, color: "#34c759" },
          { label: "Top", seconds: 1, color: "#0a84ff" }
        ]
      },
      {
        name: "Overhead Dumbbell Triceps Extension",
        weight: "1 x 16-30 kg dumbbell",
        progression:
          "Increase load when all sets hit top reps with elbows staying tight.",
        advice: "Control the stretch and lock out without flaring ribs.",
        sets: 3,
        reps: "10-14",
        phases: [
          { label: "Lower", seconds: 3, color: "#ff3b30" },
          { label: "Stretch", seconds: 1, color: "#ff9f0a" },
          { label: "Extend", seconds: 2, color: "#34c759" },
          { label: "Top", seconds: 0, color: "#0a84ff" }
        ]
      }
    ]
  },
  {
    name: "Lower Body - Free Weights",
    hidden: false,
    exercises: [
      {
        name: "Barbell Back Squat",
        weight: "35-90 kg barbell",
        progression:
          "Add 2.5-5 kg only when all sets hit top reps at full depth and stable tempo.",
        advice: "Brace, sit between hips, and drive evenly through both feet.",
        sets: 4,
        reps: "5-8",
        phases: [
          { label: "Lower", seconds: 3, color: "#ff3b30" },
          { label: "Bottom", seconds: 1, color: "#ff9f0a" },
          { label: "Stand", seconds: 1, color: "#34c759" },
          { label: "Top", seconds: 0, color: "#0a84ff" }
        ]
      },
      {
        name: "Barbell Romanian Deadlift",
        weight: "45-90 kg barbell",
        progression:
          "Increase load by 2.5-5 kg after all sets hit top reps with strict hinge.",
        advice: "Keep lats tight and feel stretch in hamstrings each rep.",
        sets: 4,
        reps: "6-10",
        phases: [
          { label: "Lower", seconds: 3, color: "#ff3b30" },
          { label: "Stretch", seconds: 1, color: "#ff9f0a" },
          { label: "Rise", seconds: 2, color: "#34c759" },
          { label: "Top", seconds: 0, color: "#0a84ff" }
        ]
      },
      {
        name: "Dumbbell Walking Lunge",
        weight: "2 x 10-24 kg dumbbells",
        progression:
          "Progress reps first, then increase each dumbbell by 2 kg total.",
        advice: "Long stride, vertical shin on front leg, stay balanced.",
        sets: 3,
        reps: "10-14",
        phases: [
          { label: "Lower", seconds: 3, color: "#ff3b30" },
          { label: "Bottom", seconds: 0, color: "#ff9f0a" },
          { label: "Drive", seconds: 1, color: "#34c759" },
          { label: "Step", seconds: 1, color: "#0a84ff" }
        ]
      },
      {
        name: "Barbell Hip Thrust",
        weight: "50-110 kg barbell",
        progression:
          "Add 5 kg after all sets hit top reps with full lockout and pause.",
        advice: "Posterior pelvic tilt at top and controlled lowering.",
        sets: 4,
        reps: "8-12",
        phases: [
          { label: "Lift", seconds: 2, color: "#34c759" },
          { label: "Top Hold", seconds: 2, color: "#0a84ff" },
          { label: "Lower", seconds: 2, color: "#ff3b30" },
          { label: "Bottom", seconds: 1, color: "#ff9f0a" }
        ]
      },
      {
        name: "Dumbbell Step Up",
        weight: "2 x 10-24 kg dumbbells",
        progression:
          "Increase load once all sets reach top reps without pushing off rear leg.",
        advice: "Drive through the lead foot and control the descent.",
        sets: 3,
        reps: "8-12",
        phases: [
          { label: "Drive Up", seconds: 1, color: "#34c759" },
          { label: "Top", seconds: 1, color: "#0a84ff" },
          { label: "Lower", seconds: 3, color: "#ff3b30" },
          { label: "Bottom", seconds: 0, color: "#ff9f0a" }
        ]
      }
    ]
  },
  {
    name: "Full Body Gym A",
    hidden: false,
    exercises: [
      {
        name: "Warm-Up: Incline Treadmill Walk",
        weight: "Bodyweight",
        progression: "",
        advice: "Raise body temperature and prep hips before loading.",
        sets: 1,
        reps: "1 round (5 min)",
        rest: "30 sec",
        phases: [{ label: "Walk", seconds: 300, color: "#34c759" }]
      },
      {
        name: "Warm-Up: Banded Glute Bridges",
        weight: "Light band",
        progression: "",
        advice: "Chin tucked, ribs down, and squeeze glutes on each rep.",
        sets: 2,
        reps: "15",
        rest: "30 sec",
        phases: [
          { label: "Lift", seconds: 2, color: "#34c759" },
          { label: "Top Squeeze", seconds: 1, color: "#0a84ff" },
          { label: "Lower", seconds: 2, color: "#ff3b30" }
        ]
      },
      {
        name: "Warm-Up: Banded Lateral Walks",
        weight: "Light band",
        progression: "",
        advice: "Stay low, keep toes forward, and maintain constant tension.",
        sets: 2,
        reps: "15 steps / side",
        rest: "30 sec",
        phases: [
          { label: "Step Out", seconds: 1, color: "#34c759" },
          { label: "Control", seconds: 1, color: "#0a84ff" },
          { label: "Step In", seconds: 1, color: "#ff3b30" }
        ]
      },
      {
        name: "Dumbbell Glute Bridge (Floor)",
        weight: "Moderate",
        progression: "Increase load when all sets hit 15 clean reps with full squeeze.",
        advice: "Chin tucked, ribs down, and hard squeeze at the top.",
        sets: 3,
        reps: "12-15",
        rest: "60-90 sec",
        phases: [
          { label: "Up", seconds: 2, color: "#34c759" },
          { label: "Squeeze", seconds: 2, color: "#0a84ff" },
          { label: "Down", seconds: 3, color: "#ff3b30" }
        ]
      },
      {
        name: "Leg Press (Feet High & Wide)",
        weight: "Moderate",
        progression: "Add load after all sets reach 12 controlled reps.",
        advice: "Push through heels and keep knees slightly out.",
        sets: 3,
        reps: "10-12",
        rest: "60-90 sec",
        phases: [
          { label: "Lower", seconds: 3, color: "#ff3b30" },
          { label: "Pause", seconds: 1, color: "#ff9f0a" },
          { label: "Press", seconds: 2, color: "#34c759" }
        ]
      },
      {
        name: "Hip Abduction Machine",
        weight: "Moderate",
        progression: "Increase load once all sets hit 20 strict reps.",
        advice: "Slight forward lean and no bouncing.",
        sets: 3,
        reps: "15-20",
        rest: "60-90 sec",
        phases: [
          { label: "Open", seconds: 2, color: "#34c759" },
          { label: "Hold", seconds: 2, color: "#0a84ff" },
          { label: "Close", seconds: 3, color: "#ff3b30" }
        ]
      },
      {
        name: "Seated Leg Curl Machine",
        weight: "Moderate",
        progression: "Increase load when all sets reach 15 clean reps.",
        advice: "Controlled reps with a slow negative.",
        sets: 2,
        reps: "12-15",
        rest: "60-90 sec",
        phases: [
          { label: "Curl", seconds: 2, color: "#34c759" },
          { label: "Squeeze", seconds: 1, color: "#0a84ff" },
          { label: "Lower", seconds: 3, color: "#ff3b30" }
        ]
      },
      {
        name: "Lat Pulldown",
        weight: "Moderate",
        progression: "Add load after all sets hit 12 reps with strict form.",
        advice: "Pull elbows down and keep chest tall.",
        sets: 3,
        reps: "10-12",
        rest: "60-90 sec",
        phases: [
          { label: "Pull", seconds: 2, color: "#34c759" },
          { label: "Return", seconds: 3, color: "#ff3b30" }
        ]
      },
      {
        name: "Chest Press Machine",
        weight: "Moderate",
        progression: "Increase load when all sets hit 12 clean reps.",
        advice: "Controlled press and stop before elbow lockout.",
        sets: 2,
        reps: "10-12",
        rest: "60-90 sec",
        phases: [
          { label: "Press", seconds: 2, color: "#34c759" },
          { label: "Lower", seconds: 2, color: "#ff3b30" }
        ]
      },
      {
        name: "Lateral Raise Machine",
        weight: "Light",
        progression: "Increase load only when all sets reach 15 strict reps.",
        advice: "Light weight and strict form.",
        sets: 2,
        reps: "12-15",
        rest: "60-90 sec",
        phases: [
          { label: "Raise", seconds: 2, color: "#34c759" },
          { label: "Lower", seconds: 3, color: "#ff3b30" }
        ]
      },
      {
        name: "Ab Crunch Machine",
        weight: "Moderate",
        progression: "Increase load after all sets reach 15 controlled reps.",
        advice: "Slow and controlled tempo.",
        sets: 2,
        reps: "12-15",
        rest: "60-90 sec",
        phases: [
          { label: "Crunch", seconds: 2, color: "#34c759" },
          { label: "Return", seconds: 3, color: "#ff3b30" }
        ]
      },
      {
        name: "Plank",
        weight: "Bodyweight",
        progression: "Build hold duration toward 40 seconds with perfect position.",
        advice: "Brace hard and keep a straight body line.",
        sets: 2,
        reps: "1 hold (30-40 sec)",
        rest: "60 sec",
        phases: [{ label: "Hold", seconds: 30, color: "#0a84ff" }]
      }
    ]
  },
  {
    name: "Chest A - Aesthetic Proportion Builder (Full Gym)",
    hidden: false,
    exercises: [
      {
        name: "Incline Barbell Press",
        weight: "Moderate-Heavy",
        progression: "Increase load when all sets hit 10 clean reps with full control.",
        advice:
          "Bench at 25-35 degrees. Main upper chest builder. Keep elbows slightly tucked and control the descent.",
        sets: 5,
        reps: "6-10",
        rest: "150 sec",
        phases: [
          { label: "Lower", seconds: 3, color: "#ff3b30" },
          { label: "Pause", seconds: 1, color: "#ff9f0a" },
          { label: "Press", seconds: 2, color: "#34c759" }
        ]
      },
      {
        name: "Incline Machine Press",
        weight: "Moderate",
        progression: "Progress reps to 12 on all sets before increasing load.",
        advice: "Drive elbows forward and inward. Keep constant tension and squeeze at the top.",
        sets: 4,
        reps: "8-12",
        rest: "120 sec",
        phases: [
          { label: "Lower", seconds: 2, color: "#ff3b30" },
          { label: "Pause", seconds: 1, color: "#ff9f0a" },
          { label: "Press", seconds: 2, color: "#34c759" }
        ]
      },
      {
        name: "Flat Dumbbell Press",
        weight: "Moderate",
        progression: "Increase dumbbell load once all sets reach 10 reps with clean form.",
        advice: "Use a deep stretch at the bottom. Think hug motion to load chest, not triceps.",
        sets: 4,
        reps: "8-10",
        rest: "120 sec",
        phases: [
          { label: "Lower", seconds: 2, color: "#ff3b30" },
          { label: "Pause", seconds: 1, color: "#ff9f0a" },
          { label: "Press", seconds: 2, color: "#34c759" }
        ]
      },
      {
        name: "Cable Fly (Low to High)",
        weight: "Light-Moderate",
        progression: "Add small load only when all sets hit 15 strict reps.",
        advice: "Targets upper-inner chest. Scoop up and in, then pause and squeeze hard.",
        sets: 4,
        reps: "12-15",
        rest: "75 sec",
        phases: [
          { label: "Stretch", seconds: 3, color: "#ff3b30" },
          { label: "Squeeze", seconds: 1, color: "#0a84ff" },
          { label: "Return", seconds: 2, color: "#34c759" }
        ]
      },
      {
        name: "Pec Deck Machine",
        weight: "Moderate",
        progression: "Increase load when all sets reach 15 controlled reps with full squeeze.",
        advice: "Keep chest up and shoulders back. Squeeze inner chest line for definition.",
        sets: 3,
        reps: "12-15",
        rest: "75 sec",
        phases: [
          { label: "Open", seconds: 2, color: "#ff3b30" },
          { label: "Squeeze", seconds: 2, color: "#0a84ff" },
          { label: "Close", seconds: 2, color: "#34c759" }
        ]
      },
      {
        name: "Chest Dips (Forward Lean)",
        weight: "Bodyweight",
        progression: "Add external load only if all sets stay strict through full range.",
        advice: "Lean forward with slight elbow flare. Go deep for stretch and keep reps clean.",
        sets: 3,
        reps: "8-12",
        rest: "90 sec",
        phases: [
          { label: "Lower", seconds: 2, color: "#ff3b30" },
          { label: "Stretch", seconds: 1, color: "#ff9f0a" },
          { label: "Up", seconds: 2, color: "#34c759" }
        ]
      },
      {
        name: "Cable Crossover (Midline Focus)",
        weight: "Light",
        progression: "Keep weight light; prioritize quality squeeze and increase reps first.",
        advice: "Focus on slow squeeze and clean inner chest contraction for the finish.",
        sets: 3,
        reps: "15-20",
        rest: "60 sec",
        phases: [
          { label: "Open", seconds: 2, color: "#ff3b30" },
          { label: "Squeeze", seconds: 2, color: "#0a84ff" },
          { label: "Close", seconds: 2, color: "#34c759" }
        ]
      },
      {
        name: "Chest Stretch Hold",
        weight: "Bodyweight",
        progression: "Increase hold quality first, then extend toward longer controlled holds.",
        advice: "Use cable or doorway stretch to keep open chest posture and clean proportions.",
        sets: 2,
        reps: "1 hold (30 sec)",
        rest: "45 sec",
        phases: [{ label: "Hold", seconds: 30, color: "#0a84ff" }]
      }
    ]
  },
  {
    name: "Workout A — Widen & Frame",
    hidden: true,
    exercises: [
      {
        name: "Abductor Machine",
        weight: "45–50 kg",
        progression:
          "When all 4 sets reach 15 reps clean, increase weight by +2.5 kg. If reps drop below 12, reduce by 2.5 kg.",
        advice: "Primary width builder. Full range and hard pauses wide.",
        sets: 4,
        reps: "12–15",
        rest: "2-2.5 min",
        phases: [
          { label: "Open", seconds: 2, color: "#34c759" },
          { label: "Wide Hold", seconds: 2, color: "#0a84ff" },
          { label: "Close", seconds: 2, color: "#ff3b30" },
          { label: "Stretch", seconds: 1, color: "#ff9f0a" }
        ]
      },
      {
        name: "45° Leg Press — High & Very Wide",
        weight: "80–95 kg",
        progression:
          "Increase +5 kg only if all 3 sets reach 12 reps pain-free. Never exceed 95 kg. If knee discomfort appears, drop 5–10 kg.",
        advice: "Width via diagonal loading, not projection.",
        sets: 3,
        reps: "10–12",
        rest: "2.5-3 min",
        phases: [
          { label: "Lower", seconds: 3, color: "#ff3b30" },
          { label: "Bottom", seconds: 1, color: "#ff9f0a" },
          { label: "Press", seconds: 1, color: "#34c759" },
          { label: "Top", seconds: 0, color: "#0a84ff" }
        ]
      },
      {
        name: "Reverse Lunges — Long Step",
        weight: "12–15 kg dumbbells",
        progression:
          "Progress reps to 10 per leg first. When achieved on all sets, increase dumbbells by +2 kg total.",
        advice: "Upper-outer glute stretch driver.",
        sets: 3,
        reps: "8–10 / leg",
        rest: "2 min",
        phases: [
          { label: "Lower", seconds: 4, color: "#ff3b30" },
          { label: "Bottom", seconds: 0, color: "#ff9f0a" },
          { label: "Up", seconds: 1, color: "#34c759" },
          { label: "Top", seconds: 0, color: "#0a84ff" }
        ]
      },
      {
        name: "Machine Glute Bridge (Maintenance)",
        weight: "45–55 kg",
        progression:
          "Do NOT exceed 55 kg. If reps exceed 15 easily, slow tempo instead of adding weight.",
        advice: "Projection maintenance only.",
        sets: 3,
        reps: "12–15",
        rest: "90-120 sec",
        phases: [
          { label: "Lift", seconds: 2, color: "#34c759" },
          { label: "Top Hold", seconds: 2, color: "#0a84ff" },
          { label: "Lower", seconds: 1, color: "#ff3b30" },
          { label: "Bottom", seconds: 1, color: "#ff9f0a" }
        ]
      },
      {
        name: "Standing Cable Abduction",
        weight: "7.5–12.5 kg",
        progression:
          "Increase weight when all sets reach 20 reps per side without torso movement.",
        advice: "Finish width with unilateral control.",
        sets: 3,
        reps: "15–20 / side",
        rest: "60-75 sec",
        phases: [
          { label: "Out", seconds: 2, color: "#34c759" },
          { label: "Wide", seconds: 1, color: "#0a84ff" },
          { label: "Return", seconds: 2, color: "#ff3b30" },
          { label: "Stretch", seconds: 0, color: "#ff9f0a" }
        ]
      }
    ]
  },
  {
    name: "Workout B — Round & Inflate",
    hidden: true,
    exercises: [
      {
        name: "Cable Pull-Through — Wide Stance",
        weight: "25–35 kg",
        progression:
          "Increase +5 kg when all sets hit 15 reps with full stretch and no lower-back involvement.",
        advice: "Stretch + fullness without projection dominance.",
        sets: 3,
        reps: "12–15",
        rest: "90 sec",
        phases: [
          { label: "Hinge Back", seconds: 4, color: "#ff3b30" },
          { label: "Stretch", seconds: 1, color: "#ff9f0a" },
          { label: "Drive Forward", seconds: 2, color: "#34c759" },
          { label: "Top", seconds: 1, color: "#0a84ff" }
        ]
      },
      {
        name: "Abductor Machine (High Rep)",
        weight: "35–40 kg",
        progression:
          "Increase weight only when all sets exceed 20 reps with full ROM.",
        advice: "Secondary width stimulus.",
        sets: 3,
        reps: "15–20",
        rest: "60-75 sec",
        phases: [
          { label: "Open", seconds: 3, color: "#34c759" },
          { label: "Wide Hold", seconds: 2, color: "#0a84ff" },
          { label: "Close", seconds: 2, color: "#ff3b30" },
          { label: "Stretch", seconds: 2, color: "#ff9f0a" }
        ]
      },
      {
        name: "Romanian Split Squat — Long Step",
        weight: "10–15 kg dumbbells",
        progression:
          "Add weight only when all sets reach 12 reps per side without balance loss.",
        advice: "Upper glute stretch for roundness.",
        sets: 3,
        reps: "10–12 / leg",
        rest: "90 sec",
        phases: [
          { label: "Lower", seconds: 4, color: "#ff3b30" },
          { label: "Stretch", seconds: 1, color: "#ff9f0a" },
          { label: "Up", seconds: 1, color: "#34c759" },
          { label: "Top", seconds: 0, color: "#0a84ff" }
        ]
      },
      {
        name: "Machine Hip Bridge — High Rep",
        weight: "35–45 kg",
        progression: "Do not increase beyond 45 kg. Increase reps up to 20 instead.",
        advice: "Projection maintenance pump.",
        sets: 3,
        reps: "15–20",
        rest: "60-90 sec",
        phases: [
          { label: "Lift", seconds: 2, color: "#34c759" },
          { label: "Top Hold", seconds: 3, color: "#0a84ff" },
          { label: "Lower", seconds: 1, color: "#ff3b30" },
          { label: "Bottom", seconds: 1, color: "#ff9f0a" }
        ]
      },
      {
        name: "Lean-Away Cable Abduction",
        weight: "7.5–10 kg",
        progression:
          "Progress reps up to 25 per side before increasing weight.",
        advice: "Metabolic width finisher.",
        sets: 3,
        reps: "20–25",
        rest: "45-60 sec",
        phases: [
          { label: "Out", seconds: 2, color: "#34c759" },
          { label: "Wide", seconds: 1, color: "#0a84ff" },
          { label: "Return", seconds: 3, color: "#ff3b30" },
          { label: "Stretch", seconds: 1, color: "#ff9f0a" }
        ]
      }
    ]
  },
  {
    name: "Upper — Glute-Priority Support Session",
    hidden: true,
    exercises: [
      {
        name: "Low-Incline Plate or Dumbbell Squeeze Press",
        weight: "4–8 kg total",
        advice: "Shoulders down and back. Gentle squeeze, no lower chest drive.",
        sets: 3,
        reps: "15–25",
        rest: "75 sec",
        phases: [
          { label: "Lower", seconds: 4, color: "#ff3b30" },
          { label: "Pause", seconds: 1, color: "#ff9f0a" },
          { label: "Press", seconds: 3, color: "#34c759" },
          { label: "Top", seconds: 0, color: "#0a84ff" }
        ]
      },
      {
        name: "Dumbbell Lateral Raise",
        weight: "3–6 kg",
        advice: "Lead with elbows, stop at shoulder height, no shrugging.",
        sets: 3,
        reps: "15–25",
        rest: "60 sec",
        phases: [
          { label: "Raise", seconds: 3, color: "#34c759" },
          { label: "Top Hold", seconds: 1, color: "#0a84ff" },
          { label: "Lower", seconds: 2, color: "#ff3b30" },
          { label: "Bottom", seconds: 0, color: "#ff9f0a" }
        ]
      },
      {
        name: "Rear Delt Raise (Prone or Standing)",
        weight: "2–5 kg",
        advice: "Keep traps relaxed, strict isolation, smooth control.",
        sets: 3,
        reps: "15–25",
        rest: "60 sec",
        phases: [
          { label: "Raise", seconds: 3, color: "#34c759" },
          { label: "Top Hold", seconds: 1, color: "#0a84ff" },
          { label: "Lower", seconds: 2, color: "#ff3b30" },
          { label: "Bottom", seconds: 0, color: "#ff9f0a" }
        ]
      },
      {
        name: "Abdominal Vacuum Holds",
        weight: "Bodyweight",
        advice: "Exhale fully, pull navel inward, stay tall.",
        sets: 5,
        reps: "30–60 sec hold",
        rest: "30 sec",
        phases: [
          { label: "Exhale", seconds: 5, color: "#ff9f0a" },
          { label: "Vacuum Hold", seconds: 30, color: "#0a84ff" },
          { label: "Release", seconds: 5, color: "#34c759" }
        ]
      },
      {
        name: "Optional Light Arm Maintenance",
        weight: "Light",
        advice: "Strict form, no swinging, stop before excessive pump.",
        sets: 2,
        reps: "15–20",
        rest: "60 sec",
        phases: [
          { label: "Lower", seconds: 2, color: "#ff3b30" },
          { label: "Pause", seconds: 1, color: "#ff9f0a" },
          { label: "Lift", seconds: 2, color: "#34c759" },
          { label: "Top", seconds: 0, color: "#0a84ff" }
        ]
      }
    ]
  },
  {
    name: "Width Acceleration Day - Low Fatigue Glute Session",
    hidden: true,
    exercises: [
      {
        name: "Abductor Machine - Top-Range Partials",
        weight: "~60% of Workout A load",
        advice:
          "Open near-max and pulse only in the outer third. Close a little, reopen hard, keep the stack off rest, and stop if the waist starts rocking.",
        sets: 4,
        reps: "20 partials",
        rest: "45-60 sec",
        phases: [
          { label: "Pulse Open", seconds: 1, color: "#34c759" },
          { label: "Micro Hold", seconds: 1, color: "#0a84ff" },
          { label: "Pulse Return", seconds: 1, color: "#ff3b30" }
        ]
      },
      {
        name: "Lean-Away Cable Abduction - Long Hold",
        weight: "Light",
        advice: "Lean away, pelvis locked. Lift with heel and hold hard at top.",
        sets: 3,
        reps: "12-15 / side (3-sec hold)",
        rest: "30-45 sec",
        phases: [
          { label: "Lift", seconds: 2, color: "#34c759" },
          { label: "Top Hold", seconds: 3, color: "#0a84ff" },
          { label: "Lower", seconds: 2, color: "#ff3b30" }
        ]
      },
      {
        name: "Wide-Stance Bodyweight Squat - Isometric Hold",
        weight: "Bodyweight",
        advice: "Very wide stance, toes out, sit low, push knees outward continuously.",
        sets: 3,
        reps: "30-45 sec hold",
        rest: "60 sec",
        phases: [
          { label: "Lower Into Position", seconds: 3, color: "#ff3b30" },
          { label: "Isometric Hold", seconds: 30, color: "#0a84ff" },
          { label: "Stand Up", seconds: 2, color: "#34c759" }
        ]
      },
      {
        name: "Frog Pumps - Constant Tension",
        weight: "Bodyweight",
        advice: "Feet together, knees wide. Continuous reps, no lockout at top.",
        sets: 3,
        reps: "30-40",
        rest: "45 sec",
        phases: [
          { label: "Lift", seconds: 1, color: "#34c759" },
          { label: "Top Squeeze", seconds: 1, color: "#0a84ff" },
          { label: "Lower", seconds: 1, color: "#ff3b30" }
        ]
      },
      {
        name: "Side-Lying Hip Abduction - Strict",
        weight: "Bodyweight",
        advice: "Heel slightly behind body, toes angled down, strict control.",
        sets: 2,
        reps: "20-25 / side",
        rest: "30-45 sec",
        phases: [
          { label: "Lift", seconds: 2, color: "#34c759" },
          { label: "Top Hold", seconds: 1, color: "#0a84ff" },
          { label: "Lower", seconds: 3, color: "#ff3b30" }
        ]
      }
    ]
  }

];

const DEFAULT_HIDDEN_WORKOUT_NAMES = new Set([
  "workout a — widen & frame",
  "workout b — round & inflate",
  "upper — glute-priority support session",
  "width acceleration day - low fatigue glute session"
]);

const DEFAULT_VISIBLE_PRESET_WORKOUT_NAMES = new Set(
  PRESET_WORKOUTS_SOURCE.map((item) => {
    if (!item || typeof item !== "object") {
      return null;
    }
    const candidate = item as { name?: unknown; hidden?: unknown };
    if (candidate.hidden === true) {
      return null;
    }
    if (typeof candidate.name !== "string") {
      return null;
    }
    const normalized = candidate.name.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
  }).filter((name): name is string => Boolean(name))
);

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

const HOLD_PHASE_PATTERN = /\b(hold|pause|isometric|iso|squeeze|top|bottom|stretch|contract|peak)\b/i;
const NEGATIVE_PHASE_PATTERN =
  /\b(lower|return|down|eccentric|negative|descent|close|hinge|drop|release)\b/i;
const POSITIVE_PHASE_PATTERN =
  /\b(lift|raise|up|stand|drive|press|pull|row|kick|open|curl|extend|push|thrust|rise)\b/i;

const getSemanticPhaseColor = (label: string): string => {
  const normalizedLabel = label.trim().toLowerCase();
  if (!normalizedLabel) {
    return PHASE_COLOR_NEUTRAL;
  }
  if (HOLD_PHASE_PATTERN.test(normalizedLabel)) {
    return PHASE_COLOR_HOLD;
  }
  if (NEGATIVE_PHASE_PATTERN.test(normalizedLabel)) {
    return PHASE_COLOR_NEGATIVE;
  }
  if (POSITIVE_PHASE_PATTERN.test(normalizedLabel)) {
    return PHASE_COLOR_POSITIVE;
  }
  return PHASE_COLOR_NEUTRAL;
};

const formatTempo = (phases: { seconds: number }[]): string => {
  return phases.map((phase) => phase.seconds).join("-");
};

const makePhases = (durations: number[], existing?: Phase[]): Phase[] => {
  return durations.map((seconds, index) => {
    const prior = existing?.[index];
    const label = prior?.label ?? `Phase ${index + 1}`;
    return {
      id: prior?.id ?? createId(),
      label,
      seconds: Number.isFinite(seconds) ? seconds : 1,
      color: getSemanticPhaseColor(label)
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
    advice: "",
    weight: "",
    progression: "",
    loadProgression: "",
    repProgression: "",
    effortCapRir: 2,
    setType: "reps",
    intentTags: [],
    repRange: `${reps}`,
    sets,
    reps,
    phases: makePhases(safeDurations)
  };
};

const makeWorkout = (name = "Workout A"): Workout => {
  return {
    id: createId(),
    name,
    hidden: false,
    exercises: [makeExercise("Exercise 1")]
  };
};

const normalizeWorkoutPhaseColors = (workouts: Workout[]): Workout[] => {
  let changed = false;
  const next = workouts.map((workout) => {
    let workoutChanged = false;
    const exercises = workout.exercises.map((exercise) => {
      let exerciseChanged = false;
      const phases = exercise.phases.map((phase) => {
        const semanticColor = getSemanticPhaseColor(phase.label);
        if (phase.color === semanticColor) {
          return phase;
        }
        exerciseChanged = true;
        return {
          ...phase,
          color: semanticColor
        };
      });
      if (!exerciseChanged) {
        return exercise;
      }
      workoutChanged = true;
      return {
        ...exercise,
        phases
      };
    });
    if (!workoutChanged) {
      return workout;
    }
    changed = true;
    return {
      ...workout,
      exercises
    };
  });
  return changed ? next : workouts;
};

const normalizeUsername = (value: string): string => value.trim().toLowerCase();

const mergeUpdatedHiddenPresets = (storedWorkouts: Workout[]): Workout[] => {
  const latestHiddenPresetsByName = new Map(
    getPresetWorkouts()
      .filter((workout) => DEFAULT_HIDDEN_WORKOUT_NAMES.has(workout.name.trim().toLowerCase()))
      .map((workout) => [workout.name.trim().toLowerCase(), workout] as const)
  );
  if (latestHiddenPresetsByName.size === 0) {
    return storedWorkouts;
  }
  return storedWorkouts.map((workout) => {
    const normalizedName = typeof workout.name === "string" ? workout.name.trim().toLowerCase() : "";
    const latest = latestHiddenPresetsByName.get(normalizedName);
    if (!latest) {
      return workout;
    }
    const existingExercises = Array.isArray(workout.exercises) ? workout.exercises : [];
    const exercises = latest.exercises.map((exercise, index) => ({
      ...exercise,
      id:
        typeof existingExercises[index]?.id === "string" && existingExercises[index].id.trim()
          ? existingExercises[index].id
          : exercise.id
    }));
    return {
      ...workout,
      hidden: true,
      exercises
    };
  });
};

const loadWorkouts = (input?: unknown): Workout[] => {
  try {
    if (!input) {
      return getPresetWorkouts();
    }
    const parsed = input as Workout[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return getPresetWorkouts();
    }
    return mergeUpdatedHiddenPresets(parsed);
  } catch {
    return getPresetWorkouts();
  }
};

const loadProgress = (input?: unknown): ProgressState => {
  try {
    if (!input || typeof input !== "object") {
      return {};
    }
    return input as ProgressState;
  } catch {
    return {};
  }
};

const loadRunPreferences = (input?: unknown): RunPreferences => {
  try {
    if (!input || typeof input !== "object") {
      return DEFAULT_RUN_PREFERENCES;
    }
    const parsed = input as Partial<RunPreferences>;
    const goal =
      parsed.goal === "strength" || parsed.goal === "hypertrophy" || parsed.goal === "endurance"
        ? parsed.goal
        : DEFAULT_RUN_PREFERENCES.goal;
    return {
      goal,
      restSeconds: Math.max(
        0,
        Math.round(
          typeof parsed.restSeconds === "number"
            ? parsed.restSeconds
            : DEFAULT_RUN_PREFERENCES.restSeconds
        )
      ),
      autoStartNextSet:
        typeof parsed.autoStartNextSet === "boolean"
          ? parsed.autoStartNextSet
          : DEFAULT_RUN_PREFERENCES.autoStartNextSet,
      countdownSeconds: clamp(
        Math.round(
          typeof parsed.countdownSeconds === "number"
            ? parsed.countdownSeconds
            : DEFAULT_RUN_PREFERENCES.countdownSeconds
        ),
        1,
        10
      )
    };
  } catch {
    return DEFAULT_RUN_PREFERENCES;
  }
};

const loadQuickStartSeen = (input?: unknown): boolean => Boolean(input);

const loadTrainHints = (input?: unknown): TrainHintState => {
  try {
    if (!input || typeof input !== "object") {
      return DEFAULT_TRAIN_HINTS;
    }
    const parsed = input as Partial<TrainHintState>;
    return {
      startTimer: Boolean(parsed.startTimer),
      setTracker: Boolean(parsed.setTracker)
    };
  } catch {
    return DEFAULT_TRAIN_HINTS;
  }
};

const loadStoredWorkoutIds = (input?: unknown): string[] => {
  try {
    if (!Array.isArray(input)) {
      return [];
    }
    return input.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
};

const loadWeightProgressLogs = (input?: unknown): WeightProgressLog[] => {
  try {
    if (!Array.isArray(input)) {
      return [];
    }
    return input
      .filter((item): item is WeightProgressLog => {
        if (!item || typeof item !== "object") {
          return false;
        }
        const candidate = item as Partial<WeightProgressLog>;
        return (
          typeof candidate.id === "string" &&
          typeof candidate.userId === "string" &&
          typeof candidate.workoutId === "string" &&
          typeof candidate.exerciseId === "string" &&
          typeof candidate.weightKg === "number" &&
          typeof candidate.reps === "number" &&
          typeof candidate.loggedAt === "number"
        );
      })
      .map((log) => ({
        ...log,
        setsLogged: Math.max(1, Math.round(Number(log.setsLogged || 1)))
      }))
      .sort((a, b) => b.loggedAt - a.loggedAt);
  } catch {
    return [];
  }
};

const loadDayCompletionHistory = (input?: unknown): ProgramDayCompletionLog[] => {
  try {
    if (!Array.isArray(input)) {
      return [];
    }
    return input
      .filter((item): item is ProgramDayCompletionLog => {
        if (!item || typeof item !== "object") {
          return false;
        }
        const candidate = item as Partial<ProgramDayCompletionLog>;
        return (
          typeof candidate.id === "string" &&
          typeof candidate.userId === "string" &&
          typeof candidate.programId === "string" &&
          typeof candidate.dayId === "string" &&
          typeof candidate.weekKey === "string" &&
          typeof candidate.completed === "boolean" &&
          typeof candidate.updatedAt === "number"
        );
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
};

const mergeLogLists = <T extends { id: string; updatedAt?: number; loggedAt?: number }>(
  localLogs: T[],
  remoteLogs: T[],
  maxItems = 200
): T[] => {
  const merged = new Map<string, T>();
  [...remoteLogs, ...localLogs].forEach((log) => {
    const current = merged.get(log.id);
    const currentTime = current?.updatedAt ?? current?.loggedAt ?? 0;
    const nextTime = log.updatedAt ?? log.loggedAt ?? 0;
    if (!current || nextTime >= currentTime) {
      merged.set(log.id, log);
    }
  });
  return [...merged.values()]
    .sort((a, b) => (b.updatedAt ?? b.loggedAt ?? 0) - (a.updatedAt ?? a.loggedAt ?? 0))
    .slice(0, maxItems);
};

const getWeekStartKey = (inputDate = new Date()): string => {
  const date = new Date(inputDate);
  const day = date.getDay();
  const diffToMonday = (day + 6) % 7;
  date.setDate(date.getDate() - diffToMonday);
  date.setHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
};

const makeProgramDayCompletionKey = (programId: string, dayId: string): string => {
  return `${programId}::${dayId}`;
};

const normalizeProgramDays = (
  input: unknown,
  fallback = DEFAULT_PROGRAM_TEMPLATE
): ProgramTemplateDay[] => {
  const fallbackDays = Array.isArray(fallback) && fallback.length > 0 ? fallback : DEFAULT_PROGRAM_TEMPLATE;
  const source = Array.isArray(input) && input.length > 0 ? input : fallbackDays;
  const normalized = source
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const candidate = item as Partial<ProgramTemplateDay>;
      return {
        id:
          typeof candidate.id === "string" && candidate.id.trim()
            ? candidate.id.trim()
            : `day-${index + 1}`,
        dayIndex: Math.max(1, Math.round(coerceNumber(candidate.dayIndex, index + 1))),
        name:
          typeof candidate.name === "string" && candidate.name.trim()
            ? candidate.name.trim()
            : `Day ${index + 1}`,
        optional: Boolean(candidate.optional),
        workoutId:
          typeof candidate.workoutId === "string" && candidate.workoutId.trim()
            ? candidate.workoutId.trim()
            : null,
        notes: typeof candidate.notes === "string" ? candidate.notes : ""
      };
    })
    .filter((item): item is ProgramTemplateDay => Boolean(item))
    .sort((a, b) => a.dayIndex - b.dayIndex);
  if (normalized.length > 0) {
    return normalized.map((day, index) => ({
      ...day,
      id: day.id || `day-${index + 1}`
    }));
  }
  return fallbackDays.map((day, index) => ({
    ...day,
    id: day.id || `day-${index + 1}`
  }));
};

const loadProgramPlans = (
  input?: unknown
): {
  plans: ProgramPlan[];
  activeProgramId: string;
} => {
  const defaultPlan: ProgramPlan = {
    id: "program-default",
    name: "Program",
    description: "Weekly training template.",
    days: normalizeProgramDays(DEFAULT_PROGRAM_TEMPLATE)
  };
  try {
    if (!input) {
      return {
        plans: [defaultPlan],
        activeProgramId: defaultPlan.id
      };
    }
    const parsed = input;

    if (Array.isArray(parsed)) {
      const legacyDays = normalizeProgramDays(parsed, DEFAULT_PROGRAM_TEMPLATE);
      const legacyPlan: ProgramPlan = {
        id: "program-legacy",
        name: "Program",
        description: "Imported legacy weekly template.",
        days: legacyDays
      };
      return {
        plans: [legacyPlan],
        activeProgramId: legacyPlan.id
      };
    }

    if (!parsed || typeof parsed !== "object") {
      return {
        plans: [defaultPlan],
        activeProgramId: defaultPlan.id
      };
    }

    const payload = parsed as {
      plans?: unknown;
      activeProgramId?: unknown;
    };
    const plansInput = Array.isArray(payload.plans) ? payload.plans : [];
    const plans = plansInput
      .map((item, index) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const candidate = item as Partial<ProgramPlan>;
        const id =
          typeof candidate.id === "string" && candidate.id.trim()
            ? candidate.id.trim()
            : `program-${index + 1}`;
        return {
          id,
          name:
            typeof candidate.name === "string" && candidate.name.trim()
              ? candidate.name.trim()
              : `Program ${index + 1}`,
          description: typeof candidate.description === "string" ? candidate.description : "",
          days: normalizeProgramDays(candidate.days, DEFAULT_PROGRAM_TEMPLATE)
        };
      })
      .filter((item): item is ProgramPlan => Boolean(item));
    const normalizedPlans = plans.length > 0 ? plans : [defaultPlan];
    const requestedActiveProgramId =
      typeof payload.activeProgramId === "string" ? payload.activeProgramId : "";
    const activeProgramId = normalizedPlans.some((item) => item.id === requestedActiveProgramId)
      ? requestedActiveProgramId
      : normalizedPlans[0].id;
    return {
      plans: normalizedPlans,
      activeProgramId
    };
  } catch {
    return {
      plans: [defaultPlan],
      activeProgramId: defaultPlan.id
    };
  }
};

const loadProgramCompletion = (input?: unknown): ProgramCompletionByWeek => {
  try {
    if (!input || typeof input !== "object") {
      return {};
    }
    const safe: ProgramCompletionByWeek = {};
    Object.entries(input as Record<string, unknown>).forEach(([weekKey, value]) => {
      if (!value || typeof value !== "object") {
        return;
      }
      const weekData: Record<string, boolean> = {};
      Object.entries(value as Record<string, unknown>).forEach(([dayId, done]) => {
        weekData[dayId] = Boolean(done);
      });
      safe[weekKey] = weekData;
    });
    return safe;
  } catch {
    return {};
  }
};

const loadSkillBlocks = (input?: unknown): SkillBlock[] => {
  try {
    if (!Array.isArray(input) || input.length === 0) {
      return DEFAULT_SKILL_BLOCKS;
    }
    const normalized = input
      .map((item, index) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const candidate = item as Partial<SkillBlock>;
        const fallback = DEFAULT_SKILL_BLOCKS[index] ?? DEFAULT_SKILL_BLOCKS[0];
        const levels = Array.isArray(candidate.levels)
          ? candidate.levels
              .map((level) => {
                if (!level || typeof level !== "object") {
                  return null;
                }
                const value = level as Partial<SkillLevel>;
                if (!value.label || typeof value.label !== "string") {
                  return null;
                }
                return {
                  label: value.label,
                  seconds: Math.max(5, Math.round(coerceNumber(value.seconds, 10)))
                };
              })
              .filter((level): level is SkillLevel => Boolean(level))
          : fallback.levels;
        return {
          id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : fallback.id,
          name:
            typeof candidate.name === "string" && candidate.name.trim() ? candidate.name : fallback.name,
          rounds: Math.max(1, Math.round(coerceNumber(candidate.rounds, fallback.rounds))),
          roundSeconds: Math.max(5, Math.round(coerceNumber(candidate.roundSeconds, fallback.roundSeconds))),
          levelIndex: clamp(
            Math.round(coerceNumber(candidate.levelIndex, fallback.levelIndex)),
            0,
            Math.max(0, levels.length - 1)
          ),
          levels,
          sessionsCompleted: Math.max(
            0,
            Math.round(coerceNumber(candidate.sessionsCompleted, fallback.sessionsCompleted))
          ),
          personalBestSeconds: Math.max(
            0,
            Math.round(coerceNumber(candidate.personalBestSeconds, fallback.personalBestSeconds))
          )
        };
      })
      .filter((item): item is SkillBlock => Boolean(item));
    return normalized.length > 0 ? normalized : DEFAULT_SKILL_BLOCKS;
  } catch {
    return DEFAULT_SKILL_BLOCKS;
  }
};

const loadRecoveryCheck = (input?: unknown): RecoveryCheck => {
  try {
    if (!input || typeof input !== "object") {
      return DEFAULT_RECOVERY_CHECK;
    }
    const parsed = input as Partial<RecoveryCheck>;
    return {
      sleepHours: clamp(coerceNumber(parsed.sleepHours, DEFAULT_RECOVERY_CHECK.sleepHours), 0, 12),
      soreness: clamp(Math.round(coerceNumber(parsed.soreness, DEFAULT_RECOVERY_CHECK.soreness)), 1, 10),
      stress: clamp(Math.round(coerceNumber(parsed.stress, DEFAULT_RECOVERY_CHECK.stress)), 1, 10),
      recommendation:
        parsed.recommendation === "full" || parsed.recommendation === "moderate" || parsed.recommendation === "light"
          ? parsed.recommendation
          : DEFAULT_RECOVERY_CHECK.recommendation,
      note: typeof parsed.note === "string" ? parsed.note : DEFAULT_RECOVERY_CHECK.note,
      updatedAt: Math.round(coerceNumber(parsed.updatedAt, DEFAULT_RECOVERY_CHECK.updatedAt))
    };
  } catch {
    return DEFAULT_RECOVERY_CHECK;
  }
};

const evaluateRecovery = (sleepHours: number, soreness: number, stress: number): RecoveryCheck => {
  const sleepScore = clamp((sleepHours / 9) * 100, 0, 100);
  const sorenessScore = clamp(100 - soreness * 10, 0, 100);
  const stressScore = clamp(100 - stress * 10, 0, 100);
  const total = sleepScore * 0.45 + sorenessScore * 0.3 + stressScore * 0.25;
  if (total >= 75) {
    return {
      sleepHours,
      soreness,
      stress,
      recommendation: "full",
      note: "Full day recommended. Keep intent quality high and stop around RIR 1-2.",
      updatedAt: Date.now()
    };
  }
  if (total >= 55) {
    return {
      sleepHours,
      soreness,
      stress,
      recommendation: "moderate",
      note: "Moderate day recommended. Keep compounds at RIR 2-3 and trim one accessory set if needed.",
      updatedAt: Date.now()
    };
  }
  return {
    sleepHours,
    soreness,
    stress,
    recommendation: "light",
    note: "Recovery version recommended. Use pump/skill work, reduce load, and avoid failure.",
    updatedAt: Date.now()
  };
};

const arraysEqual = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
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

const getSegmentDurationMs = (seconds: number): number => {
  return Math.max(0, Math.round(seconds * 1000));
};

const triggerRunCue = () => {
  if (typeof window === "undefined") {
    return;
  }
  if (typeof window.navigator.vibrate === "function") {
    window.navigator.vibrate([120, 60, 120]);
  }
  const ctor = window.AudioContext;
  if (!ctor) {
    return;
  }
  try {
    const context = new ctor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(740, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(1240, context.currentTime + 0.16);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, context.currentTime + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.24);
    window.setTimeout(() => {
      void context.close();
    }, 320);
  } catch {
    // Ignore audio restrictions/errors.
  }
};

const getExerciseSetsTarget = (exercise: Exercise): number => {
  return Math.max(1, Math.round(coerceNumber(exercise.sets, 3)));
};

const getExerciseSetType = (exercise: Exercise): SetType => {
  return normalizeSetType(exercise.setType, exercise.repRange);
};

const getExerciseRepsPerSet = (exercise: Exercise): number => {
  const setType = getExerciseSetType(exercise);
  if (setType === "hold_seconds" || setType === "duration_block") {
    return 1;
  }
  return Math.max(1, Math.round(exercise.reps));
};

const getExerciseTargetLabel = (exercise: Exercise): string => {
  const setType = getExerciseSetType(exercise);
  const repRange = exercise.repRange?.trim() || `${getExerciseRepsPerSet(exercise)}`;
  if (setType === "per_leg" && !/per leg|\/ leg|each side/i.test(repRange)) {
    return `${repRange} / leg`;
  }
  if (setType === "hold_seconds" && !/hold|sec/i.test(repRange)) {
    return `${repRange} sec hold`;
  }
  if (setType === "duration_block" && !/min|sec|round|block/i.test(repRange)) {
    return `${repRange} sec block`;
  }
  return repRange;
};

const getExerciseEffortCap = (exercise: Exercise): number => {
  return clamp(Math.round(coerceNumber(exercise.effortCapRir, 2)), 0, 5);
};

const getExerciseRestSeconds = (exercise: Exercise, fallbackSeconds: number): number => {
  if (typeof exercise.restSeconds === "number" && Number.isFinite(exercise.restSeconds)) {
    return Math.max(0, Math.round(exercise.restSeconds));
  }
  if (typeof exercise.restRange === "string" && exercise.restRange.trim()) {
    const parsed = parseRestSecondsFromText(exercise.restRange);
    if (parsed !== null) {
      return parsed;
    }
  }
  return Math.max(0, Math.round(fallbackSeconds));
};

const getExerciseRestLabel = (exercise: Exercise, fallbackSeconds: number): string => {
  if (typeof exercise.restRange === "string" && exercise.restRange.trim()) {
    return exercise.restRange.trim();
  }
  return `${getExerciseRestSeconds(exercise, fallbackSeconds)} sec`;
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

const parseRepsField = (value: unknown, fallback = 8): { reps: number; repRange: string } => {
  if (typeof value === "number" && Number.isFinite(value)) {
    const reps = Math.max(1, Math.round(value));
    return { reps, repRange: `${reps}` };
  }
  if (typeof value === "string") {
    const repRange = value.trim();
    if (!repRange) {
      return { reps: fallback, repRange: `${fallback}` };
    }
    const parsed = repRange
      .split(/[^0-9.]+/)
      .filter(Boolean)
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item) && item > 0);
    if (parsed.length > 0) {
      return { reps: Math.max(1, Math.round(parsed[0])), repRange };
    }
    return { reps: fallback, repRange };
  }
  return { reps: fallback, repRange: `${fallback}` };
};

const inferSetTypeFromRepRange = (repRange: string): SetType => {
  const normalized = repRange.trim().toLowerCase();
  if (!normalized) {
    return "reps";
  }
  if (normalized.includes("/ leg") || normalized.includes("per leg") || normalized.includes("each side")) {
    return "per_leg";
  }
  if (normalized.includes("hold") && normalized.includes("sec")) {
    return "hold_seconds";
  }
  if (normalized.includes("min") || normalized.includes("round")) {
    return "duration_block";
  }
  return "reps";
};

const normalizeSetType = (value: unknown, repRange: string): SetType => {
  if (value === "reps" || value === "per_leg" || value === "hold_seconds" || value === "duration_block") {
    return value;
  }
  return inferSetTypeFromRepRange(repRange);
};

const normalizeIntentTags = (value: unknown): ExerciseIntentTag[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const allowed = new Set(INTENT_TAGS.map((item) => item.id));
  const tags = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is ExerciseIntentTag => allowed.has(item as ExerciseIntentTag));
  return Array.from(new Set(tags));
};

const parseRestSecondsFromText = (input: string): number | null => {
  const normalized = input.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const parsed = normalized
    .split(/[^0-9.]+/)
    .filter(Boolean)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item >= 0);
  if (parsed.length === 0) {
    return null;
  }
  const isMinuteBased = /\bmin\b|\bmins\b|\bminute\b|\bminutes\b/.test(normalized);
  const base = parsed[0];
  const seconds = isMinuteBased ? base * 60 : base;
  return Math.max(0, Math.round(seconds));
};

const parseRestField = (value: unknown): { restRange?: string; restSeconds?: number } => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    const restSeconds = Math.max(0, Math.round(value));
    return { restRange: `${restSeconds} sec`, restSeconds };
  }
  if (typeof value === "string") {
    const restRange = value.trim();
    if (!restRange) {
      return {};
    }
    const parsed = parseRestSecondsFromText(restRange);
    return parsed === null ? { restRange } : { restRange, restSeconds: parsed };
  }
  return {};
};

function getPresetWorkouts(): Workout[] {
  const presets = PRESET_WORKOUTS_SOURCE
    .map((item, index) => coerceWorkout(item, index))
    .filter((item): item is Workout => Boolean(item));
  return presets.length > 0 ? presets : [makeWorkout("Workout 1")];
}

const coerceWorkout = (input: unknown, index = 0): Workout | null => {
  if (!input || typeof input !== "object") {
    return null;
  }
  const raw = input as Record<string, unknown>;
  const rawExercises = Array.isArray(raw.exercises)
    ? raw.exercises
    : Array.isArray(raw.items)
      ? raw.items
      : [];
  const exercises: Exercise[] = rawExercises.map((exerciseInput, exerciseIndex) => {
    const rawExercise = (exerciseInput ?? {}) as Record<string, unknown>;
    const exercise = rawExercise as Partial<Exercise>;
    const explicitRepRange =
      typeof rawExercise.repRange === "string" && rawExercise.repRange.trim()
        ? rawExercise.repRange.trim()
        : typeof rawExercise.rep_range === "string" && rawExercise.rep_range.trim()
          ? rawExercise.rep_range.trim()
          : "";
    const durationSeconds =
      typeof rawExercise.duration_seconds === "number" && Number.isFinite(rawExercise.duration_seconds)
        ? Math.max(1, Math.round(rawExercise.duration_seconds))
        : typeof rawExercise.durationSeconds === "number" && Number.isFinite(rawExercise.durationSeconds)
          ? Math.max(1, Math.round(rawExercise.durationSeconds))
          : null;
    const parsedReps = parseRepsField(rawExercise.reps ?? durationSeconds, 8);
    const repRange =
      explicitRepRange ||
      (durationSeconds !== null && rawExercise.reps == null
        ? `${durationSeconds} sec hold`
        : parsedReps.repRange);
    const parsedRestRange = parseRestField(rawExercise.restRange ?? rawExercise.rest ?? rawExercise.rest_range);
    const parsedRestSeconds = parseRestField(rawExercise.restSeconds ?? rawExercise.rest_seconds);
    const restRange = parsedRestRange.restRange ?? parsedRestSeconds.restRange;
    const restSeconds = parsedRestSeconds.restSeconds ?? parsedRestRange.restSeconds;
    const explicitTempo =
      typeof rawExercise.tempo === "string" && rawExercise.tempo.trim() ? rawExercise.tempo.trim() : "";
    const rawPhases = Array.isArray(exercise.phases) ? exercise.phases : [];
    const phases: Phase[] =
      rawPhases.length > 0
        ? rawPhases.map((phaseInput, phaseIndex) => {
            const phase = (phaseInput ?? {}) as Partial<Phase>;
            const label =
              typeof phase.label === "string" && phase.label.trim()
                ? phase.label.trim()
                : `Phase ${phaseIndex + 1}`;
            return {
              id: createId(),
              label,
              seconds: Math.max(0, coerceNumber(phase.seconds, 1)),
              color: getSemanticPhaseColor(label)
            };
          })
        : durationSeconds !== null
          ? [
              {
                id: createId(),
                label: "Hold",
                seconds: durationSeconds,
                color: getSemanticPhaseColor("Hold")
              }
            ]
          : explicitTempo
            ? makePhases(parseTempo(explicitTempo))
            : makePhases(parseTempo(DEFAULT_TEMPO));
    const inferredSetType =
      durationSeconds !== null
        ? /round|min|walk|practice|block/i.test(repRange)
          ? "duration_block"
          : "hold_seconds"
        : inferSetTypeFromRepRange(repRange);
    const setType = normalizeSetType(rawExercise.setType ?? rawExercise.set_type ?? inferredSetType, repRange);
    const progression = typeof rawExercise.progression === "string" ? rawExercise.progression : "";
    const advice =
      typeof rawExercise.advice === "string"
        ? rawExercise.advice
        : typeof rawExercise.notes === "string"
          ? rawExercise.notes
          : "";
    const loadProgression =
      typeof rawExercise.loadProgression === "string"
        ? rawExercise.loadProgression
        : typeof rawExercise.load_progression === "string"
          ? rawExercise.load_progression
          : progression;
    const repProgression =
      typeof rawExercise.repProgression === "string"
        ? rawExercise.repProgression
        : typeof rawExercise.rep_progression === "string"
          ? rawExercise.rep_progression
          : "";

    return {
      id: createId(),
      name:
        typeof rawExercise.name === "string" && rawExercise.name.trim()
          ? rawExercise.name.trim()
          : typeof rawExercise.exercise_name === "string" && rawExercise.exercise_name.trim()
            ? rawExercise.exercise_name.trim()
            : `Exercise ${exerciseIndex + 1}`,
      advice,
      weight:
        typeof rawExercise.weight === "string"
          ? rawExercise.weight
          : typeof rawExercise.load === "string"
            ? rawExercise.load
            : "",
      progression,
      loadProgression,
      repProgression,
      effortCapRir: clamp(
        Math.round(coerceNumber(rawExercise.effortCapRir ?? rawExercise.effort_cap_rir, 2)),
        0,
        5
      ),
      setType,
      intentTags: normalizeIntentTags(rawExercise.intentTags ?? rawExercise.intent_tags),
      repRange,
      sets: Math.max(1, Math.round(coerceNumber(rawExercise.sets ?? rawExercise.rounds, 3))),
      reps: parsedReps.reps,
      ...(restRange ? { restRange } : {}),
      ...(typeof restSeconds === "number" ? { restSeconds } : {}),
      phases
    };
  });

  const safeExercises = exercises.length > 0 ? exercises : [makeExercise("Exercise 1")];
  const workoutName =
    typeof raw.name === "string" && raw.name.trim()
      ? raw.name.trim()
      : typeof raw.workout_name === "string" && raw.workout_name.trim()
        ? raw.workout_name.trim()
        : typeof raw.workoutName === "string" && raw.workoutName.trim()
          ? raw.workoutName.trim()
          : typeof raw.title === "string" && raw.title.trim()
            ? raw.title.trim()
            : `Workout ${index + 1}`;

  return {
    id: createId(),
    name: workoutName,
    hidden: raw.hidden === true || raw.is_hidden === true,
    exercises: safeExercises
  };
};

const getYoussefCoachPlanWorkouts = (): Workout[] => {
  return YOUSSEF_COACH_PLAN_WORKOUTS_SOURCE.map((item, index) => coerceWorkout(item, index))
    .filter((item): item is Workout => Boolean(item))
    .map((workout) => ({
      ...workout,
      hidden: false
    }));
};

const ensureYoussefCoachPlanWorkouts = (existingWorkouts: Workout[]): Workout[] => {
  const customPlan = getYoussefCoachPlanWorkouts();
  if (customPlan.length === 0) {
    return existingWorkouts;
  }
  const existingByName = new Map(
    existingWorkouts.map((workout) => [workout.name.trim().toLowerCase(), workout] as const)
  );
  const seededByName = new Map(
    customPlan.map((workout) => [workout.name.trim().toLowerCase(), workout] as const)
  );
  let changed = false;
  const merged = existingWorkouts.map((workout) => {
    const latest = seededByName.get(workout.name.trim().toLowerCase());
    if (!latest) {
      return workout;
    }
    const existingExercises = Array.isArray(workout.exercises) ? workout.exercises : [];
    const existingExercisesByName = new Map(
      existingExercises
        .map((exercise) => [exercise.name.trim().toLowerCase(), exercise] as const)
        .filter(([name]) => Boolean(name))
    );
    changed = true;
    return {
      ...workout,
      hidden: latest.hidden,
      exercises: latest.exercises.map((exercise) => ({
        ...exercise,
        id: existingExercisesByName.get(exercise.name.trim().toLowerCase())?.id ?? exercise.id
      }))
    };
  });
  customPlan.forEach((planWorkout) => {
    const key = planWorkout.name.trim().toLowerCase();
    if (existingByName.has(key)) {
      return;
    }
    changed = true;
    merged.push(planWorkout);
  });
  return changed ? merged : existingWorkouts;
};

const buildProgramDaysFromConfig = (
  workouts: Workout[],
  dayConfig: Array<{
    id?: string;
    dayIndex: number;
    name: string;
    optional: boolean;
    workoutName: string | null;
    notes?: string;
  }>,
  idPrefix: string
): ProgramTemplateDay[] => {
  const workoutsByName = new Map(
    workouts.map((workout) => [workout.name.trim().toLowerCase(), workout] as const)
  );
  const findWorkoutId = (name: string): string | null =>
    workoutsByName.get(name.trim().toLowerCase())?.id ?? null;
  return dayConfig.map((day, index) => ({
    id: day.id ?? `${idPrefix}-day-${day.dayIndex}-${index + 1}`,
    dayIndex: day.dayIndex,
    name: day.name,
    optional: day.optional,
    workoutId: day.workoutName ? findWorkoutId(day.workoutName) : null,
    notes: day.notes ?? ""
  }));
};

const buildYoussefProgramPlans = (workouts: Workout[]): ProgramPlan[] => {
  const silhouettePriority: ProgramPlan = {
    id: "program-silhouette-priority",
    name: "Silhouette Priority",
    description:
      "Maximum glute-width and projection specialization with true upper-side overload, heavy projection work, pump/detail volume, and waist-contrast support.",
    days: buildProgramDaysFromConfig(
      workouts,
      [
        {
          dayIndex: 1,
          name: "Day 1 - Upper/Side Glute Overload",
          optional: false,
          workoutName: "Day 1 - Upper Glute & Side Focus (Heavy)",
          notes:
            "True upper-side priority: heavy lean-away abduction, diagonal kickback, supportive thrust, step-up, and abduction partials."
        },
        {
          dayIndex: 2,
          name: "Day 2 - Pull Skill / Waist",
          optional: false,
          workoutName: "Day 2 - Pull Skill / Waist Control",
          notes:
            "Minimum upper-body volume, tight-waist work, and light side-glute activation only. Do not create fatigue for Day 3."
        },
        {
          dayIndex: 3,
          name: "Day 3 - Side Glute Width Builder",
          optional: false,
          workoutName: "Day 3 - Side Glute Width Builder",
          notes: "Brutal width day. Chase maximum outer-hip tension, keep the waist quiet, and let the side glute absorb the whole session."
        },
        {
          dayIndex: 4,
          name: "Day 4 - Push Skill / Waist + Hip Line",
          optional: false,
          workoutName: "Day 4 - Push Skill / Line Control",
          notes:
            "Support day: minimal push skill, glute blood flow, hip-flexor opening, hollow holds, and vacuums."
        },
        {
          dayIndex: 5,
          name: "Day 5 - Glute Max Projection",
          optional: false,
          workoutName: "Day 5 - Glute Max Projection",
          notes:
            "Heavy rear-projection day: thrust strength, lengthened unilateral hinge/lunge work, back extension, and straight-back kickback."
        },
        {
          dayIndex: 6,
          name: "Day 6 - Pump & Shape Finish",
          optional: false,
          workoutName: "Day 6 - Pump & Shape Finish",
          notes:
            "High-output pump/detail day for upper-outer width and roundness. Keep it joint-friendly and avoid low-back fatigue."
        },
        {
          id: "silhouette-priority-day-6-alt",
          dayIndex: 6,
          name: "Day 6 - Alternative",
          optional: true,
          workoutName: "Day 6 - Alternative",
          notes: "Use this instead of the pump finish if Day 5 leaves glutes, hamstrings, or lower back too cooked."
        },
        {
          dayIndex: 7,
          name: "Day 7 - Recovery / Mobility",
          optional: true,
          workoutName: null,
          notes: "Full reset. Easy walk and mobility only so Day 1 can be loaded hard again."
        }
      ],
      "silhouette-priority"
    )
  };

  const perfectAnatomy: ProgramPlan = {
    id: "program-perfect-anatomy",
    name: "Perfect anatomy",
    description:
      "Coach split for exaggerated feminine glute shape + lean strong upper body and calisthenics control.",
    days: buildProgramDaysFromConfig(
      workouts,
      [
        {
          dayIndex: 1,
          name: "Day 1 - Upper Glute & Side Focus",
          optional: false,
          workoutName: "Day 1 - Upper Glute & Side Focus (Heavy)"
        },
        {
          dayIndex: 2,
          name: "Day 2 - Pull & Core",
          optional: false,
          workoutName: "Day 2 - Pull & Core"
        },
        {
          dayIndex: 3,
          name: "Day 3 - Glute Pump & Shape",
          optional: false,
          workoutName: "Day 3 - Glute Pump & Shape"
        },
        {
          dayIndex: 4,
          name: "Day 4 - Push / Shoulder / Skills",
          optional: false,
          workoutName: "Day 4 - Push / Shoulder / Skills"
        },
        {
          dayIndex: 5,
          name: "Day 5 - Glute Max Projection",
          optional: false,
          workoutName: "Day 5 - Glute Max Projection"
        },
        {
          dayIndex: 6,
          name: "Day 6 - Optional Skills / Pump",
          optional: true,
          workoutName: "Day 6 - Optional Skills / Pump"
        },
        {
          id: "perfect-anatomy-day-6-alt",
          dayIndex: 6,
          name: "Day 6 - Alternative",
          optional: true,
          workoutName: "Day 6 - Alternative",
          notes: "Swap to this if Day 5 projection work leaves glutes or hamstrings too fatigued for pump work."
        },
        {
          dayIndex: 7,
          name: "Day 7 - Recovery / Mobility",
          optional: true,
          workoutName: null,
          notes: "Recovery emphasis: mobility, walk, and low fatigue pump only."
        }
      ],
      "perfect-anatomy"
    )
  };

  const widthForge: ProgramPlan = {
    id: "program-width-forge",
    name: "Width Forge",
    description:
      "High-width glute specialization with two pump exposures and one projection-heavy day each week.",
    days: buildProgramDaysFromConfig(
      workouts,
      [
        {
          dayIndex: 1,
          name: "Day 1 - Side/Upper Heavy",
          optional: false,
          workoutName: "Day 1 - Upper Glute & Side Focus (Heavy)"
        },
        {
          dayIndex: 2,
          name: "Day 2 - Upper Pull Strength",
          optional: false,
          workoutName: "Upper Body - Free Weights"
        },
        {
          dayIndex: 3,
          name: "Day 3 - Pump and Shape",
          optional: false,
          workoutName: "Day 3 - Glute Pump & Shape"
        },
        {
          dayIndex: 4,
          name: "Day 4 - Push + Skill Lines",
          optional: false,
          workoutName: "Day 4 - Push / Shoulder / Skills"
        },
        {
          dayIndex: 5,
          name: "Day 5 - Projection Builder",
          optional: false,
          workoutName: "Day 5 - Glute Max Projection"
        },
        {
          dayIndex: 6,
          name: "Day 6 - Optional Pump",
          optional: true,
          workoutName: "Day 6 - Optional Skills / Pump"
        },
        {
          dayIndex: 7,
          name: "Day 7 - Active Recovery",
          optional: true,
          workoutName: "Full Body Gym A",
          notes: "Keep RIR 3+ on all sets and cut accessories if needed."
        }
      ],
      "width-forge"
    )
  };

  const strengthHourglass: ProgramPlan = {
    id: "program-strength-hourglass",
    name: "Strength Hourglass",
    description:
      "Balanced week with glute priority + foundational free-weight strength to maintain a slim, strong frame.",
    days: buildProgramDaysFromConfig(
      workouts,
      [
        {
          dayIndex: 1,
          name: "Day 1 - Lower Strength Base",
          optional: false,
          workoutName: "Lower Body - Free Weights"
        },
        {
          dayIndex: 2,
          name: "Day 2 - Pull and Core",
          optional: false,
          workoutName: "Day 2 - Pull & Core"
        },
        {
          dayIndex: 3,
          name: "Day 3 - Glute Shape Session",
          optional: false,
          workoutName: "Day 3 - Glute Pump & Shape"
        },
        {
          dayIndex: 4,
          name: "Day 4 - Upper Push / Skills",
          optional: false,
          workoutName: "Day 4 - Push / Shoulder / Skills"
        },
        {
          dayIndex: 5,
          name: "Day 5 - Full Body Performance",
          optional: false,
          workoutName: "Full Body - Free Weights"
        },
        {
          dayIndex: 6,
          name: "Day 6 - Optional Skill Pump",
          optional: true,
          workoutName: "Day 6 - Optional Skills / Pump"
        },
        {
          dayIndex: 7,
          name: "Day 7 - Reset",
          optional: true,
          workoutName: null,
          notes: "Light walk + mobility, no failure work."
        }
      ],
      "strength-hourglass"
    )
  };

  const leanSculpt: ProgramPlan = {
    id: "program-lean-sculpt",
    name: "Lean Sculpt 7D",
    description:
      "Lower-fatigue recomp flow emphasizing clean lines, glute detail, and sustainable weekly volume.",
    days: buildProgramDaysFromConfig(
      workouts,
      [
        {
          dayIndex: 1,
          name: "Day 1 - Full Body Technique",
          optional: false,
          workoutName: "Full Body Gym A"
        },
        {
          dayIndex: 2,
          name: "Day 2 - Pull Detail",
          optional: false,
          workoutName: "Day 2 - Pull & Core"
        },
        {
          dayIndex: 3,
          name: "Day 3 - Side Glute Pump",
          optional: false,
          workoutName: "Day 3 - Glute Pump & Shape"
        },
        {
          dayIndex: 4,
          name: "Day 4 - Push and Stability",
          optional: false,
          workoutName: "Upper Body - Free Weights"
        },
        {
          dayIndex: 5,
          name: "Day 5 - Projection + Stretch",
          optional: false,
          workoutName: "Day 5 - Glute Max Projection"
        },
        {
          dayIndex: 6,
          name: "Day 6 - Optional Cardio Skill",
          optional: true,
          workoutName: "Day 6 - Optional Skills / Pump"
        },
        {
          dayIndex: 7,
          name: "Day 7 - Recovery Flow",
          optional: true,
          workoutName: null,
          notes: "Mobility and 20-30 min easy incline walk."
        }
      ],
      "lean-sculpt"
    )
  };

  return [silhouettePriority, perfectAnatomy, widthForge, strengthHourglass, leanSculpt];
};

const ensureProgramPlans = (
  existingPlans: ProgramPlan[],
  seededPlans: ProgramPlan[]
): ProgramPlan[] => {
  if (seededPlans.length === 0) {
    return existingPlans;
  }
  if (existingPlans.length === 1) {
    const single = existingPlans[0];
    const normalizedName = single.name.trim().toLowerCase();
    const isGenericLegacy =
      single.id === "program-default" ||
      single.id === "program-legacy" ||
      normalizedName === "program" ||
      normalizedName === "program 1";
    if (isGenericLegacy) {
      return seededPlans;
    }
  }
  const merged: ProgramPlan[] = [];
  const seedById = new Map(seededPlans.map((plan) => [plan.id, plan] as const));
  const seedByName = new Map(
    seededPlans.map((plan) => [plan.name.trim().toLowerCase(), plan] as const)
  );

  const mergeProgramDaysWithSeed = (
    existingDays: ProgramTemplateDay[],
    seededDays: ProgramTemplateDay[]
  ): ProgramTemplateDay[] => {
    const normalizedExisting = normalizeProgramDays(existingDays, seededDays);
    const usedExistingIds = new Set<string>();
    return seededDays.map((seedDay, index) => {
      const existing =
        normalizedExisting.find((day) => day.id === seedDay.id) ??
        normalizedExisting.find(
          (day) =>
            !usedExistingIds.has(day.id) &&
            day.dayIndex === seedDay.dayIndex &&
            day.name.trim().toLowerCase() === seedDay.name.trim().toLowerCase()
        ) ??
        null;
      if (existing) {
        usedExistingIds.add(existing.id);
      }
      return {
        ...seedDay,
        id: existing?.id?.trim() ? existing.id : seedDay.id,
        dayIndex: seedDay.dayIndex,
        name: existing?.name?.trim() ? existing.name : seedDay.name,
        optional: typeof existing?.optional === "boolean" ? existing.optional : seedDay.optional,
        workoutId:
          typeof existing?.workoutId === "string" && existing.workoutId.trim()
            ? existing.workoutId
            : seedDay.workoutId,
        notes: typeof existing?.notes === "string" ? existing.notes : seedDay.notes
      };
    });
  };

  existingPlans.forEach((plan) => {
    const byId = seedById.get(plan.id);
    if (byId) {
      merged.push({
        ...byId,
        days: mergeProgramDaysWithSeed(plan.days, byId.days)
      });
      seedById.delete(byId.id);
      seedByName.delete(byId.name.trim().toLowerCase());
      return;
    }
    const byName = seedByName.get(plan.name.trim().toLowerCase());
    if (byName) {
      merged.push({
        ...byName,
        days: mergeProgramDaysWithSeed(plan.days, byName.days)
      });
      seedById.delete(byName.id);
      seedByName.delete(byName.name.trim().toLowerCase());
      return;
    }
    merged.push(plan);
  });

  seedById.forEach((plan) => {
    merged.push(plan);
  });

  return merged.length > 0 ? merged : seededPlans;
};

const findSeededProgramPlan = (
  plan: ProgramPlan,
  seededPlans: ProgramPlan[]
): ProgramPlan | null => {
  return (
    seededPlans.find((seededPlan) => seededPlan.id === plan.id) ??
    seededPlans.find(
      (seededPlan) => seededPlan.name.trim().toLowerCase() === plan.name.trim().toLowerCase()
    ) ??
    null
  );
};

const findSeededProgramDay = (
  day: ProgramTemplateDay,
  seededPlan: ProgramPlan | null
): ProgramTemplateDay | null => {
  if (!seededPlan) {
    return null;
  }
  return (
    seededPlan.days.find((seededDay) => seededDay.id === day.id) ??
    seededPlan.days.find((seededDay) => seededDay.dayIndex === day.dayIndex) ??
    null
  );
};

const repairProgramPlansWithWorkouts = (
  plans: ProgramPlan[],
  workouts: Workout[],
  seededPlans: ProgramPlan[] = []
): ProgramPlan[] => {
  const workoutIds = new Set(workouts.map((workout) => workout.id));
  let changed = false;

  const nextPlans = plans.map((plan) => {
    const seededPlan = findSeededProgramPlan(plan, seededPlans);
    const normalizedDays = normalizeProgramDays(plan.days, seededPlan?.days ?? DEFAULT_PROGRAM_TEMPLATE);
    const nextDays = normalizedDays.map((day) => {
      const seededDay = findSeededProgramDay(day, seededPlan);
      const validCurrentWorkoutId =
        day.workoutId && workoutIds.has(day.workoutId) ? day.workoutId : null;
      const repairedWorkoutId =
        validCurrentWorkoutId ??
        (seededDay?.workoutId && workoutIds.has(seededDay.workoutId) ? seededDay.workoutId : null);

      if (repairedWorkoutId !== day.workoutId) {
        changed = true;
      }

      return {
        ...day,
        workoutId: repairedWorkoutId
      };
    });

    if (nextDays.length !== plan.days.length) {
      changed = true;
    }

    return {
      ...plan,
      days: nextDays
    };
  });

  return changed ? nextPlans : plans;
};

const advanceRun = (state: RunState, now: number): RunState => {
  let next = { ...state };
  let remaining = next.segmentEndsAt - now;
  let loops = 0;
  const maxLoops = Math.min(300, state.phases.length * state.totalReps + state.setsTotal * 3 + 12);

  while (remaining <= 0 && loops < maxLoops) {
    if (next.completed || next.mode === "ready") {
      return {
        ...next,
        remainingMs: 0,
        segmentEndsAt: now,
        segmentDurationMs: 0
      };
    }

    if (next.mode === "rest") {
      if (!next.autoStartNextSet) {
        next = {
          ...next,
          mode: "ready",
          segmentEndsAt: now,
          segmentDurationMs: 0,
          remainingMs: 0
        };
      } else if (next.countdownMs > 0) {
        next = {
          ...next,
          mode: "countdown",
          segmentEndsAt: now + next.countdownMs,
          segmentDurationMs: next.countdownMs,
          remainingMs: next.countdownMs
        };
      } else {
        const durationMs = getSegmentDurationMs(next.phases[0]?.seconds ?? 0);
        next = {
          ...next,
          mode: "work",
          phaseIndex: 0,
          segmentEndsAt: now + durationMs,
          segmentDurationMs: durationMs,
          remainingMs: durationMs
        };
      }
      remaining = next.segmentEndsAt - now;
      loops += 1;
      continue;
    }

    if (next.mode === "countdown") {
      const durationMs = getSegmentDurationMs(next.phases[0]?.seconds ?? 0);
      next = {
        ...next,
        mode: "work",
        phaseIndex: 0,
        segmentEndsAt: now + durationMs,
        segmentDurationMs: durationMs,
        remainingMs: durationMs
      };
      remaining = next.segmentEndsAt - now;
      loops += 1;
      continue;
    }

    let nextPhaseIndex = next.phaseIndex + 1;
    let nextRepIndex = next.repIndex;

    if (nextPhaseIndex >= next.phases.length) {
      nextPhaseIndex = 0;
      nextRepIndex += 1;
    }

    if (nextRepIndex > next.totalReps) {
      return {
        ...next,
        completed: true,
        remainingMs: 0,
        segmentEndsAt: now,
        segmentDurationMs: 0
      };
    }

    const repBoundaryCrossed = nextRepIndex !== next.repIndex;
    const completedReps = nextRepIndex - 1;
    const setJustCompleted =
      repBoundaryCrossed &&
      completedReps > 0 &&
      completedReps < next.totalReps &&
      completedReps % next.repsPerSet === 0;

    if (setJustCompleted) {
      const restMs = Math.max(0, next.restMs);
      next = {
        ...next,
        mode: "rest",
        repIndex: nextRepIndex,
        phaseIndex: 0,
        segmentEndsAt: now + restMs,
        segmentDurationMs: restMs,
        remainingMs: restMs
      };
    } else {
      const durationMs = getSegmentDurationMs(next.phases[nextPhaseIndex]?.seconds ?? 0);
      next = {
        ...next,
        mode: "work",
        repIndex: nextRepIndex,
        phaseIndex: nextPhaseIndex,
        segmentEndsAt: now + durationMs,
        segmentDurationMs: durationMs,
        remainingMs: durationMs
      };
    }

    remaining = next.segmentEndsAt - now;
    loops += 1;
  }

  if (loops >= maxLoops && remaining <= 0) {
    return {
      ...next,
      completed: true,
      remainingMs: 0,
      segmentEndsAt: now,
      segmentDurationMs: 0
    };
  }

  return {
    ...next,
    remainingMs: Math.max(0, remaining)
  };
};

export default function App() {
  const [authUserCount, setAuthUserCount] = useState<number>(1);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authUsernameInput, setAuthUsernameInput] = useState<string>("");
  const [authPasswordInput, setAuthPasswordInput] = useState<string>("");
  const [authError, setAuthError] = useState<string>("");
  const [isAuthPending, setIsAuthPending] = useState<boolean>(false);
  const [isUserDataReady, setIsUserDataReady] = useState<boolean>(false);

  const [workouts, setWorkouts] = useState<Workout[]>(() => getPresetWorkouts());
  const [progress, setProgress] = useState<ProgressState>({});
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(null);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);
  const [activePage, setActivePage] = useState<AppPage>("dashboard");
  const [showHiddenWorkouts, setShowHiddenWorkouts] = useState<boolean>(false);
  const [pwaTapCount, setPwaTapCount] = useState<number>(0);
  const [mainViewMode, setMainViewMode] = useState<MainViewMode>("train");
  const [isHeaderCompact, setIsHeaderCompact] = useState<boolean>(false);
  const [workoutFilter, setWorkoutFilter] = useState<WorkoutFilter>("all");
  const [workoutSearch, setWorkoutSearch] = useState<string>("");
  const [showAllWorkouts, setShowAllWorkouts] = useState<boolean>(false);
  const [favoriteWorkoutIds, setFavoriteWorkoutIds] = useState<string[]>([]);
  const [recentWorkoutIds, setRecentWorkoutIds] = useState<string[]>([]);
  const [isQuickStartOpen, setIsQuickStartOpen] = useState<boolean>(true);
  const [trainHints, setTrainHints] = useState<TrainHintState>(DEFAULT_TRAIN_HINTS);
  const [tempoDraft, setTempoDraft] = useState<string>("");
  const [tempoError, setTempoError] = useState<string>("");
  const [runPreferences, setRunPreferences] = useState<RunPreferences>(DEFAULT_RUN_PREFERENCES);
  const [run, setRun] = useState<RunState | null>(null);
  const [programPlans, setProgramPlans] = useState<ProgramPlan[]>([]);
  const [activeProgramId, setActiveProgramId] = useState<string>("");
  const [programSession, setProgramSession] = useState<ProgramSessionContext | null>(null);
  const [programOnlyWorkouts, setProgramOnlyWorkouts] = useState<boolean>(false);
  const [workoutProgramDayId, setWorkoutProgramDayId] = useState<string>("");
  const [showProgramDayDoneModal, setShowProgramDayDoneModal] = useState<boolean>(false);
  const [lastProgramRunPromptKey, setLastProgramRunPromptKey] = useState<string>("");
  const [programCompletion, setProgramCompletion] = useState<ProgramCompletionByWeek>({});
  const [weightProgressLogs, setWeightProgressLogs] = useState<WeightProgressLog[]>([]);
  const [dayCompletionHistory, setDayCompletionHistory] = useState<ProgramDayCompletionLog[]>([]);
  const [weightDraft, setWeightDraft] = useState<string>("");
  const [weightSetsDraft, setWeightSetsDraft] = useState<string>("");
  const [weightRepsDraft, setWeightRepsDraft] = useState<string>("");
  const [weightRirDraft, setWeightRirDraft] = useState<string>("");
  const [weightNoteDraft, setWeightNoteDraft] = useState<string>("");
  const [databaseSyncState, setDatabaseSyncState] = useState<DatabaseSyncState>(
    DEFAULT_DATABASE_SYNC_STATE
  );
  const [skillBlocks, setSkillBlocks] = useState<SkillBlock[]>(DEFAULT_SKILL_BLOCKS);
  const [skillSession, setSkillSession] = useState<SkillSessionState | null>(null);
  const [recoveryCheck, setRecoveryCheck] = useState<RecoveryCheck>(DEFAULT_RECOVERY_CHECK);
  const [hexDrafts, setHexDrafts] = useState<Record<string, string>>({});
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const currentUserLabel = currentUser ?? "";
  const canRevealHiddenWorkouts =
    Boolean(currentUser) && normalizeUsername(currentUser ?? "") === PRIVILEGED_HIDDEN_USERNAME;

  useEffect(() => {
    let cancelled = false;
    void loadAuthSummary()
      .then((summary) => {
        if (!cancelled) {
          setAuthUserCount(summary.userCount);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setAuthError(error instanceof Error ? error.message : "Could not connect to MySQL.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!currentUser) {
      setIsUserDataReady(false);
      setRun(null);
      setSkillSession(null);
      setProgramSession(null);
      setProgramOnlyWorkouts(false);
      setShowProgramDayDoneModal(false);
      setLastProgramRunPromptKey("");
      setSelectedWorkoutId(null);
      setSelectedExerciseId(null);
      setWeightProgressLogs([]);
      setDayCompletionHistory([]);
      setDatabaseSyncState(DEFAULT_DATABASE_SYNC_STATE);
      setActivePage("dashboard");
      return;
    }
    let cancelled = false;
    setIsUserDataReady(false);
    setRun(null);
    setSkillSession(null);
    setProgramSession(null);
    setProgramOnlyWorkouts(false);
    setShowProgramDayDoneModal(false);
    setLastProgramRunPromptKey("");
    const normalizedUser = normalizeUsername(currentUser);
    const isPrivilegedUser = normalizedUser === PRIVILEGED_HIDDEN_USERNAME;
    setDatabaseSyncState({ status: "syncing", message: "Loading data from MySQL..." });
    void loadUserData(normalizedUser)
      .then(async (data) => {
        if (cancelled) {
          return;
        }
        const loadedWorkouts = loadWorkouts(data.workouts);
        const nextWorkoutsBase = isPrivilegedUser
          ? ensureYoussefCoachPlanWorkouts(loadedWorkouts)
          : loadedWorkouts;
        const nextWorkouts = normalizeWorkoutPhaseColors(nextWorkoutsBase);
        const loadedProgramPlansPayload = loadProgramPlans(data.programPlansPayload);
        const seededProgramPlans = isPrivilegedUser ? buildYoussefProgramPlans(nextWorkouts) : [];
        const mergedProgramPlans = isPrivilegedUser
          ? ensureProgramPlans(loadedProgramPlansPayload.plans, seededProgramPlans)
          : loadedProgramPlansPayload.plans;
        const nextProgramPlans = repairProgramPlansWithWorkouts(
          mergedProgramPlans,
          nextWorkouts,
          seededProgramPlans
        );
        const nextActiveProgramId =
          nextProgramPlans.some((plan) => plan.id === loadedProgramPlansPayload.activeProgramId)
            ? loadedProgramPlansPayload.activeProgramId
            : nextProgramPlans[0]?.id ?? "";
        const [remoteWeights, remoteDays] = await Promise.all([
          loadRecentWeightProgressLogs(normalizedUser, 500),
          loadRecentProgramDayCompletionLogs(normalizedUser, 500)
        ]);
        if (cancelled) {
          return;
        }
        setWorkouts(nextWorkouts);
        setProgress(loadProgress(data.progress));
        setRunPreferences(loadRunPreferences(data.runPreferences));
        setFavoriteWorkoutIds(loadStoredWorkoutIds(data.favoriteWorkoutIds));
        setRecentWorkoutIds(loadStoredWorkoutIds(data.recentWorkoutIds));
        setTrainHints(loadTrainHints(data.trainHints));
        setProgramPlans(nextProgramPlans);
        setActiveProgramId(nextActiveProgramId);
        setProgramCompletion(loadProgramCompletion(data.programCompletion));
        setWeightProgressLogs(
          mergeLogLists(loadWeightProgressLogs(data.weightProgressLogs), loadWeightProgressLogs(remoteWeights), 500)
        );
        setDayCompletionHistory(
          mergeLogLists(loadDayCompletionHistory(data.dayCompletionHistory), remoteDays, 500)
        );
        setSkillBlocks(loadSkillBlocks(data.skillBlocks));
        setRecoveryCheck(loadRecoveryCheck(data.recoveryCheck));
        setIsQuickStartOpen(!loadQuickStartSeen(data.quickStartSeen));
        setSelectedWorkoutId(null);
        setSelectedExerciseId(null);
        setActivePage("dashboard");
        setShowHiddenWorkouts(false);
        setPwaTapCount(0);
        setWorkoutFilter("all");
        setWorkoutSearch("");
        setShowAllWorkouts(false);
        setMainViewMode("train");
        setDatabaseSyncState({ status: "synced", message: "MySQL data loaded." });
        setIsUserDataReady(true);
      })
      .catch((error) => {
        if (!cancelled) {
          setDatabaseSyncState({
            status: "error",
            message: error instanceof Error ? error.message : "Could not load MySQL data."
          });
          setIsUserDataReady(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  const handleAuthModeChange = (mode: AuthMode) => {
    setAuthMode(mode);
    setAuthError("");
  };

  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedUsername = authUsernameInput.trim();
    const normalizedUsername = normalizeUsername(trimmedUsername);
    if (!USERNAME_PATTERN.test(trimmedUsername)) {
      setAuthError("Use 3-32 chars: letters, numbers, dot, underscore, or dash.");
      return;
    }
    if (authPasswordInput.length < 6) {
      setAuthError("Password must be at least 6 characters.");
      return;
    }
    setAuthError("");
    setIsAuthPending(true);
    try {
      if (authMode === "register") {
        const user = await registerAuthUser(trimmedUsername, authPasswordInput);
        setAuthUserCount((prev) => Math.max(prev + 1, 1));
        setCurrentUser(normalizeUsername(user.username));
      } else {
        const user = await loginAuthUser(normalizedUsername, authPasswordInput);
        setCurrentUser(normalizeUsername(user.username));
      }
      setAuthUsernameInput("");
      setAuthPasswordInput("");
      setAuthError("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setIsAuthPending(false);
    }
  };

  const handleLogout = () => {
    setRun(null);
    setSkillSession(null);
    setProgramSession(null);
    setProgramOnlyWorkouts(false);
    setShowProgramDayDoneModal(false);
    setLastProgramRunPromptKey("");
    setProgramPlans([]);
    setActiveProgramId("");
    setProgramCompletion({});
    setWeightProgressLogs([]);
    setDayCompletionHistory([]);
    setDatabaseSyncState(DEFAULT_DATABASE_SYNC_STATE);
    setSkillBlocks(DEFAULT_SKILL_BLOCKS);
    setRecoveryCheck(DEFAULT_RECOVERY_CHECK);
    setCurrentUser(null);
    setIsUserDataReady(false);
    setActivePage("dashboard");
    setAuthMode("login");
    setAuthPasswordInput("");
    setAuthError("");
  };

  const visibleWorkouts = useMemo(() => {
    return workouts.filter((workout) => (canRevealHiddenWorkouts && showHiddenWorkouts) || !workout.hidden);
  }, [canRevealHiddenWorkouts, showHiddenWorkouts, workouts]);

  const selectedWorkout = useMemo(() => {
    return (
      visibleWorkouts.find((workout) => workout.id === selectedWorkoutId) ??
      workouts.find((workout) => workout.id === selectedWorkoutId) ??
      visibleWorkouts[0]
    );
  }, [selectedWorkoutId, visibleWorkouts, workouts]);

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

  const selectedExerciseWeightLogs = useMemo(() => {
    if (!selectedWorkout || !selectedExercise) {
      return [];
    }
    return weightProgressLogs
      .filter(
        (log) =>
          log.workoutId === selectedWorkout.id &&
          log.exerciseId === selectedExercise.id &&
          !log.id.endsWith("_schema")
      )
      .sort((a, b) => b.loggedAt - a.loggedAt)
      .slice(0, 8);
  }, [selectedExercise, selectedWorkout, weightProgressLogs]);

  const recentDayCompletionHistory = useMemo(
    () =>
      dayCompletionHistory
        .filter((log) => !log.id.endsWith("_schema"))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 8),
    [dayCompletionHistory]
  );

  const isPresetWorkout = (workout: Workout): boolean => {
    return DEFAULT_VISIBLE_PRESET_WORKOUT_NAMES.has(workout.name.trim().toLowerCase());
  };

  const filteredWorkouts = useMemo(() => {
    const query = workoutSearch.trim().toLowerCase();
    return visibleWorkouts.filter((workout) => {
      const inFilter =
        workoutFilter === "all"
          ? true
          : workoutFilter === "presets"
            ? isPresetWorkout(workout)
            : !isPresetWorkout(workout) || workout.hidden;
      if (!inFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      return workout.name.toLowerCase().includes(query);
    });
  }, [visibleWorkouts, workoutFilter, workoutSearch]);

  const favoriteWorkouts = useMemo(() => {
    return favoriteWorkoutIds
      .map((id) => visibleWorkouts.find((workout) => workout.id === id))
      .filter((item): item is Workout => Boolean(item));
  }, [favoriteWorkoutIds, visibleWorkouts]);

  const recentWorkouts = useMemo(() => {
    return recentWorkoutIds
      .map((id) => visibleWorkouts.find((workout) => workout.id === id))
      .filter((item): item is Workout => Boolean(item));
  }, [recentWorkoutIds, visibleWorkouts]);

  const currentSeededProgramPlans = useMemo(
    () => (canRevealHiddenWorkouts ? buildYoussefProgramPlans(workouts) : []),
    [canRevealHiddenWorkouts, workouts]
  );

  const workoutById = useMemo(
    () => new Map(workouts.map((workout) => [workout.id, workout])),
    [workouts]
  );
  const activeProgram = useMemo(() => {
    if (programPlans.length === 0) {
      return null;
    }
    return programPlans.find((plan) => plan.id === activeProgramId) ?? programPlans[0];
  }, [activeProgramId, programPlans]);
  const programTemplate = activeProgram?.days ?? DEFAULT_PROGRAM_TEMPLATE;
  const activeProgramLabel = activeProgram?.name ?? "Program";
  const currentWeekKey = getWeekStartKey(new Date());
  const weekCompletion = programCompletion[currentWeekKey] ?? {};
  const programCompletedDays = programTemplate.filter((day) =>
    Boolean(
      weekCompletion[makeProgramDayCompletionKey(activeProgram?.id ?? "program-default", day.id)] ??
        weekCompletion[day.id]
    )
  ).length;
  const programCompletionPercent =
    programTemplate.length > 0 ? (programCompletedDays / programTemplate.length) * 100 : 0;
  const todayDayIndex = ((new Date().getDay() + 6) % 7) + 1;
  const todayProgramDay =
    programTemplate.find((day) => day.dayIndex === todayDayIndex) ?? programTemplate[0] ?? null;
  const workoutProgramDay =
    programTemplate.find((day) => day.id === workoutProgramDayId) ?? programTemplate[0] ?? null;
  const resolveProgramDayWorkout = useCallback(
    (plan: ProgramPlan | null, day: ProgramTemplateDay | null): Workout | null => {
      if (!day) {
        return null;
      }
      if (day.workoutId) {
        const directWorkout = workoutById.get(day.workoutId);
        if (directWorkout) {
          return directWorkout;
        }
      }
      const seededPlan = plan ? findSeededProgramPlan(plan, currentSeededProgramPlans) : null;
      const seededDay = findSeededProgramDay(day, seededPlan);
      return seededDay?.workoutId ? workoutById.get(seededDay.workoutId) ?? null : null;
    },
    [currentSeededProgramPlans, workoutById]
  );
  const todayWorkout = resolveProgramDayWorkout(activeProgram, todayProgramDay);
  const assignedWorkoutForProgramDay = resolveProgramDayWorkout(activeProgram, workoutProgramDay);
  const activeProgramWorkoutIds = useMemo(() => {
    const workoutIds = new Set<string>();
    programTemplate.forEach((day) => {
      const workout = resolveProgramDayWorkout(activeProgram, day);
      if (workout) {
        workoutIds.add(workout.id);
      }
    });
    return workoutIds;
  }, [activeProgram, programTemplate, resolveProgramDayWorkout]);
  const filteredProgramWorkouts = useMemo(
    () => filteredWorkouts.filter((workout) => activeProgramWorkoutIds.has(workout.id)),
    [activeProgramWorkoutIds, filteredWorkouts]
  );
  const filteredLibraryWorkouts = useMemo(
    () => filteredWorkouts.filter((workout) => !activeProgramWorkoutIds.has(workout.id)),
    [activeProgramWorkoutIds, filteredWorkouts]
  );
  const displayedProgramWorkouts = useMemo(
    () => (showAllWorkouts ? filteredProgramWorkouts : filteredProgramWorkouts.slice(0, 6)),
    [filteredProgramWorkouts, showAllWorkouts]
  );
  const displayedLibraryWorkouts = useMemo(
    () => (showAllWorkouts ? filteredLibraryWorkouts : filteredLibraryWorkouts.slice(0, 6)),
    [filteredLibraryWorkouts, showAllWorkouts]
  );

  const programSessionPlan = useMemo(() => {
    if (!programSession) {
      return null;
    }
    return programPlans.find((plan) => plan.id === programSession.programId) ?? null;
  }, [programPlans, programSession]);
  const programSessionDay = useMemo(() => {
    if (!programSessionPlan || !programSession) {
      return null;
    }
    return programSessionPlan.days.find((day) => day.id === programSession.dayId) ?? null;
  }, [programSession, programSessionPlan]);
  const isProgramContextActive = Boolean(programSessionPlan && programSessionDay);
  const programSessionWorkout = resolveProgramDayWorkout(programSessionPlan, programSessionDay);
  const programSessionWorkoutProgress = useMemo(() => {
    if (!programSessionWorkout) {
      return null;
    }
    return getWorkoutProgressView(progress, programSessionWorkout);
  }, [progress, programSessionWorkout]);
  const isProgramSessionWorkoutComplete = Boolean(
    programSessionWorkoutProgress &&
      programSessionWorkoutProgress.totalExercises > 0 &&
      programSessionWorkoutProgress.completedExercises >= programSessionWorkoutProgress.totalExercises
  );
  const programSessionCompletionKey = makeProgramDayCompletionKey(
    programSessionPlan?.id ?? "program-default",
    programSessionDay?.id ?? ""
  );
  const isProgramSessionDayCompleted = Boolean(
    weekCompletion[programSessionCompletionKey] ?? (programSessionDay ? weekCompletion[programSessionDay.id] : false)
  );
  const showProgramLibrary = !isProgramContextActive || !programOnlyWorkouts;

  const weeklyIntentCoverage = useMemo(() => {
    const counts: Record<ExerciseIntentTag, number> = {
      upper_glute: 0,
      side_glute: 0,
      projection: 0,
      skill: 0,
      pump: 0,
      strength: 0
    };
    const seenWorkoutIds = new Set<string>();
    programTemplate.forEach((day) => {
      const workout = resolveProgramDayWorkout(activeProgram, day);
      if (!workout || seenWorkoutIds.has(workout.id)) {
        return;
      }
      seenWorkoutIds.add(workout.id);
      workout.exercises.forEach((exercise) => {
        normalizeIntentTags(exercise.intentTags).forEach((tag) => {
          counts[tag] += 1;
        });
      });
    });
    return counts;
  }, [activeProgram, programTemplate, resolveProgramDayWorkout]);

  const recoveryRecommendationLabel =
    recoveryCheck.recommendation === "full"
      ? "Full day"
      : recoveryCheck.recommendation === "moderate"
        ? "Moderate day"
        : "Recovery day";
  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric"
  });

  useEffect(() => {
    setWorkouts((prev) => {
      let changed = false;
      const next = prev.map((workout) => {
        let workoutChanged = false;
        const fallbackHidden = DEFAULT_HIDDEN_WORKOUT_NAMES.has(workout.name.trim().toLowerCase());
        const normalizedHidden =
          typeof workout.hidden === "boolean" ? workout.hidden : fallbackHidden;
        const exercises = workout.exercises.map((exercise) => {
          const normalizedSets = getExerciseSetsTarget(exercise);
          const normalizedSetType = getExerciseSetType(exercise);
          const normalizedRepRange =
            typeof exercise.repRange === "string" && exercise.repRange.trim()
              ? exercise.repRange.trim()
              : `${Math.max(1, Math.round(coerceNumber(exercise.reps, 8)))}`;
          const normalizedReps = Math.max(
            1,
            Math.round(coerceNumber(exercise.reps, parseRepsField(normalizedRepRange).reps))
          );
          const normalizedAdvice =
            typeof exercise.advice === "string" ? exercise.advice : "";
          const normalizedWeight =
            typeof exercise.weight === "string" ? exercise.weight : "";
          const normalizedProgression =
            typeof exercise.progression === "string" ? exercise.progression : "";
          const normalizedLoadProgression =
            typeof exercise.loadProgression === "string"
              ? exercise.loadProgression
              : normalizedProgression;
          const normalizedRepProgression =
            typeof exercise.repProgression === "string" ? exercise.repProgression : "";
          const normalizedEffortCapRir = clamp(
            Math.round(coerceNumber(exercise.effortCapRir, 2)),
            0,
            5
          );
          const normalizedIntentTags = normalizeIntentTags(exercise.intentTags);
          if (
            exercise.sets === normalizedSets &&
            exercise.reps === normalizedReps &&
            exercise.advice === normalizedAdvice &&
            exercise.weight === normalizedWeight &&
            exercise.progression === normalizedProgression &&
            exercise.repRange === normalizedRepRange &&
            exercise.loadProgression === normalizedLoadProgression &&
            exercise.repProgression === normalizedRepProgression &&
            exercise.effortCapRir === normalizedEffortCapRir &&
            exercise.setType === normalizedSetType &&
            JSON.stringify(exercise.intentTags ?? []) === JSON.stringify(normalizedIntentTags)
          ) {
            return exercise;
          }
          workoutChanged = true;
          return {
            ...exercise,
            advice: normalizedAdvice,
            weight: normalizedWeight,
            progression: normalizedProgression,
            loadProgression: normalizedLoadProgression,
            repProgression: normalizedRepProgression,
            effortCapRir: normalizedEffortCapRir,
            setType: normalizedSetType,
            intentTags: normalizedIntentTags,
            repRange: normalizedRepRange,
            sets: normalizedSets,
            reps: normalizedReps
          };
        });
        if (workout.hidden !== normalizedHidden) {
          workoutChanged = true;
        }
        if (!workoutChanged) {
          return workout;
        }
        changed = true;
        return {
          ...workout,
          hidden: normalizedHidden,
          exercises
        };
      });
      return changed ? next : prev;
    });
  }, []);

  useEffect(() => {
    setWorkouts((prev) => {
      const existingNames = new Set(
        prev.map((workout) => workout.name.trim().toLowerCase()).filter(Boolean)
      );
      const missingPresets = getPresetWorkouts().filter(
        (preset) => !existingNames.has(preset.name.trim().toLowerCase())
      );
      if (missingPresets.length === 0) {
        return prev;
      }
      return [...prev, ...missingPresets];
    });
  }, []);

  useEffect(() => {
    if (!selectedWorkoutId && visibleWorkouts.length > 0) {
      setSelectedWorkoutId(visibleWorkouts[0].id);
      return;
    }
    if (selectedWorkoutId && !workouts.some((workout) => workout.id === selectedWorkoutId)) {
      setSelectedWorkoutId(visibleWorkouts[0]?.id ?? null);
    }
  }, [selectedWorkoutId, visibleWorkouts, workouts]);

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
      setWeightDraft("");
      setWeightSetsDraft("");
      setWeightRepsDraft("");
      setWeightRirDraft("");
      setWeightNoteDraft("");
      return;
    }
    const lastLog = selectedExerciseWeightLogs[0];
    setWeightDraft(lastLog ? String(lastLog.weightKg) : "");
    setWeightSetsDraft(
      String(lastLog?.setsLogged ?? getExerciseSetsTarget(selectedExercise))
    );
    setWeightRepsDraft(String(lastLog?.reps ?? getExerciseRepsPerSet(selectedExercise)));
    setWeightRirDraft(String(lastLog?.rir ?? getExerciseEffortCap(selectedExercise)));
    setWeightNoteDraft("");
  }, [selectedExercise?.id, selectedExerciseWeightLogs[0]?.id]);

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
    if (!currentUser || !isUserDataReady) {
      return;
    }
    const data: AppDataPayload = {
      workouts,
      progress,
      runPreferences,
      favoriteWorkoutIds,
      recentWorkoutIds,
      trainHints,
      quickStartSeen: !isQuickStartOpen,
      programPlansPayload: {
        activeProgramId: activeProgram?.id ?? activeProgramId,
        plans: programPlans
      },
      programCompletion,
      weightProgressLogs,
      dayCompletionHistory,
      skillBlocks,
      recoveryCheck
    };
    const timeoutId = window.setTimeout(() => {
      setDatabaseSyncState({ status: "syncing", message: "Saving data to MySQL..." });
      void saveUserData(normalizeUsername(currentUser), data)
        .then(() => setDatabaseSyncState({ status: "synced", message: "MySQL data saved." }))
        .catch((error) =>
          setDatabaseSyncState({
            status: "error",
            message: error instanceof Error ? error.message : "Could not save MySQL data."
          })
        );
    }, 350);
    return () => window.clearTimeout(timeoutId);
  }, [
    activeProgram?.id,
    activeProgramId,
    currentUser,
    dayCompletionHistory,
    favoriteWorkoutIds,
    isQuickStartOpen,
    isUserDataReady,
    programCompletion,
    programPlans,
    progress,
    recentWorkoutIds,
    recoveryCheck,
    runPreferences,
    skillBlocks,
    trainHints,
    weightProgressLogs,
    workouts
  ]);

  useEffect(() => {
    setShowAllWorkouts(false);
  }, [workoutFilter, workoutSearch]);

  useEffect(() => {
    const workoutIds = new Set(workouts.map((workout) => workout.id));
    setFavoriteWorkoutIds((prev) => {
      const next = prev.filter((id) => workoutIds.has(id));
      return arraysEqual(prev, next) ? prev : next;
    });
    setRecentWorkoutIds((prev) => {
      const next = prev.filter((id) => workoutIds.has(id));
      return arraysEqual(prev, next) ? prev : next;
    });
  }, [workouts]);

  useEffect(() => {
    setProgramPlans((prev) => repairProgramPlansWithWorkouts(prev, workouts, currentSeededProgramPlans));
  }, [currentSeededProgramPlans, workouts]);

  useEffect(() => {
    if (!selectedWorkout?.id) {
      return;
    }
    setRecentWorkoutIds((prev) => {
      const next = [selectedWorkout.id, ...prev.filter((id) => id !== selectedWorkout.id)].slice(0, 8);
      return arraysEqual(prev, next) ? prev : next;
    });
  }, [selectedWorkout?.id]);

  useEffect(() => {
    if (!programSession) {
      return;
    }
    if (!programSessionPlan || !programSessionDay) {
      setProgramSession(null);
      setProgramOnlyWorkouts(false);
      setShowProgramDayDoneModal(false);
      return;
    }
  }, [programSession, programSessionDay, programSessionPlan]);

  useEffect(() => {
    if (!isProgramContextActive || !programOnlyWorkouts) {
      return;
    }
    if (!programSessionWorkout) {
      setSelectedWorkoutId(null);
      setSelectedExerciseId(null);
      return;
    }
    if (selectedWorkoutId !== programSessionWorkout.id) {
      setSelectedWorkoutId(programSessionWorkout.id);
      setSelectedExerciseId(programSessionWorkout.exercises[0]?.id ?? null);
    }
  }, [isProgramContextActive, programOnlyWorkouts, programSessionWorkout, selectedWorkoutId]);

  useEffect(() => {
    if (
      !run ||
      !run.completed ||
      !isProgramContextActive ||
      !programSessionDay ||
      !programSessionPlan ||
      !isProgramSessionWorkoutComplete
    ) {
      return;
    }
    const promptKey = `${run.workoutId}|${run.exerciseId}|${run.setsTotal}|${run.totalReps}|${run.segmentEndsAt}`;
    if (promptKey === lastProgramRunPromptKey) {
      return;
    }
    setLastProgramRunPromptKey(promptKey);
    setShowProgramDayDoneModal(true);
  }, [
    isProgramContextActive,
    isProgramSessionWorkoutComplete,
    lastProgramRunPromptKey,
    programSessionDay,
    programSessionPlan,
    run?.completed,
    run?.exerciseId,
    run?.segmentEndsAt,
    run?.setsTotal,
    run?.totalReps,
    run?.workoutId
  ]);

  useEffect(() => {
    const handleScroll = () => {
      setIsHeaderCompact(window.scrollY > 14);
    };
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (!run || run.completed || run.isPaused || run.mode === "ready") {
      return;
    }

    const timer = window.setInterval(() => {
      setRun((prev) => {
        if (!prev || prev.completed || prev.isPaused || prev.mode === "ready") {
          return prev;
        }
        const now = performance.now();
        const remaining = prev.segmentEndsAt - now;
        if (remaining > 0) {
          return { ...prev, remainingMs: remaining };
        }
        const next = advanceRun(prev, now);
        const shouldCue =
          (prev.mode === "rest" && next.mode !== "rest") ||
          (prev.mode === "countdown" && next.mode === "work");
        if (shouldCue) {
          triggerRunCue();
        }
        return next;
      });
    }, 100);

    return () => window.clearInterval(timer);
  }, [run?.completed, run?.exerciseName, run?.isPaused, run?.mode]);

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
    markTrainHintSeen("setTracker");
  };

  const syncWeightProgressLog = (log: WeightProgressLog) => {
    setDatabaseSyncState({
      status: "syncing",
      message: "Saving weight log to MySQL..."
    });
    void saveWeightProgressLog(log)
      .then(() =>
        setDatabaseSyncState({
          status: "synced",
          message: "Weight log saved to MySQL."
        })
      )
      .catch((error) =>
        setDatabaseSyncState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not save weight log."
        })
      );
  };

  const syncProgramDayCompletionLog = (log: ProgramDayCompletionLog) => {
    setDatabaseSyncState({
      status: "syncing",
      message: "Saving day completion to MySQL..."
    });
    void saveProgramDayCompletionLog(log)
      .then(() =>
        setDatabaseSyncState({
          status: "synced",
          message: "Day completion saved to MySQL."
        })
      )
      .catch((error) =>
        setDatabaseSyncState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not save day completion."
        })
      );
  };

  const logWeightProgress = () => {
    if (!currentUser || !selectedWorkout || !selectedExercise) {
      return;
    }
    const weightKg = Number(weightDraft.replace(",", "."));
    const setsLogged = Math.round(Number(weightSetsDraft));
    const reps = Math.round(Number(weightRepsDraft));
    const parsedRir = weightRirDraft.trim() ? Math.round(Number(weightRirDraft)) : null;
    if (
      !Number.isFinite(weightKg) ||
      weightKg <= 0 ||
      !Number.isFinite(setsLogged) ||
      setsLogged <= 0 ||
      !Number.isFinite(reps) ||
      reps <= 0
    ) {
      window.alert("Enter a valid weight, sets, and reps before logging.");
      return;
    }
    if (parsedRir !== null && (!Number.isFinite(parsedRir) || parsedRir < 0 || parsedRir > 10)) {
      window.alert("RIR must be between 0 and 10.");
      return;
    }
    const matchedProgramDay =
      programSessionDay ?? programTemplate.find((day) => day.workoutId === selectedWorkout.id) ?? null;
    const matchedProgram = programSessionPlan ?? activeProgram;
    const now = Date.now();
    const setIndex = Math.max(1, (selectedExerciseProgress?.setsDone ?? 0) + 1);
    const log: WeightProgressLog = {
      id: `weight-${now}-${createId()}`,
      userId: normalizeUsername(currentUser),
      programId: matchedProgram?.id ?? null,
      programName: matchedProgram?.name ?? null,
      dayId: matchedProgramDay?.id ?? null,
      dayName: matchedProgramDay?.name ?? null,
      workoutId: selectedWorkout.id,
      workoutName: selectedWorkout.name,
      exerciseId: selectedExercise.id,
      exerciseName: selectedExercise.name,
      setIndex,
      setsLogged,
      weightKg,
      reps,
      rir: parsedRir,
      note: weightNoteDraft.trim(),
      loggedAt: now,
      createdAt: now,
      updatedAt: now
    };
    setWeightProgressLogs((prev) => mergeLogLists(prev, [log], 500));
    setExerciseProgressSets(
      selectedWorkout.id,
      selectedExercise.id,
      (selectedExerciseProgress?.setsDone ?? 0) + setsLogged
    );
    setWeightNoteDraft("");
    syncWeightProgressLog(log);
  };

  const recordProgramDayCompletionLog = (
    dayId: string,
    completed: boolean,
    programId = activeProgram?.id ?? "program-default"
  ) => {
    if (!currentUser) {
      return;
    }
    const plan = programPlans.find((item) => item.id === programId) ?? activeProgram;
    const day = plan?.days.find((item) => item.id === dayId) ?? null;
    if (!plan || !day) {
      return;
    }
    const workout = resolveProgramDayWorkout(plan, day);
    const now = Date.now();
    const log: ProgramDayCompletionLog = {
      id: `day-${programId}-${dayId}-${currentWeekKey}-${now}`,
      userId: normalizeUsername(currentUser),
      programId,
      programName: plan.name,
      dayId,
      dayName: day.name,
      workoutId: workout?.id ?? null,
      workoutName: workout?.name ?? null,
      weekKey: currentWeekKey,
      completed,
      completedAt: completed ? now : null,
      updatedAt: now
    };
    setDayCompletionHistory((prev) => mergeLogLists(prev, [log], 300));
    syncProgramDayCompletionLog(log);
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

  const resetWorkoutProgress = () => {
    if (!selectedWorkout) {
      return;
    }
    setProgress((prev) => {
      if (!prev[selectedWorkout.id]) {
        return prev;
      }
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

  const setPhaseColor = (phaseId: string, _color: string) => {
    if (!selectedExercise) {
      return;
    }
    const targetPhase = selectedExercise.phases.find((phase) => phase.id === phaseId);
    if (!targetPhase) {
      return;
    }
    const semanticColor = getSemanticPhaseColor(targetPhase.label);
    updateExercise(selectedExercise.id, (exercise) => ({
      ...exercise,
      phases: exercise.phases.map((item) =>
        item.id === phaseId ? { ...item, color: semanticColor } : item
      )
    }));
    setHexDrafts((prev) => ({ ...prev, [phaseId]: semanticColor }));
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
      const label = `Phase ${nextIndex + 1}`;
      const newPhase: Phase = {
        id: createId(),
        label,
        seconds: 1,
        color: getSemanticPhaseColor(label)
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

  const exportProgram = () => {
    if (!activeProgram) {
      return;
    }
    const assignedWorkoutIds = new Set(
      activeProgram.days.map((day) => resolveProgramDayWorkout(activeProgram, day)?.id).filter(Boolean)
    );
    const assignedWorkouts = workouts.filter((workout) => assignedWorkoutIds.has(workout.id));
    const payload = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        appVersion: APP_VERSION,
        program: activeProgram,
        assignedWorkouts,
        currentWeek: {
          weekKey: currentWeekKey,
          completion: weekCompletion
        }
      },
      null,
      2
    );
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeName =
      activeProgram.name
        .trim()
        .replace(/[^a-z0-9-_]+/gi, "_")
        .replace(/^_+|_+$/g, "") || "program";
    link.href = url;
    link.download = `${safeName}-program.json`;
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

  const applyGoalPreset = (goal: TrainingGoal) => {
    setRunPreferences((prev) => ({
      ...prev,
      goal,
      restSeconds: REST_PRESETS[goal]
    }));
  };

  const markTrainHintSeen = (hint: keyof TrainHintState) => {
    setTrainHints((prev) => (prev[hint] ? prev : { ...prev, [hint]: true }));
  };

  const closeQuickStart = () => {
    setMainViewMode("train");
    setIsQuickStartOpen(false);
  };

  const choosePresetFromQuickStart = () => {
    clearProgramContext();
    const firstWorkout = visibleWorkouts.find((workout) => isPresetWorkout(workout)) ?? visibleWorkouts[0];
    if (firstWorkout) {
      setSelectedWorkoutId(firstWorkout.id);
      setSelectedExerciseId(firstWorkout.exercises[0]?.id ?? null);
    }
    setActivePage("workouts");
    setWorkoutFilter("presets");
    closeQuickStart();
  };

  const startFromQuickStart = () => {
    clearProgramContext();
    if (selectedWorkout && selectedExercise) {
      setActivePage("train");
      startRun(selectedExercise, selectedWorkout.id);
    }
    closeQuickStart();
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
    const durationMs = getSegmentDurationMs(phases[0].seconds);
    const restSeconds = getExerciseRestSeconds(exercise, runPreferences.restSeconds);
    const restMs = Math.max(0, Math.round(restSeconds * 1000));
    const countdownMs = Math.max(1000, Math.round(runPreferences.countdownSeconds * 1000));
    setRun({
      workoutId,
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      setType: getExerciseSetType(exercise),
      targetLabel: getExerciseTargetLabel(exercise),
      phases,
      setsTotal,
      repsPerSet,
      totalReps,
      setsLogged: 0,
      repIndex: 1,
      phaseIndex: 0,
      mode: "work",
      segmentEndsAt: now + durationMs,
      segmentDurationMs: durationMs,
      remainingMs: durationMs,
      restMs,
      autoStartNextSet: runPreferences.autoStartNextSet,
      countdownMs,
      isPaused: false,
      completed: false
    });
    markTrainHintSeen("startTimer");
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
        segmentEndsAt: prev.segmentEndsAt + pausedFor
      };
    });
  };

  const skipRest = () => {
    setRun((prev) => {
      if (!prev || prev.completed || prev.mode !== "rest") {
        return prev;
      }
      const now = performance.now();
      const durationMs = getSegmentDurationMs(prev.phases[0]?.seconds ?? 0);
      return {
        ...prev,
        mode: "work",
        phaseIndex: 0,
        segmentEndsAt: now + durationMs,
        segmentDurationMs: durationMs,
        remainingMs: durationMs
      };
    });
  };

  const startNextSet = () => {
    setRun((prev) => {
      if (!prev || prev.completed || prev.mode !== "ready") {
        return prev;
      }
      const now = performance.now();
      const durationMs = getSegmentDurationMs(prev.phases[0]?.seconds ?? 0);
      return {
        ...prev,
        mode: "work",
        phaseIndex: 0,
        isPaused: false,
        pausedAt: undefined,
        segmentEndsAt: now + durationMs,
        segmentDurationMs: durationMs,
        remainingMs: durationMs
      };
    });
  };

  const adjustRestTimer = (deltaSeconds: number) => {
    setRun((prev) => {
      if (!prev || prev.completed || prev.mode !== "rest") {
        return prev;
      }
      const now = performance.now();
      const remaining = Math.max(0, prev.segmentEndsAt - now);
      const nextRemaining = clamp(
        Math.round(remaining + deltaSeconds * 1000),
        0,
        15 * 60 * 1000
      );
      return {
        ...prev,
        segmentEndsAt: now + nextRemaining,
        segmentDurationMs: Math.max(prev.segmentDurationMs, nextRemaining),
        remainingMs: nextRemaining
      };
    });
  };

  const updateProgramDay = (
    dayId: string,
    update: (day: ProgramTemplateDay) => ProgramTemplateDay
  ) => {
    setProgramPlans((prev) =>
      prev.map((plan) => {
        if (plan.id !== (activeProgram?.id ?? "")) {
          return plan;
        }
        return {
          ...plan,
          days: plan.days
            .map((day) => (day.id === dayId ? update(day) : day))
            .sort((a, b) => a.dayIndex - b.dayIndex)
        };
      })
    );
  };

  const assignSelectedWorkoutToProgramDay = () => {
    if (!selectedWorkout || !workoutProgramDay) {
      return;
    }
    updateProgramDay(workoutProgramDay.id, (day) => ({
      ...day,
      workoutId: selectedWorkout.id
    }));
  };

  const createWorkoutForProgramDay = () => {
    const newWorkout = makeWorkout(
      workoutProgramDay ? `${workoutProgramDay.name} Workout` : `Workout ${workouts.length + 1}`
    );
    setWorkouts((prev) => [...prev, newWorkout]);
    setSelectedWorkoutId(newWorkout.id);
    setSelectedExerciseId(newWorkout.exercises[0]?.id ?? null);
    if (workoutProgramDay) {
      updateProgramDay(workoutProgramDay.id, (day) => ({
        ...day,
        workoutId: newWorkout.id
      }));
    }
    setMainViewMode("edit");
    setActivePage("train");
  };

  const setProgramDayCompletion = (
    dayId: string,
    completed: boolean,
    programId = activeProgram?.id ?? "program-default"
  ) => {
    const completionKey = makeProgramDayCompletionKey(programId, dayId);
    setProgramCompletion((prev) => {
      const week = prev[currentWeekKey] ?? {};
      return {
        ...prev,
        [currentWeekKey]: {
          ...week,
          [completionKey]: completed
        }
      };
    });
    recordProgramDayCompletionLog(dayId, completed, programId);
  };

  const resetCurrentWeekProgramCompletion = () => {
    const prefix = `${activeProgram?.id ?? "program-default"}::`;
    setProgramCompletion((prev) => {
      if (!prev[currentWeekKey]) {
        return prev;
      }
      const currentWeek = prev[currentWeekKey];
      const filteredEntries = Object.entries(currentWeek).filter(([key]) => !key.startsWith(prefix));
      if (filteredEntries.length === Object.keys(currentWeek).length) {
        return prev;
      }
      const next = { ...prev };
      if (filteredEntries.length === 0) {
        delete next[currentWeekKey];
      } else {
        next[currentWeekKey] = Object.fromEntries(filteredEntries);
      }
      return next;
    });
  };

  const updateSkillBlock = (blockId: string, update: (block: SkillBlock) => SkillBlock) => {
    setSkillBlocks((prev) => prev.map((block) => (block.id === blockId ? update(block) : block)));
  };

  const getSkillRoundSeconds = (block: SkillBlock): number => {
    const levelSeconds = block.levels[block.levelIndex]?.seconds ?? block.roundSeconds;
    return Math.max(5, Math.round(levelSeconds));
  };

  const startSkillSession = (block: SkillBlock) => {
    const roundSeconds = getSkillRoundSeconds(block);
    const roundDurationMs = Math.max(5000, roundSeconds * 1000);
    const now = performance.now();
    setSkillSession({
      blockId: block.id,
      round: 1,
      totalRounds: Math.max(1, block.rounds),
      endsAt: now + roundDurationMs,
      remainingMs: roundDurationMs,
      roundDurationMs,
      completed: false
    });
  };

  const stopSkillSession = () => {
    setSkillSession(null);
  };

  const updateRecoveryInputs = (sleepHours: number, soreness: number, stress: number) => {
    setRecoveryCheck(evaluateRecovery(sleepHours, soreness, stress));
  };

  const handlePwaReadyTap = () => {
    if (!canRevealHiddenWorkouts) {
      setPwaTapCount(0);
      setShowHiddenWorkouts(false);
      return;
    }
    setPwaTapCount((prev) => {
      const next = prev + 1;
      if (next >= 20) {
        setShowHiddenWorkouts((current) => !current);
        return 0;
      }
      return next;
    });
  };

  useEffect(() => {
    if (!skillSession || skillSession.completed) {
      return;
    }
    const timer = window.setInterval(() => {
      setSkillSession((prev) => {
        if (!prev || prev.completed) {
          return prev;
        }
        const now = performance.now();
        const remaining = prev.endsAt - now;
        if (remaining > 0) {
          return {
            ...prev,
            remainingMs: remaining
          };
        }
        if (prev.round >= prev.totalRounds) {
          return {
            ...prev,
            completed: true,
            remainingMs: 0
          };
        }
        return {
          ...prev,
          round: prev.round + 1,
          endsAt: now + prev.roundDurationMs,
          remainingMs: prev.roundDurationMs
        };
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [skillSession?.blockId, skillSession?.completed, skillSession?.round, skillSession?.totalRounds]);

  useEffect(() => {
    if (!skillSession || !skillSession.completed || skillSession.rewardApplied) {
      return;
    }
    const completedBlock = skillBlocks.find((block) => block.id === skillSession.blockId);
    if (!completedBlock) {
      setSkillSession((prev) => (prev ? { ...prev, rewardApplied: true } : prev));
      return;
    }
    const totalSeconds = getSkillRoundSeconds(completedBlock) * Math.max(1, completedBlock.rounds);
    updateSkillBlock(completedBlock.id, (block) => ({
      ...block,
      sessionsCompleted: block.sessionsCompleted + 1,
      personalBestSeconds: Math.max(block.personalBestSeconds, totalSeconds)
    }));
    setSkillSession((prev) => (prev ? { ...prev, rewardApplied: true } : prev));
  }, [skillBlocks, skillSession]);

  useEffect(() => {
    if (!run || run.completed || run.isPaused || run.mode === "ready") {
      return;
    }
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        return;
      }
      setRun((prev) =>
        prev && !prev.completed && !prev.isPaused && prev.mode !== "ready"
          ? {
              ...prev,
              isPaused: true,
              pausedAt: performance.now()
            }
          : prev
      );
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [run?.completed, run?.isPaused, run?.mode]);

  const phaseColor = run
    ? run.mode === "work"
      ? run.phases[run.phaseIndex]?.color ?? "#0f1116"
      : run.mode === "rest"
        ? RUN_REST_COLOR
        : run.mode === "countdown"
          ? RUN_COUNTDOWN_COLOR
          : RUN_READY_COLOR
    : "#0f1116";
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
  const runStatus = run
    ? run.isPaused
      ? "Paused"
      : run.completed
        ? "Complete"
        : run.mode === "rest"
          ? "Rest"
          : run.mode === "countdown"
            ? "Countdown"
            : run.mode === "ready"
              ? "Ready"
              : "Live"
    : "";
  const runTimeLabel = run
    ? run.completed
      ? "Done"
      : run.mode === "ready"
        ? "Ready"
        : run.mode === "countdown"
          ? `${Math.max(1, Math.ceil(run.remainingMs / 1000))}`
          : formatRemaining(run.remainingMs)
    : "";
  const runPhaseLabel = run
    ? run.mode === "work"
      ? run.phases[run.phaseIndex]?.label ?? "Phase"
      : run.mode === "rest"
        ? "Recover"
        : run.mode === "countdown"
          ? `Set ${runCurrentSet} starts in`
          : "Rest complete"
    : "";
  const runSetMeta = run
    ? run.setType === "reps" || run.setType === "per_leg"
      ? `Set ${runCurrentSet} / ${run.setsTotal} | Rep ${runRepInSet} / ${run.repsPerSet}`
      : `Set ${runCurrentSet} / ${run.setsTotal} | ${run.targetLabel}`
    : "";
  const runSegmentProgress = run
    ? run.completed || run.mode === "ready"
      ? 100
      : run.segmentDurationMs <= 0
        ? 100
        : clamp(((run.segmentDurationMs - run.remainingMs) / run.segmentDurationMs) * 100, 0, 100)
    : 0;

  const selectWorkout = (workout: Workout) => {
    setSelectedWorkoutId(workout.id);
    setSelectedExerciseId(workout.exercises[0]?.id ?? null);
  };

  const openProgramDay = (programId: string, dayId: string) => {
    const plan = programPlans.find((item) => item.id === programId);
    const day = plan?.days.find((item) => item.id === dayId);
    if (!plan || !day) {
      return;
    }
    setActiveProgramId(programId);
    setProgramSession({ programId, dayId });
    setProgramOnlyWorkouts(true);
    setShowProgramDayDoneModal(false);
    setActivePage("train");
    setMainViewMode("train");
    const workout = resolveProgramDayWorkout(plan, day);
    if (!workout) {
      setSelectedWorkoutId(null);
      setSelectedExerciseId(null);
      return;
    }
    if (day.workoutId !== workout.id) {
      setProgramPlans((prev) =>
        prev.map((item) =>
          item.id === programId
            ? {
                ...item,
                days: item.days.map((currentDay) =>
                  currentDay.id === dayId ? { ...currentDay, workoutId: workout.id } : currentDay
                )
              }
            : item
        )
      );
    }
    selectWorkout(workout);
  };

  const moveToNextProgramDay = (markCompleteCurrent: boolean) => {
    if (!programSessionPlan || !programSessionDay) {
      return;
    }
    if (markCompleteCurrent) {
      setProgramDayCompletion(programSessionDay.id, true, programSessionPlan.id);
    }
    const orderedDays = [...programSessionPlan.days].sort((a, b) => a.dayIndex - b.dayIndex);
    const currentIndex = orderedDays.findIndex((day) => day.id === programSessionDay.id);
    const nextDay =
      currentIndex >= 0 ? orderedDays[(currentIndex + 1) % orderedDays.length] : orderedDays[0];
    if (!nextDay) {
      return;
    }
    openProgramDay(programSessionPlan.id, nextDay.id);
  };

  const goBackToProgram = () => {
    clearProgramContext();
    setActivePage("program");
  };

  const unlockProgramEditing = () => {
    clearProgramContext();
    setMainViewMode("edit");
    setActivePage("train");
  };

  const toggleFavoriteWorkout = (workoutId: string) => {
    setFavoriteWorkoutIds((prev) =>
      prev.includes(workoutId) ? prev.filter((id) => id !== workoutId) : [workoutId, ...prev].slice(0, 12)
    );
  };

  const isWorkoutFavorite = (workoutId: string): boolean => {
    return favoriteWorkoutIds.includes(workoutId);
  };

  const hasSelectedWorkoutProgress = selectedWorkout ? Boolean(progress[selectedWorkout.id]) : false;
  const runRingStyle: CSSProperties = {
    background: `conic-gradient(rgba(229, 9, 20, 0.86) ${runSegmentProgress}%, rgba(44, 44, 46, 0.45) ${runSegmentProgress}% 100%)`
  };
  const showNextSetHint =
    run && !run.completed && (run.mode === "rest" || run.mode === "countdown" || run.mode === "ready");

  const clearProgramContext = () => {
    setProgramSession(null);
    setProgramOnlyWorkouts(false);
    setShowProgramDayDoneModal(false);
    setLastProgramRunPromptKey("");
  };

  const handlePageChange = (page: AppPage) => {
    clearProgramContext();
    setActivePage(page);
  };

  const handleWorkoutFilterChange = (filter: WorkoutFilter) => {
    if (isProgramContextActive) {
      clearProgramContext();
    } else {
      setProgramOnlyWorkouts(false);
    }
    setWorkoutFilter(filter);
  };

  const renderWorkoutEntry = (workout: Workout) => {
    const workoutProgress = getWorkoutProgressView(progress, workout);
    const isActive = workout.id === selectedWorkout?.id;
    const isFavorite = isWorkoutFavorite(workout.id);
    return (
      <div key={workout.id} className={`workout-entry ${isActive ? "active" : ""}`}>
        <button className="workout-select" type="button" onClick={() => selectWorkout(workout)}>
          <span className="list-title">{workout.name}</span>
          {isActive ? (
            <>
              <span className="list-meta">{workout.exercises.length} exercises</span>
              <span className="list-meta">
                {workoutProgress.setsDone}/{workoutProgress.setsTarget} sets
              </span>
              <div className="mini-progress">
                <div style={{ width: `${workoutProgress.percent}%` }} />
              </div>
            </>
          ) : (
            <span className="list-meta">{workout.exercises.length} exercises</span>
          )}
        </button>
        <button
          className={`workout-favorite ${isFavorite ? "active" : ""}`}
          type="button"
          onClick={() => toggleFavoriteWorkout(workout.id)}
          title={isFavorite ? "Remove from favorites" : "Add to favorites"}
          aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
        >
          Fav
        </button>
      </div>
    );
  };

  if (!currentUser) {
    const noUsersYet = authUserCount === 0;
    return (
      <div className="auth-shell">
        <section className="panel auth-card">
          <div className="brand-row">
            <div className="brand">TempoColor</div>
            <span className="app-version">v{APP_VERSION}</span>
          </div>
          <div className="subtitle">
            {authMode === "login" ? "Log in to load your workouts." : "Create an account to start training."}
          </div>
          <form className="auth-form" onSubmit={(event) => void handleAuthSubmit(event)}>
            <div className="field">
              <label>Username</label>
              <input
                className="input"
                type="text"
                autoComplete="username"
                value={authUsernameInput}
                onChange={(event) => setAuthUsernameInput(event.target.value)}
                placeholder="e.g. youssef"
                disabled={isAuthPending}
              />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                className="input"
                type="password"
                autoComplete={authMode === "login" ? "current-password" : "new-password"}
                value={authPasswordInput}
                onChange={(event) => setAuthPasswordInput(event.target.value)}
                placeholder="At least 6 characters"
                disabled={isAuthPending}
              />
            </div>
            {authError ? <div className="error">{authError}</div> : null}
            <div className="auth-actions">
              <button className="btn primary" type="submit" disabled={isAuthPending}>
                {isAuthPending ? "Please wait..." : authMode === "login" ? "Log In" : "Create Account"}
              </button>
              <button
                className="btn ghost"
                type="button"
                disabled={isAuthPending || noUsersYet}
                onClick={() => handleAuthModeChange(authMode === "login" ? "register" : "login")}
              >
                {authMode === "login" ? "Need an account?" : "Have an account?"}
              </button>
            </div>
          </form>
          <div className="list-meta auth-note">
            MySQL-backed auth. Your account and workouts are stored in the gymify database.
          </div>
        </section>
      </div>
    );
  }

  if (!isUserDataReady) {
    return (
      <div className="auth-shell">
        <section className="panel auth-card">
          <div className="brand-row">
            <div className="brand">TempoColor</div>
            <span className="app-version">v{APP_VERSION}</span>
          </div>
          <div className="subtitle">Loading {currentUserLabel}...</div>
        </section>
      </div>
    );
  }

  return (
    <div className="app">
      <header className={`header ${isHeaderCompact ? "compact" : ""}`}>
        <div className="header-main">
          <div className="brand-row">
            <div className="brand">TempoColor</div>
            <span className="app-version">v{APP_VERSION}</span>
          </div>
          <div className="subtitle">Color-timed tempo training with saved presets.</div>
        </div>
        <div className="header-actions">
          <nav className="page-tabs" aria-label="App sections">
            {APP_PAGE_ITEMS.map((item) => (
              <button
                key={item.id}
                className={`page-tab ${activePage === item.id ? "active" : ""}`}
                type="button"
                onClick={() => handlePageChange(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <span className="pill subtle user-pill">{currentUserLabel}</span>
          <button
            className={`pill pill-button header-pwa ${showHiddenWorkouts ? "active-secret" : ""}`}
            type="button"
            onClick={handlePwaReadyTap}
            title={
              canRevealHiddenWorkouts
                ? showHiddenWorkouts
                  ? "Hidden workouts visible"
                  : "Tap 20 times to reveal hidden workouts"
                : "PWA-ready"
            }
          >
            {canRevealHiddenWorkouts && showHiddenWorkouts ? "PWA-ready | Hidden On" : "PWA-ready"}
          </button>
          {activePage === "train" ? (
            <div className="mode-switch" role="tablist" aria-label="Main view mode">
              <button
                className={`btn ghost small ${mainViewMode === "train" ? "mode-active" : ""}`}
                type="button"
                role="tab"
                aria-selected={mainViewMode === "train"}
                onClick={() => setMainViewMode("train")}
              >
                Train
              </button>
              <button
                className={`btn ghost small ${mainViewMode === "edit" ? "mode-active" : ""}`}
                type="button"
                role="tab"
                aria-selected={mainViewMode === "edit"}
                onClick={() => setMainViewMode("edit")}
              >
                Edit
              </button>
            </div>
          ) : null}
          {activePage === "train" ? (
            <button
              className="btn primary small"
              type="button"
              disabled={!selectedExercise || !selectedWorkout}
              onClick={() => selectedExercise && selectedWorkout && startRun(selectedExercise, selectedWorkout.id)}
            >
              {isProgramContextActive ? "Start Session" : "Start"}
            </button>
          ) : null}
          <button className="btn ghost small" type="button" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      {activePage === "train" ? (
        <>
      <aside className="sidebar">
        <section className="panel">
          <div className="panel-title">
            <h2>Current Workout</h2>
            <button className="btn ghost small" type="button" onClick={() => handlePageChange("workouts")}>
              Change
            </button>
          </div>
          {isProgramContextActive ? (
              <div className="program-context-strip">
                <div className="list-meta">
                  {programSessionPlan?.name} &gt; {programSessionDay?.name}
                </div>
              </div>
            ) : null}
          {selectedWorkout ? (
            <div className="workout-entry active workout-summary-card">
              <div className="workout-select">
                <span className="list-title">{selectedWorkout.name}</span>
                <span className="list-meta">{selectedWorkout.exercises.length} exercises</span>
                <span className="list-meta">
                  {selectedWorkoutProgress?.setsDone ?? 0}/{selectedWorkoutProgress?.setsTarget ?? 0} sets
                </span>
                <div className="mini-progress">
                  <div style={{ width: `${selectedWorkoutProgress?.percent ?? 0}%` }} />
                </div>
              </div>
            </div>
          ) : (
            <div className="empty">Pick or create a workout from the Workouts tab.</div>
          )}
        </section>

        <section className="panel">
          <div className="panel-title">
            <h2>Exercises</h2>
            {!isProgramContextActive || !programOnlyWorkouts ? (
              <button className="btn ghost small" type="button" onClick={addExercise}>
                + Exercise
              </button>
            ) : null}
          </div>
          <div className="list">
            {selectedWorkout?.exercises.map((exercise) => {
              const exerciseProgress = getExerciseProgressView(progress, selectedWorkout.id, exercise);
              const exerciseRestLabel = getExerciseRestLabel(exercise, runPreferences.restSeconds);
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
                    <span className="list-meta">
                      {exercise.weight ? `${exercise.weight} | ` : ""}
                      {getExerciseTargetLabel(exercise)} | Rest {exerciseRestLabel}
                    </span>
                    <span className="list-meta">
                      {SET_TYPE_LABELS[getExerciseSetType(exercise)]} | RIR cap {getExerciseEffortCap(exercise)}
                    </span>
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
            <h2>
              {isProgramContextActive ? "Program Session" : mainViewMode === "train" ? "Train" : "Editor"}
            </h2>
            <span className="pill subtle">
              {isProgramContextActive
                ? "Day Focus"
                : mainViewMode === "train"
                  ? "Fast Flow"
                  : "Editing"}
            </span>
          </div>
          {isProgramContextActive ? (
            <div className="program-session-card">
              <div className="program-session-breadcrumb">
                Program &gt; {programSessionPlan?.name} &gt; {programSessionDay?.name}
              </div>
              <div className="program-session-workout">
                {programSessionWorkout?.name ?? "No workout assigned to this day yet."}
              </div>
              <div className="list-meta">
                {isProgramSessionDayCompleted ? "Day marked complete for this week." : "Day not completed yet."}
              </div>
              <div className="panel-actions">
                <button
                  className="btn primary small"
                  type="button"
                  disabled={!programSessionWorkout || !programSessionWorkout.exercises[0]}
                  onClick={() => {
                    if (!programSessionWorkout || !programSessionWorkout.exercises[0]) {
                      return;
                    }
                    selectWorkout(programSessionWorkout);
                    setSelectedExerciseId(programSessionWorkout.exercises[0].id);
                    startRun(programSessionWorkout.exercises[0], programSessionWorkout.id);
                  }}
                >
                  Start Day
                </button>
                <button
                  className="btn ghost small"
                  type="button"
                  onClick={() =>
                    programSessionDay &&
                    setProgramDayCompletion(
                      programSessionDay.id,
                      !isProgramSessionDayCompleted,
                      programSessionPlan?.id ?? "program-default"
                    )
                  }
                  disabled={!programSessionDay}
                >
                  {isProgramSessionDayCompleted ? "Undo Complete" : "Mark Complete"}
                </button>
                <button
                  className="btn ghost small"
                  type="button"
                  onClick={() => moveToNextProgramDay(false)}
                  disabled={!programSessionDay}
                >
                  Skip/Move
                </button>
                <button
                  className="btn ghost small"
                  type="button"
                  onClick={() => moveToNextProgramDay(true)}
                  disabled={!programSessionDay}
                >
                  Next Day
                </button>
                <button className="btn ghost small" type="button" onClick={goBackToProgram}>
                  Back To Program
                </button>
                <button className="btn ghost small" type="button" onClick={unlockProgramEditing}>
                  Unlock Editing
                </button>
              </div>
            </div>
          ) : null}
          {!selectedWorkout ? (
            <div className="empty-wrap">
              <div className="empty">No workout yet. Create one and start training.</div>
              <button className="btn primary" type="button" onClick={addWorkout}>
                Create Starter Workout
              </button>
            </div>
          ) : !selectedExercise ? (
            <div className="empty-wrap">
              <div className="empty">This workout has no exercises yet.</div>
              <button className="btn primary" type="button" onClick={addExercise}>
                Add Exercise
              </button>
            </div>
          ) : mainViewMode === "train" ? (
            <div className="editor">
              <div className="progress-card">
                <div className="progress-header">
                  <div className="panel-subtitle progress-heading">Current Exercise</div>
                  <span className="pill subtle">{selectedWorkout.name}</span>
                </div>
                <div className="list-title">{selectedExercise.name}</div>
                <div className="progress-meta">
                  <span>
                    {selectedExercise.weight ? `${selectedExercise.weight} | ` : ""}
                    {getExerciseTargetLabel(selectedExercise)} | Rest{" "}
                    {getExerciseRestLabel(selectedExercise, runPreferences.restSeconds)}
                  </span>
                  <span>
                    {SET_TYPE_LABELS[getExerciseSetType(selectedExercise)]} | Tempo{" "}
                    {formatTempo(selectedExercise.phases)}
                  </span>
                </div>
                {selectedExercise.advice ? <div className="list-meta">{selectedExercise.advice}</div> : null}
                {selectedExercise.loadProgression ? (
                  <div className="list-meta">Load: {selectedExercise.loadProgression}</div>
                ) : null}
                {selectedExercise.repProgression ? (
                  <div className="list-meta">Reps: {selectedExercise.repProgression}</div>
                ) : null}
                <div className="list-meta">Effort cap: RIR {getExerciseEffortCap(selectedExercise)}</div>
                {!trainHints.startTimer ? (
                  <div className="hint-callout">
                    <span>Tap Start Timer to begin the live workout flow.</span>
                    <button
                      className="btn ghost tiny"
                      type="button"
                      onClick={() => markTrainHintSeen("startTimer")}
                    >
                      Got it
                    </button>
                  </div>
                ) : null}
                <div className="panel-actions">
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() => selectedWorkout && startRun(selectedExercise, selectedWorkout.id)}
                  >
                    Start Timer
                  </button>
                  <button className="btn ghost small" type="button" onClick={() => setMainViewMode("edit")}>
                    Edit Exercise
                  </button>
                </div>
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
                {!trainHints.setTracker ? (
                  <div className="hint-callout">
                    <span>Tap a set chip to log a completed set.</span>
                    <button
                      className="btn ghost tiny"
                      type="button"
                      onClick={() => markTrainHintSeen("setTracker")}
                    >
                      Got it
                    </button>
                  </div>
                ) : null}
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
                    className="btn ghost small"
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

              <div className="progress-card">
                <div className="progress-header">
                  <div className="panel-subtitle progress-heading">Weight Progress</div>
                  <div className={`list-meta sync-${databaseSyncState.status}`}>
                    {databaseSyncState.message}
                  </div>
                </div>
                <div className="run-settings-grid">
                  <div className="field">
                    <label>Weight (kg)</label>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      step={0.5}
                      value={weightDraft}
                      onChange={(event) => setWeightDraft(event.target.value)}
                      placeholder="e.g. 42.5"
                    />
                  </div>
                  <div className="field">
                    <label>Sets</label>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      step={1}
                      value={weightSetsDraft}
                      onChange={(event) => setWeightSetsDraft(event.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>Reps</label>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      step={1}
                      value={weightRepsDraft}
                      onChange={(event) => setWeightRepsDraft(event.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>RIR</label>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      max={10}
                      step={1}
                      value={weightRirDraft}
                      onChange={(event) => setWeightRirDraft(event.target.value)}
                    />
                  </div>
                </div>
                <div className="field">
                  <label>Note</label>
                  <input
                    className="input"
                    type="text"
                    value={weightNoteDraft}
                    onChange={(event) => setWeightNoteDraft(event.target.value)}
                    placeholder="Setup, side, form, or PR note..."
                  />
                </div>
                <div className="panel-actions">
                  <button className="btn primary small" type="button" onClick={logWeightProgress}>
                    Log Weight
                  </button>
                </div>
                <div className="panel-subtitle">Recent Logs</div>
                {selectedExerciseWeightLogs.length > 0 ? (
                  <div className="list">
                    {selectedExerciseWeightLogs.slice(0, 5).map((log) => (
                      <div key={log.id} className="exercise-row">
                        <div className="exercise-main">
                          <span>
                            {log.weightKg} kg | {log.setsLogged} {log.setsLogged === 1 ? "set" : "sets"} x{" "}
                            {log.reps}
                            {log.rir !== null ? ` | RIR ${log.rir}` : ""}
                          </span>
                          <span className="list-meta">
                            {new Date(log.loggedAt).toLocaleDateString()} |{" "}
                            {log.setsLogged > 1
                              ? `Sets ${log.setIndex}-${log.setIndex + log.setsLogged - 1}`
                              : `Set ${log.setIndex}`}
                          </span>
                          {log.note ? <span className="list-meta">{log.note}</span> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty">No weight logs yet for this exercise.</div>
                )}
              </div>
            </div>
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
                <label>Advice</label>
                <textarea
                  className="input advice-input"
                  value={selectedExercise.advice ?? ""}
                  onChange={(event) =>
                    updateExercise(selectedExercise.id, (exercise) => ({
                      ...exercise,
                      advice: event.target.value
                    }))
                  }
                  placeholder="Form cue, breathing reminder, setup tip..."
                />
              </div>
              <div className="field">
                <label>Weight</label>
                <input
                  className="input"
                  type="text"
                  value={selectedExercise.weight ?? ""}
                  onChange={(event) =>
                    updateExercise(selectedExercise.id, (exercise) => ({
                      ...exercise,
                      weight: event.target.value
                    }))
                  }
                  placeholder="e.g. 35-40 kg"
                />
              </div>
              <div className="field">
                <label>Target Rep Range</label>
                <input
                  className="input"
                  type="text"
                  value={selectedExercise.repRange ?? `${selectedExercise.reps}`}
                  onChange={(event) =>
                    updateExercise(selectedExercise.id, (exercise) => ({
                      ...exercise,
                      repRange: event.target.value
                    }))
                  }
                  placeholder="e.g. 10-12"
                />
              </div>
              <div className="field">
                <label>Progression Rule</label>
                <textarea
                  className="input advice-input"
                  value={selectedExercise.progression ?? ""}
                  onChange={(event) =>
                    updateExercise(selectedExercise.id, (exercise) => ({
                      ...exercise,
                      progression: event.target.value
                    }))
                  }
                  placeholder="When to increase load, when to deload..."
                />
              </div>
              <div className="field">
                <label>Load Progression</label>
                <textarea
                  className="input advice-input"
                  value={selectedExercise.loadProgression ?? ""}
                  onChange={(event) =>
                    updateExercise(selectedExercise.id, (exercise) => ({
                      ...exercise,
                      loadProgression: event.target.value
                    }))
                  }
                  placeholder="Example: add 2.5 kg when top reps are reached in all sets."
                />
              </div>
              <div className="field">
                <label>Rep Progression</label>
                <textarea
                  className="input advice-input"
                  value={selectedExercise.repProgression ?? ""}
                  onChange={(event) =>
                    updateExercise(selectedExercise.id, (exercise) => ({
                      ...exercise,
                      repProgression: event.target.value
                    }))
                  }
                  placeholder="Example: add 1 rep each session until top of range, then increase load."
                />
              </div>
              <div className="field">
                <label>Effort Cap (RIR)</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={5}
                  step={1}
                  value={getExerciseEffortCap(selectedExercise)}
                  onChange={(event) =>
                    updateExercise(selectedExercise.id, (exercise) => ({
                      ...exercise,
                      effortCapRir: clamp(Math.round(Number(event.target.value) || 0), 0, 5)
                    }))
                  }
                />
              </div>
              <div className="field">
                <label>Set Type</label>
                <select
                  className="input"
                  value={getExerciseSetType(selectedExercise)}
                  onChange={(event) =>
                    updateExercise(selectedExercise.id, (exercise) => ({
                      ...exercise,
                      setType: event.target.value as SetType
                    }))
                  }
                >
                  {SET_TYPE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
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
                <label>
                  {getExerciseSetType(selectedExercise) === "reps"
                    ? "Reps / Set"
                    : getExerciseSetType(selectedExercise) === "per_leg"
                      ? "Reps / Side"
                      : "Target Value"}
                </label>
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
                <label>Intent Tags</label>
                <div className="tag-grid">
                  {INTENT_TAGS.map((tag) => {
                    const isActive = normalizeIntentTags(selectedExercise.intentTags).includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        className={`tag-chip ${isActive ? "active" : ""}`}
                        onClick={() =>
                          updateExercise(selectedExercise.id, (exercise) => {
                            const currentTags = normalizeIntentTags(exercise.intentTags);
                            const nextTags = currentTags.includes(tag.id)
                              ? currentTags.filter((item) => item !== tag.id)
                              : [...currentTags, tag.id];
                            return {
                              ...exercise,
                              intentTags: nextTags
                            };
                          })
                        }
                      >
                        {tag.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="field">
                <label>Set Transitions</label>
                <div className="run-settings-grid">
                  <div className="run-setting">
                    <span className="run-setting-label">Training Goal</span>
                    <select
                      className="input"
                      value={runPreferences.goal}
                      onChange={(event) => applyGoalPreset(event.target.value as TrainingGoal)}
                    >
                      <option value="strength">Strength (90-180s rest)</option>
                      <option value="hypertrophy">Hypertrophy (60-90s rest)</option>
                      <option value="endurance">Endurance (30-60s rest)</option>
                    </select>
                  </div>
                  <div className="run-setting">
                    <span className="run-setting-label">Rest Seconds</span>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      step={5}
                      value={runPreferences.restSeconds}
                      onChange={(event) =>
                        setRunPreferences((prev) => ({
                          ...prev,
                          restSeconds: clamp(Math.round(Number(event.target.value) || 0), 0, 600)
                        }))
                      }
                    />
                  </div>
                  <div className="run-setting">
                    <label className="run-toggle">
                      <input
                        type="checkbox"
                        checked={runPreferences.autoStartNextSet}
                        onChange={(event) =>
                          setRunPreferences((prev) => ({
                            ...prev,
                            autoStartNextSet: event.target.checked
                          }))
                        }
                      />
                      Auto-start next set
                    </label>
                    <span className="run-setting-note">Default off. Manual start after rest.</span>
                  </div>
                  <div className="run-setting">
                    <span className="run-setting-label">Countdown Seconds</span>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={10}
                      step={1}
                      value={runPreferences.countdownSeconds}
                      disabled={!runPreferences.autoStartNextSet}
                      onChange={(event) =>
                        setRunPreferences((prev) => ({
                          ...prev,
                          countdownSeconds: clamp(
                            Math.round(Number(event.target.value) || DEFAULT_RUN_PREFERENCES.countdownSeconds),
                            1,
                            10
                          )
                        }))
                      }
                    />
                  </div>
                </div>
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
                {selectedExercise.phases.map((phase) => {
                  const hsl = hexToHsl(phase.color);
                  return (
                    <div key={phase.id} className="phase-row">
                      <input
                        className="input"
                        type="text"
                        value={phase.label}
                        onChange={(event) => {
                          const nextLabel = event.target.value;
                          const semanticColor = getSemanticPhaseColor(nextLabel);
                          updateExercise(selectedExercise.id, (exercise) => ({
                            ...exercise,
                            phases: exercise.phases.map((item) =>
                              item.id === phase.id
                                ? { ...item, label: nextLabel, color: semanticColor }
                                : item
                            )
                          }));
                          setHexDrafts((prev) => ({ ...prev, [phase.id]: semanticColor }));
                        }}
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
      {isProgramContextActive ? (
        <button className="btn ghost small fixed-back-program" type="button" onClick={goBackToProgram}>
          Back To Program
        </button>
      ) : null}
        </>
      ) : (
        <main className="main main-wide">
          {activePage === "workouts" ? (
            <div className="workouts-manage-grid">
              <section className="panel">
                <div className="panel-title">
                  <h2>Workouts</h2>
                  <button className="btn ghost small" type="button" onClick={addWorkout}>
                    + Workout
                  </button>
                </div>
                <div className="workout-tools">
                  <div className="filter-chips">
                    <button
                      className={`chip ${workoutFilter === "all" ? "active" : ""}`}
                      type="button"
                      onClick={() => handleWorkoutFilterChange("all")}
                    >
                      All
                    </button>
                    <button
                      className={`chip ${workoutFilter === "presets" ? "active" : ""}`}
                      type="button"
                      onClick={() => handleWorkoutFilterChange("presets")}
                    >
                      Presets
                    </button>
                    <button
                      className={`chip ${workoutFilter === "custom" ? "active" : ""}`}
                      type="button"
                      onClick={() => handleWorkoutFilterChange("custom")}
                    >
                      Custom
                    </button>
                  </div>
                  <input
                    className="input workout-search"
                    type="text"
                    value={workoutSearch}
                    onChange={(event) => setWorkoutSearch(event.target.value)}
                    placeholder="Search workouts..."
                  />
                </div>

                {favoriteWorkouts.length > 0 ? (
                  <div className="quick-group">
                    <div className="quick-label">Favorites</div>
                    <div className="quick-list">
                      {favoriteWorkouts.map((workout) => (
                        <button
                          key={`fav-${workout.id}`}
                          className="quick-pill"
                          type="button"
                          onClick={() => selectWorkout(workout)}
                        >
                          {workout.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {recentWorkouts.length > 0 ? (
                  <div className="quick-group">
                    <div className="quick-label">Recent</div>
                    <div className="quick-list">
                      {recentWorkouts.map((workout) => (
                        <button
                          key={`recent-${workout.id}`}
                          className="quick-pill"
                          type="button"
                          onClick={() => selectWorkout(workout)}
                        >
                          {workout.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {filteredWorkouts.length === 0 ? <div className="empty">No workouts match this filter.</div> : null}

                <div className="panel-subtitle">Program Workouts</div>
                {displayedProgramWorkouts.length > 0 ? (
                  <div className="list">{displayedProgramWorkouts.map((workout) => renderWorkoutEntry(workout))}</div>
                ) : (
                  <div className="empty">No program workouts match this filter.</div>
                )}

                <div className="panel-subtitle">Workout Library</div>
                {displayedLibraryWorkouts.length > 0 ? (
                  <div className="list">{displayedLibraryWorkouts.map((workout) => renderWorkoutEntry(workout))}</div>
                ) : (
                  <div className="empty">No library workouts match this filter.</div>
                )}

                {filteredWorkouts.length > 6 ? (
                  <button className="btn ghost small" type="button" onClick={() => setShowAllWorkouts((prev) => !prev)}>
                    {showAllWorkouts ? "Show less" : "Show more"}
                  </button>
                ) : null}

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
                    className="btn ghost small"
                    type="button"
                    disabled={!hasSelectedWorkoutProgress}
                    onClick={resetWorkoutProgress}
                  >
                    Reset Progress
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
                  <h2>Program Assignment</h2>
                  <span className="pill subtle">{activeProgramLabel}</span>
                </div>
                <div className="run-settings-grid">
                  <div className="field">
                    <label>Program</label>
                    <select
                      className="input"
                      value={activeProgram?.id ?? ""}
                      onChange={(event) => setActiveProgramId(event.target.value)}
                    >
                      {programPlans.map((plan) => (
                        <option key={`workout-program-${plan.id}`} value={plan.id}>
                          {plan.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Program Day</label>
                    <select
                      className="input"
                      value={workoutProgramDay?.id ?? ""}
                      onChange={(event) => setWorkoutProgramDayId(event.target.value)}
                    >
                      {programTemplate.map((day) => (
                        <option key={`workout-day-${day.id}`} value={day.id}>
                          Day {day.dayIndex} - {day.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="progress-card assignment-card">
                  <div className="list-meta">Assigned workout</div>
                  <div className="list-title">
                    {assignedWorkoutForProgramDay?.name ?? "No workout assigned"}
                  </div>
                  {selectedWorkout ? (
                    <div className="list-meta">Selected: {selectedWorkout.name}</div>
                  ) : null}
                </div>
                <div className="panel-actions">
                  <button
                    className="btn primary small"
                    type="button"
                    disabled={!selectedWorkout || !workoutProgramDay}
                    onClick={assignSelectedWorkoutToProgramDay}
                  >
                    Assign Selected
                  </button>
                  <button className="btn ghost small" type="button" onClick={createWorkoutForProgramDay}>
                    Create For Day
                  </button>
                  <button
                    className="btn ghost small"
                    type="button"
                    disabled={!assignedWorkoutForProgramDay || !activeProgram || !workoutProgramDay}
                    onClick={() =>
                      activeProgram && workoutProgramDay
                        ? openProgramDay(activeProgram.id, workoutProgramDay.id)
                        : undefined
                    }
                  >
                    Train
                  </button>
                </div>
              </section>

              <section className="panel selected-workout-panel">
                <div className="panel-title">
                  <h2>Selected Workout</h2>
                  <button
                    className="btn primary small"
                    type="button"
                    disabled={!selectedWorkout}
                    onClick={() => {
                      setMainViewMode("train");
                      setActivePage("train");
                    }}
                  >
                    Train
                  </button>
                </div>
                {selectedWorkout ? (
                  <>
                    <div className="progress-card">
                      <div className="progress-header">
                        <div>
                          <div className="list-title">{selectedWorkout.name}</div>
                          <div className="list-meta">{selectedWorkout.exercises.length} exercises</div>
                        </div>
                        <button
                          className="btn ghost small"
                          type="button"
                          onClick={() => {
                            setMainViewMode("edit");
                            setActivePage("train");
                          }}
                        >
                          Edit
                        </button>
                      </div>
                      <div className="mini-progress">
                        <div style={{ width: `${selectedWorkoutProgress?.percent ?? 0}%` }} />
                      </div>
                    </div>
                    <div className="panel-subtitle">Exercises</div>
                    <div className="list">
                      {selectedWorkout.exercises.map((exercise) => (
                        <button
                          key={`selected-workout-exercise-${exercise.id}`}
                          className={`exercise-row exercise-main ${exercise.id === selectedExercise?.id ? "active" : ""}`}
                          type="button"
                          onClick={() => setSelectedExerciseId(exercise.id)}
                        >
                          <span>{exercise.name}</span>
                          <span className="list-meta">
                            {getExerciseTargetLabel(exercise)} | Tempo {formatTempo(exercise.phases)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="empty">Select a workout from the library.</div>
                )}
              </section>
            </div>
          ) : null}

          {activePage === "dashboard" ? (
            <section className="panel dashboard-shell">
              <div className="panel-title">
                <h2>Dashboard</h2>
                <span className="pill subtle">{todayLabel}</span>
              </div>
              <div className="kpi-grid">
                <article className="kpi-card">
                  <div className="kpi-label">Weekly Program</div>
                  <div className="list-meta">{activeProgramLabel}</div>
                  <div className="kpi-value">
                    {programCompletedDays}/{programTemplate.length}
                  </div>
                  <div className="progress-bar">
                    <div style={{ width: `${programCompletionPercent}%` }} />
                  </div>
                </article>
                <article className="kpi-card">
                  <div className="kpi-label">Readiness</div>
                  <div className="kpi-value">{recoveryRecommendationLabel}</div>
                  <div className="list-meta">{recoveryCheck.note}</div>
                </article>
                <article className="kpi-card">
                  <div className="kpi-label">Today</div>
                  <div className="kpi-value">{todayProgramDay?.name ?? "No day template"}</div>
                  <div className="list-meta">
                    {todayWorkout ? todayWorkout.name : "No workout assigned"}
                  </div>
                </article>
              </div>

              <div className="panel-subtitle">Intent Coverage</div>
              <div className="intent-grid">
                {INTENT_TAGS.map((tag) => {
                  const count = weeklyIntentCoverage[tag.id];
                  return (
                    <div key={`intent-${tag.id}`} className={`intent-chip ${count > 0 ? "covered" : ""}`}>
                      <span>{tag.label}</span>
                      <strong>{count}</strong>
                    </div>
                  );
                })}
              </div>

              <div className="panel-subtitle">Quick Actions</div>
              <div className="panel-actions">
                <button
                  className="btn primary"
                  type="button"
                  disabled={!todayWorkout}
                  onClick={() => {
                    if (!activeProgram || !todayProgramDay) {
                      return;
                    }
                    openProgramDay(activeProgram.id, todayProgramDay.id);
                    if (todayWorkout?.exercises[0]) {
                      startRun(todayWorkout.exercises[0], todayWorkout.id);
                    }
                  }}
                >
                  Start Today
                </button>
                <button className="btn ghost" type="button" onClick={() => handlePageChange("program")}>
                  Edit Program
                </button>
                <button className="btn ghost" type="button" onClick={() => handlePageChange("recovery")}>
                  Recovery Check
                </button>
              </div>
            </section>
          ) : null}

          {activePage === "program" ? (
            <div className="program-mode-shell">
              <section className="program-overview">
                <div className="program-overview-main">
                  <div className="program-eyebrow">Week {currentWeekKey}</div>
                  <div className="program-title-row">
                    <h2>{activeProgramLabel}</h2>
                    <select
                      className="input program-select"
                      value={activeProgram?.id ?? ""}
                      onChange={(event) => setActiveProgramId(event.target.value)}
                    >
                      {programPlans.map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {activeProgram?.description ? (
                    <div className="program-description">{activeProgram.description}</div>
                  ) : null}
                  <div className="program-overview-actions">
                    <button
                      className="btn primary"
                      type="button"
                      disabled={!todayWorkout}
                      onClick={() => {
                        if (!activeProgram || !todayProgramDay) {
                          return;
                        }
                        openProgramDay(activeProgram.id, todayProgramDay.id);
                      }}
                    >
                      Start Today
                    </button>
                    <button className="btn ghost" type="button" onClick={resetCurrentWeekProgramCompletion}>
                      Reset Week
                    </button>
                    <button className="btn ghost" type="button" disabled={!activeProgram} onClick={exportProgram}>
                      Export JSON
                    </button>
                  </div>
                </div>
                <div className="program-today-card">
                  <span className="program-stat-label">Today</span>
                  <strong>{todayProgramDay?.name ?? "No day template"}</strong>
                  <span>{todayWorkout ? todayWorkout.name : "No workout assigned"}</span>
                  <div className="program-today-mark">{todayWorkout ? "Ready" : "Needs workout"}</div>
                </div>
              </section>

              <section className="program-stats-grid">
                <article className="program-stat-card">
                  <span className="program-stat-label">Completed</span>
                  <strong>
                    {programCompletedDays}/{programTemplate.length}
                  </strong>
                  <div className="program-progress-track">
                    <div style={{ width: `${programCompletionPercent}%` }} />
                  </div>
                </article>
                <article className="program-stat-card">
                  <span className="program-stat-label">Program Workouts</span>
                  <strong>{activeProgramWorkoutIds.size}</strong>
                  <span className="list-meta">Assigned this week</span>
                </article>
                <article className="program-stat-card">
                  <span className="program-stat-label">Next Day</span>
                  <strong>{todayProgramDay ? `Day ${todayProgramDay.dayIndex}` : "-"}</strong>
                  <span className="list-meta">{todayProgramDay?.optional ? "Optional" : "Required"}</span>
                </article>
              </section>

              <section className="program-layout">
                <div className="program-schedule-panel">
                  <div className="program-section-head">
                    <div>
                      <div className="panel-subtitle progress-heading">Schedule</div>
                      <h3>Training Week</h3>
                    </div>
                    <span className="pill subtle">{Math.round(programCompletionPercent)}% done</span>
                  </div>
                  <div className="program-card-grid">
                    {[...programTemplate]
                      .sort((a, b) => a.dayIndex - b.dayIndex)
                      .map((day) => {
                        const assignedWorkout = resolveProgramDayWorkout(activeProgram, day);
                        const assignedProgress = assignedWorkout
                          ? getWorkoutProgressView(progress, assignedWorkout)
                          : null;
                        const dayCompletionKey = makeProgramDayCompletionKey(
                          activeProgram?.id ?? "program-default",
                          day.id
                        );
                        const dayComplete = Boolean(weekCompletion[dayCompletionKey] ?? weekCompletion[day.id]);
                        const isToday = todayProgramDay?.id === day.id;
                        return (
                          <article
                            key={day.id}
                            className={`program-day-card ${dayComplete ? "done" : ""} ${isToday ? "today" : ""}`}
                          >
                            <div className="program-day-card-top">
                              <div className="program-day-badge">Day {day.dayIndex}</div>
                              <div className="program-day-status">
                                {dayComplete ? "Complete" : isToday ? "Today" : day.optional ? "Optional" : "Planned"}
                              </div>
                            </div>
                            <input
                              className="input program-day-name"
                              type="text"
                              value={day.name}
                              onChange={(event) =>
                                updateProgramDay(day.id, (current) => ({
                                  ...current,
                                  name: event.target.value
                                }))
                              }
                            />
                            <select
                              className="input"
                              value={assignedWorkout?.id ?? day.workoutId ?? ""}
                              onChange={(event) =>
                                updateProgramDay(day.id, (current) => ({
                                  ...current,
                                  workoutId: event.target.value || null
                                }))
                              }
                            >
                              <option value="">No workout</option>
                              {assignedWorkout?.hidden && !showHiddenWorkouts ? (
                                <option value={assignedWorkout.id}>{assignedWorkout.name}</option>
                              ) : null}
                              {visibleWorkouts.map((workout) => (
                                <option key={`day-${day.id}-workout-${workout.id}`} value={workout.id}>
                                  {workout.name}
                                </option>
                              ))}
                            </select>
                            {assignedProgress ? (
                              <div className="program-day-progress">
                                <span>
                                  {assignedProgress.completedExercises}/{assignedProgress.totalExercises} exercises
                                </span>
                                <div className="program-progress-track compact">
                                  <div style={{ width: `${assignedProgress.percent}%` }} />
                                </div>
                              </div>
                            ) : (
                              <div className="program-day-progress muted">No workout assigned</div>
                            )}
                            <textarea
                              className="input advice-input program-notes"
                              value={day.notes}
                              onChange={(event) =>
                                updateProgramDay(day.id, (current) => ({
                                  ...current,
                                  notes: event.target.value
                                }))
                              }
                              placeholder="Intent, cues, or substitutions..."
                            />
                            <div className="program-day-actions">
                              <label className="inline-check">
                                <input
                                  type="checkbox"
                                  checked={day.optional}
                                  onChange={(event) =>
                                    updateProgramDay(day.id, (current) => ({
                                      ...current,
                                      optional: event.target.checked
                                    }))
                                  }
                                />
                                Optional
                              </label>
                              <label className="inline-check">
                                <input
                                  type="checkbox"
                                  checked={dayComplete}
                                  onChange={(event) => setProgramDayCompletion(day.id, event.target.checked)}
                                />
                                Done
                              </label>
                            </div>
                            <button
                              className="btn primary small program-day-open"
                              type="button"
                              disabled={!assignedWorkout}
                              onClick={() =>
                                activeProgram?.id ? openProgramDay(activeProgram.id, day.id) : undefined
                              }
                            >
                              Train
                            </button>
                          </article>
                        );
                      })}
                  </div>
                </div>

                <aside className="program-history-panel">
                  <div className="program-section-head">
                    <div>
                      <div className="panel-subtitle progress-heading">History</div>
                      <h3>Recent Completion</h3>
                    </div>
                  </div>
                  {recentDayCompletionHistory.length > 0 ? (
                    <div className="list">
                      {recentDayCompletionHistory.map((log) => (
                        <div key={log.id} className="program-history-row">
                          <div className="program-history-dot" />
                          <div className="exercise-main">
                            <span>{log.dayName}</span>
                            <span className="list-meta">
                              {log.programName} | Week {log.weekKey}
                            </span>
                            <span className="list-meta">
                              {log.completed ? "Completed" : "Marked incomplete"} |{" "}
                              {new Date(log.updatedAt).toLocaleDateString()}
                              {log.workoutName ? ` | ${log.workoutName}` : ""}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty">No completed program days recorded yet.</div>
                  )}
                </aside>
              </section>
            </div>
          ) : null}

          {activePage === "skills" ? (
            <section className="panel">
              <div className="panel-title">
                <h2>Skill Block Tracker</h2>
                <span className="pill subtle">Ladders + Timed Rounds</span>
              </div>
              {skillSession ? (
                <div className={`skill-session ${skillSession.completed ? "done" : ""}`}>
                  <div className="skill-session-title">
                    {skillBlocks.find((block) => block.id === skillSession.blockId)?.name ?? "Skill Session"}
                  </div>
                  <div className="skill-session-meta">
                    Round {Math.min(skillSession.round, skillSession.totalRounds)} / {skillSession.totalRounds}
                  </div>
                  <div className="skill-session-time">
                    {skillSession.completed ? "Completed" : formatRemaining(skillSession.remainingMs)}
                  </div>
                  <div className="panel-actions">
                    <button className="btn ghost small" type="button" onClick={stopSkillSession}>
                      {skillSession.completed ? "Close" : "Stop"}
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="skill-grid">
                {skillBlocks.map((block) => {
                  const currentLevel = block.levels[block.levelIndex] ?? block.levels[0];
                  return (
                    <article key={block.id} className="skill-card">
                      <div className="skill-card-head">
                        <strong>{block.name}</strong>
                        <span className="pill subtle">{currentLevel?.label ?? "Level"}</span>
                      </div>
                      <div className="skill-meta">
                        <span>
                          {block.rounds} rounds x {getSkillRoundSeconds(block)} sec
                        </span>
                        <span>Sessions: {block.sessionsCompleted}</span>
                        <span>PB: {block.personalBestSeconds}s</span>
                      </div>
                      <div className="skill-controls">
                        <button
                          className="btn ghost tiny"
                          type="button"
                          onClick={() =>
                            updateSkillBlock(block.id, (current) => ({
                              ...current,
                              levelIndex: clamp(current.levelIndex - 1, 0, current.levels.length - 1)
                            }))
                          }
                        >
                          Level -
                        </button>
                        <button
                          className="btn ghost tiny"
                          type="button"
                          onClick={() =>
                            updateSkillBlock(block.id, (current) => ({
                              ...current,
                              levelIndex: clamp(current.levelIndex + 1, 0, current.levels.length - 1)
                            }))
                          }
                        >
                          Level +
                        </button>
                        <button className="btn primary tiny" type="button" onClick={() => startSkillSession(block)}>
                          Start
                        </button>
                      </div>
                      <div className="field">
                        <label>Rounds</label>
                        <input
                          className="input"
                          type="number"
                          min={1}
                          max={12}
                          value={block.rounds}
                          onChange={(event) =>
                            updateSkillBlock(block.id, (current) => ({
                              ...current,
                              rounds: clamp(Math.round(Number(event.target.value) || 1), 1, 12)
                            }))
                          }
                        />
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          {activePage === "recovery" ? (
            <section className="panel">
              <div className="panel-title">
                <h2>Recovery Auto-Adjust</h2>
                <span className="pill subtle">{recoveryRecommendationLabel}</span>
              </div>
              <div className="recovery-grid">
                <div className="field">
                  <label>Sleep Hours</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={12}
                    step={0.5}
                    value={recoveryCheck.sleepHours}
                    onChange={(event) =>
                      updateRecoveryInputs(
                        clamp(Number(event.target.value) || 0, 0, 12),
                        recoveryCheck.soreness,
                        recoveryCheck.stress
                      )
                    }
                  />
                </div>
                <div className="field">
                  <label>Soreness (1-10)</label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={10}
                    step={1}
                    value={recoveryCheck.soreness}
                    onChange={(event) =>
                      updateRecoveryInputs(
                        recoveryCheck.sleepHours,
                        clamp(Math.round(Number(event.target.value) || 1), 1, 10),
                        recoveryCheck.stress
                      )
                    }
                  />
                </div>
                <div className="field">
                  <label>Stress (1-10)</label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={10}
                    step={1}
                    value={recoveryCheck.stress}
                    onChange={(event) =>
                      updateRecoveryInputs(
                        recoveryCheck.sleepHours,
                        recoveryCheck.soreness,
                        clamp(Math.round(Number(event.target.value) || 1), 1, 10)
                      )
                    }
                  />
                </div>
              </div>
              <div className={`recovery-card ${recoveryCheck.recommendation}`}>
                <div className="recovery-title">{recoveryRecommendationLabel}</div>
                <div className="list-meta">{recoveryCheck.note}</div>
                <div className="panel-actions">
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() =>
                      setRunPreferences((prev) => ({
                        ...prev,
                        goal:
                          recoveryCheck.recommendation === "full"
                            ? "strength"
                            : recoveryCheck.recommendation === "moderate"
                              ? "hypertrophy"
                              : "endurance",
                        restSeconds:
                          recoveryCheck.recommendation === "full"
                            ? 120
                            : recoveryCheck.recommendation === "moderate"
                              ? 75
                              : 45
                      }))
                    }
                  >
                    Apply Rest Preset
                  </button>
                  <button className="btn ghost small" type="button" onClick={() => handlePageChange("dashboard")}>
                    Back To Dashboard
                  </button>
                </div>
              </div>
            </section>
          ) : null}
        </main>
      )}

      {isQuickStartOpen && !run && (activePage === "dashboard" || activePage === "train" || activePage === "workouts") ? (
        <div className="quick-start-overlay">
          <div className="quick-start-card">
            <div className="quick-start-title">Quick Start</div>
            <div className="quick-start-text">Start training now. You can edit details later.</div>
            <div className="quick-start-actions">
              <button
                className="btn primary"
                type="button"
                disabled={!selectedWorkout || !selectedExercise}
                onClick={startFromQuickStart}
              >
                Start Workout
              </button>
              <button className="btn ghost" type="button" onClick={choosePresetFromQuickStart}>
                Choose Preset
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showProgramDayDoneModal && isProgramContextActive ? (
        <div className="program-day-modal-overlay">
          <div className="program-day-modal-card">
            <div className="quick-start-title">Day Session Finished</div>
            <div className="quick-start-text">
              {programSessionPlan?.name} - {programSessionDay?.name}
            </div>
            <div className="quick-start-actions">
              <button
                className="btn primary"
                type="button"
                onClick={() => {
                  if (programSessionDay && programSessionPlan) {
                    setProgramDayCompletion(programSessionDay.id, true, programSessionPlan.id);
                  }
                  setShowProgramDayDoneModal(false);
                  stopRun();
                }}
              >
                Complete Day
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={() => {
                  setShowProgramDayDoneModal(false);
                  stopRun();
                  moveToNextProgramDay(true);
                }}
              >
                Complete + Next Day
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={() => setShowProgramDayDoneModal(false)}
              >
                Later
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {run ? (
        <div className="run-overlay" style={{ backgroundColor: phaseColor, color: runTextColor }}>
          <div className="run-top">
            <div>
              <div className="run-title">{run.exerciseName}</div>
              <div className="run-meta">{runSetMeta}</div>
            </div>
            <div className="run-status">{runStatus}</div>
          </div>

          <div className="run-center">
            <div className="run-ring" style={runRingStyle}>
              <div className="run-ring-inner">
                <div className="run-time">{runTimeLabel}</div>
                <div className="run-phase">{runPhaseLabel}</div>
              </div>
            </div>
            {showNextSetHint ? (
              <div className="run-next-set">
                Next: Set {runCurrentSet} / {run.setsTotal} | {run.targetLabel}
              </div>
            ) : null}
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
            ) : run.mode === "ready" ? (
              <button className="btn primary" type="button" onClick={startNextSet}>
                Start Next Set
              </button>
            ) : run.mode === "rest" ? (
              <button className="btn primary" type="button" onClick={skipRest}>
                Skip Rest
              </button>
            ) : (
              <button className="btn primary" type="button" onClick={pauseRun}>
                Pause
              </button>
            )}
            {!run.completed && !run.isPaused && run.mode === "rest" ? (
              <>
                <button className="btn ghost" type="button" onClick={() => adjustRestTimer(-15)}>
                  -15s
                </button>
                <button className="btn ghost" type="button" onClick={() => adjustRestTimer(15)}>
                  +15s
                </button>
                <button className="btn ghost" type="button" onClick={pauseRun}>
                  Pause
                </button>
              </>
            ) : null}
            {!run.completed ? (
              <button className="btn ghost" type="button" onClick={stopRun}>
                End Workout
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
