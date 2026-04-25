import type {
  Action,
  Decision,
  EnvironmentType,
  Severity,
  ThinkingStep,
} from "./types";

type Profile = {
  thinking: ThinkingStep[];
  decision: Decision;
  actions: Action[];
};

const profiles: Record<EnvironmentType, Profile> = {
  planning: {
    thinking: [
      {
        id: "p1",
        label: "Parse submission",
        detail:
          "Extract applicant, parcel reference, and proposed development from the scenario text.",
      },
      {
        id: "p2",
        label: "Check required documents",
        detail:
          "Cross-reference the submission against the council's mandatory bundle: site plan, design statement, ownership certificate.",
      },
      {
        id: "p3",
        label: "Flag missing artifacts",
        detail:
          "Site plan absent. Without a scaled site plan the application cannot be validated.",
      },
      {
        id: "p4",
        label: "Determine route",
        detail:
          "Application is incomplete — recommend rejection with a remediation path rather than escalation.",
      },
    ],
    decision: {
      headline: "Application rejected — missing site plan.",
      rationale:
        "The submission lacks a scaled site plan, which is mandatory for validation. The case cannot proceed to consultation until a compliant plan is provided.",
      severity: "moderate",
      caseProgress: 40,
    },
    actions: [
      {
        id: "revise",
        label: "Revise document",
        description: "Open the submission and request a corrected site plan.",
        intent: "default",
      },
      {
        id: "add",
        label: "Add missing information",
        description: "Attach a scaled site plan and supporting drawings.",
        intent: "constructive",
      },
      {
        id: "resubmit",
        label: "Resubmit",
        description: "Send the updated bundle back through validation.",
        intent: "default",
      },
      {
        id: "escalate",
        label: "Escalate",
        description: "Route to a senior planning officer for review.",
        intent: "escalation",
      },
    ],
  },
  clinical: {
    thinking: [
      {
        id: "c1",
        label: "Vitals review",
        detail:
          "Heart rate, blood pressure, and SpO₂ all within tolerable bounds; respiratory rate slightly elevated.",
      },
      {
        id: "c2",
        label: "Symptom clustering",
        detail:
          "Reported symptoms align with a non-acute presentation — no red-flag indicators detected.",
      },
      {
        id: "c3",
        label: "Triage tier",
        detail:
          "Case fits Category 3 — standard waiting time, no immediate intervention required.",
      },
    ],
    decision: {
      headline: "Standard triage — non-urgent (Category 3).",
      rationale:
        "Vitals and symptom pattern do not meet escalation criteria. Patient is safe to wait under routine observation.",
      severity: "low",
      caseProgress: 30,
    },
    actions: [
      {
        id: "observe",
        label: "Place in observation queue",
        intent: "default",
      },
      {
        id: "reassess",
        label: "Re-assess in 30 minutes",
        intent: "default",
      },
      {
        id: "labs",
        label: "Order baseline labs",
        intent: "constructive",
      },
      {
        id: "escalate",
        label: "Escalate to senior clinician",
        intent: "escalation",
      },
    ],
  },
  compliance: {
    thinking: [
      {
        id: "co1",
        label: "Identify control",
        detail:
          "Maps to control 7.4 (data retention) under the project's compliance baseline.",
      },
      {
        id: "co2",
        label: "Evaluate evidence",
        detail:
          "Provided evidence covers the policy but not the operational procedure. Procedural attestation is missing.",
      },
      {
        id: "co3",
        label: "Risk weighting",
        detail:
          "Gap is procedural rather than structural — moderate risk, remediable within the current cycle.",
      },
    ],
    decision: {
      headline: "Partial pass — procedural evidence required.",
      rationale:
        "Policy artefacts are sufficient; operational evidence (last quarter's run-book attestations) is missing. Control 7.4 cannot be marked compliant until that evidence is supplied.",
      severity: "moderate",
      caseProgress: 55,
    },
    actions: [
      {
        id: "request",
        label: "Request operational evidence",
        intent: "default",
      },
      {
        id: "schedule",
        label: "Schedule attestation walkthrough",
        intent: "constructive",
      },
      {
        id: "exception",
        label: "Log a temporary exception",
        intent: "default",
      },
      {
        id: "escalate",
        label: "Escalate to compliance lead",
        intent: "escalation",
      },
    ],
  },
  incident: {
    thinking: [
      {
        id: "i1",
        label: "Establish blast radius",
        detail:
          "Affected service is upstream of two customer-facing endpoints. Estimated exposure: 18% of traffic.",
      },
      {
        id: "i2",
        label: "Correlate signals",
        detail:
          "Error spike correlates with the most recent deploy by ~90 seconds — strong rollback candidate.",
      },
      {
        id: "i3",
        label: "Mitigation choice",
        detail:
          "Rollback is reversible and faster than forward-fix. Recommend rollback then root-cause investigation.",
      },
    ],
    decision: {
      headline: "Mitigate by rollback — initiate within 5 minutes.",
      rationale:
        "Signals strongly correlate with the latest deploy and customer impact is rising. Rollback is the lowest-risk path to restore service.",
      severity: "high",
      caseProgress: 65,
    },
    actions: [
      {
        id: "rollback",
        label: "Roll back deploy",
        intent: "constructive",
      },
      {
        id: "comms",
        label: "Post status update",
        intent: "default",
      },
      {
        id: "page",
        label: "Page on-call engineer",
        intent: "escalation",
      },
      {
        id: "rca",
        label: "Open RCA ticket",
        intent: "default",
      },
    ],
  },
  general: {
    thinking: [
      {
        id: "g1",
        label: "Frame the request",
        detail:
          "Identify what kind of decision is being asked for and which signals are actually present in the input.",
      },
      {
        id: "g2",
        label: "Surface unknowns",
        detail:
          "List the gaps that, if closed, would change the recommendation materially.",
      },
      {
        id: "g3",
        label: "Pick a defensible path",
        detail:
          "Prefer the option that is reversible and produces the most learning if it turns out to be wrong.",
      },
    ],
    decision: {
      headline: "Proceed with a low-cost reversible step.",
      rationale:
        "There is enough signal to act, but not enough to commit to a non-reversible course. Take the smallest step that produces evidence.",
      severity: "low",
      caseProgress: 25,
    },
    actions: [
      { id: "clarify", label: "Request clarification", intent: "default" },
      { id: "smoke", label: "Run a smoke test", intent: "constructive" },
      { id: "defer", label: "Defer to next review", intent: "default" },
      { id: "escalate", label: "Escalate", intent: "escalation" },
    ],
  },
};

