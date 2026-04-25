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
  caseProgress: number; // 0-100
};

export type Action = {
  id: string;
  label: string;
  description?: string;
  intent?: "default" | "constructive" | "escalation";
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
  actions: Action[];
  /** Set once when the user commits an action; immutable thereafter. */
  selectedActionId: string | null;
  /** Confirmation text shown after an action is committed. */
  acknowledgement: string | null;
  createdAt: number;
};

export type Message = UserMessage | AgentMessage;
