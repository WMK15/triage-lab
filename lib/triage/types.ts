export type Severity = "low" | "moderate" | "high" | "critical";

export type EnvironmentType =
  | "planning"
  | "clinical"
  | "compliance"
  | "incident"
  | "general";

export type ThinkingStep = {
  id: string;
  label: string;
  detail: string;
};

export type Decision = {
  headline: string;
  rationale: string;
  severity: Severity;
  ktasLevel?: KtasLevel | null;
  caseProgress: number; // 0-100
};

export type Action = {
  id: string;
  label: string;
  description?: string;
  intent?: "default" | "constructive" | "escalation";
};

export type EvaluationAssignment = {
  patient_id: string;
  agent_level: number;
  truth_level: number | null;
  reward: number | null;
  order: number;
  scored: boolean;
  source: "dataset" | "manual";
  chief_complaint?: string;
};

export type EvaluationSummary = {
  scored_count: number;
  exact_matches: number;
  over_triage: number;
  under_triage: number;
  exact_rate: number;
  mistriage_rate: number;
  under_triage_rate: number;
  off_by_one_count: number;
  off_by_two_or_more_count: number;
  confusion: Record<string, Record<string, number>>;
};

export type EvaluationDetails = {
  compositeScore: number | null;
  baseReward: number | null;
  orderingBonus: number | null;
  scoredCount: number;
  manualCount: number;
  assignments: EvaluationAssignment[];
  summary: EvaluationSummary | null;
};

export type LiveTaskOption = {
  id: string;
  name: string;
  label: string;
  hint: string;
  narrativeRole: string;
  presentingComplaint: string;
  expectedDisposition: string;
};

export type IntakeSuggestion = {
  taskId: string;
  caseLabel: string;
  complaint: string;
  diagnosis: string;
  disposition: string;
  score: number;
};

export type AssessResponse =
  | {
      kind: "question";
      question: string;
      summary: string;
      matchedCase: IntakeSuggestion | null;
      thinking: ThinkingStep[];
    }
  | {
      kind: "decision";
      decision: Decision;
      actions: Action[];
      acknowledgement: string;
      matchedCase: IntakeSuggestion | null;
      thinking: ThinkingStep[];
    };

export type ChatAssessRequest = {
  mode: "chat";
  text: string;
};

// ---- v3: multi-mode input ----------------------------------------------

export type RunMode = "test" | "manual-single" | "manual-multi";

export type KtasLevel = 1 | 2 | 3 | 4 | 5;

export type MentalState = "alert" | "verbal" | "pain" | "unresponsive";

/** A user-entered patient. Free text required; everything else optional.
 * If fields are filled in, they take precedence over what regex extracts
 * from `chiefComplaint`. */
export type ManualPatient = {
  chiefComplaint: string;
  age?: number | null;
  sex?: "M" | "F" | null;
  vitals?: {
    hr?: number | null;
    sbp?: number | null;
    dbp?: number | null;
    rr?: number | null;
    spo2?: number | null;
    tempC?: number | null;
  } | null;
  mentalState?: MentalState | null;
  nrsPain?: number | null;
  expectedKtas?: KtasLevel | null; // when set, becomes ground truth → scored
};

/** A patient as shown in the pre-run preview pane — what the env will load. */
export type PatientPreview = {
  id: string;
  age: number;
  sex: "M" | "F";
  chief_complaint: string;
  mental_state: MentalState;
  nrs_pain: number | null;
  vitals: {
    hr: number;
    sbp: number;
    dbp: number;
    rr: number;
    spo2: number;
    temp_c: number;
  };
  ground_truth_ktas: KtasLevel | null;
};

export type TriageClassification = {
  patientId: string;
  chiefComplaint?: string;
  source: "dataset" | "manual";
  agentLevel: KtasLevel;
  truthLevel: KtasLevel | null;
  reward: number | null;
  scored: boolean;
  order?: number;
};

export type RunRequest =
  | {
      mode: "test";
      taskId: string;
      batchSize: number;
      extraPatient?: string; // Option C: optional intake-note patient (unscored)
      savedResponses?: boolean;
    }
  | {
      mode: "manual-single";
      patient: ManualPatient;
    }
  | {
      mode: "manual-multi";
      patients: ManualPatient[];
    };

export type UserMessage = {
  id: string;
  role: "user";
  scenario: string;
  environment: EnvironmentType;
  taskId?: string;
  taskLabel?: string;
  createdAt: number;
};

export type AgentMessage = {
  id: string;
  role: "agent";
  status: "thinking" | "ready";
  thinking: ThinkingStep[];
  decision: Decision | null;
  triageClassifications?: TriageClassification[];
  evaluation?: EvaluationDetails | null;
  /** Final response text shown below the decision/evaluation. */
  acknowledgement: string | null;
  createdAt: number;
};

export type Message = UserMessage | AgentMessage;