const SEVERITY_KEYWORDS: Array<{ severity: Severity; words: string[] }> = [
  { severity: "critical", words: ["critical", "outage", "p0", "fatal"] },
  { severity: "high", words: ["urgent", "severe", "p1", "high", "page"] },
  { severity: "moderate", words: ["risk", "review", "concern", "delay"] },
];

function inferSeverityFromText(text: string, fallback: Severity): Severity {
  const lower = text.toLowerCase();
  for (const { severity, words } of SEVERITY_KEYWORDS) {
    if (words.some((w) => lower.includes(w))) return severity;
  }
  return fallback;
}

export type AgentResponse = {
  thinking: ThinkingStep[];
  decision: Decision;
  actions: Action[];
};

export function generateAgentResponse(
  scenario: string,
  environment: EnvironmentType,
): AgentResponse {
  const profile = profiles[environment];
  const severity = inferSeverityFromText(scenario, profile.decision.severity);
  return {
    thinking: profile.thinking,
    decision: { ...profile.decision, severity },
    actions: profile.actions,
  };
}

export type ActionOutcome = {
  acknowledgement: string;
  nextProgress: number;
};

const INTENT_VERB: Record<NonNullable<Action["intent"]>, string> = {
  default: "Logged",
  constructive: "Initiated",
  escalation: "Escalated",
};

export function generateActionOutcome(
  action: Action,
  currentProgress: number,
): ActionOutcome {
  const intent = action.intent ?? "default";
  const verb = INTENT_VERB[intent];
  const bump = intent === "escalation" ? 15 : intent === "constructive" ? 30 : 20;
  return {
    acknowledgement: `${verb}: ${action.label.toLowerCase()}.`,
    nextProgress: Math.min(100, Math.max(currentProgress, currentProgress + bump)),
  };
}

export const ENVIRONMENT_OPTIONS: Array<{
  value: EnvironmentType;
  label: string;
  hint: string;
}> = [
  {
    value: "general",
    label: "General",
    hint: "Reversible, low-cost decisions",
  },
  {
    value: "planning",
    label: "Planning application",
    hint: "Document review and validation",
  },
  {
    value: "clinical",
    label: "Clinical triage",
    hint: "Patient acuity and routing",
  },
  {
    value: "compliance",
    label: "Compliance review",
    hint: "Control evidence and gaps",
  },
  {
    value: "incident",
    label: "Incident response",
    hint: "Outage mitigation and rollback",
  },
];
