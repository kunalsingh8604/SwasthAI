import type { FacilityType } from "@/lib/healthcare-places";

export type TriageSeverity = "emergency" | "moderate" | "mild";

export type TriageResult = {
  severity: TriageSeverity;
  summary: string;
  advice: string;
  red_flags?: string[];
  /** Plain-language concern, e.g. "possible skin infection" */
  condition_label: string;
  /** Best place to seek care for this concern */
  care_type: FacilityType;
};

export const TRIAGE_TOOL_PROPERTIES = {
  severity: { type: "string", enum: ["emergency", "moderate", "mild"] },
  summary: { type: "string", description: "Simple summary of the concern" },
  advice: { type: "string", description: "What the patient should do next, in simple words" },
  red_flags: { type: "array", items: { type: "string" } },
  condition_label: {
    type: "string",
    description:
      "Short plain-language label for the likely concern (e.g. 'skin rash', 'chest pain', 'eye irritation'). Not a confirmed diagnosis.",
  },
  care_type: {
    type: "string",
    enum: ["hospital", "clinic", "pharmacy", "doctor"],
    description:
      "Where they should go: hospital (emergency/serious), doctor (specialist/GP), clinic (walk-in), pharmacy (mild OTC-level).",
  },
} as const;

export const TRIAGE_TOOL_REQUIRED = ["severity", "summary", "advice", "condition_label", "care_type"] as const;

export function defaultCareType(severity: TriageSeverity): FacilityType {
  if (severity === "emergency") return "hospital";
  if (severity === "moderate") return "doctor";
  return "clinic";
}

export function normalizeTriage(raw: unknown): TriageResult | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const severity = o.severity;
  if (severity !== "emergency" && severity !== "moderate" && severity !== "mild") return null;

  const summary = typeof o.summary === "string" ? o.summary.trim() : "";
  const advice = typeof o.advice === "string" ? o.advice.trim() : "";
  if (!summary || !advice) return null;

  const careRaw = o.care_type;
  const care_type: FacilityType =
    careRaw === "hospital" || careRaw === "clinic" || careRaw === "pharmacy" || careRaw === "doctor"
      ? careRaw
      : defaultCareType(severity);

  const condition_label =
    (typeof o.condition_label === "string" && o.condition_label.trim()) ||
    summary.slice(0, 80);

  const red_flags = Array.isArray(o.red_flags)
    ? o.red_flags.filter((x): x is string => typeof x === "string")
    : undefined;

  return { severity, summary, advice, red_flags, condition_label, care_type };
}
