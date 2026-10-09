export type ResultInput = { confirmed: boolean; numericValue?: number; comparator?: string; unit?: string; lower?: number; upper?: number; lowerInclusive?: boolean; upperInclusive?: boolean; applicability?: string; laboratoryFlag?: "normal" | "abnormal" | "critical" | "unknown"; sourceConflict?: boolean };
export type ResultStatus = "green" | "amber" | "red" | "grey";
export const resultCopy: Record<ResultStatus, string> = {
  green: "Within the reported laboratory reference interval. This does not rule out illness.",
  amber: "Outside the reported laboratory reference interval. Discuss the result with a healthcare professional.",
  red: "The laboratory marked this result critical. Contact the reporting facility or a healthcare professional promptly.",
  grey: "Cannot assess from the available information. View the original report or ask the laboratory."
};
export function evaluateResult(input: ResultInput): { status: ResultStatus; reason: string; wording: string } {
  let status: ResultStatus = "grey"; let reason = "incomplete_or_unconfirmed";
  if (input.confirmed && input.laboratoryFlag === "critical") { status = "red"; reason = "laboratory_critical_flag"; }
  else if (input.confirmed && !input.sourceConflict && input.numericValue !== undefined && input.unit && (!input.comparator || ["<","<=","=",">=",">"].includes(input.comparator)) && (input.lower !== undefined || input.upper !== undefined)) {
    const above = input.lower === undefined || (input.lowerInclusive === false ? input.numericValue > input.lower : input.numericValue >= input.lower);
    const below = input.upper === undefined || (input.upperInclusive === false ? input.numericValue < input.upper : input.numericValue <= input.upper);
    status = above && below && input.laboratoryFlag !== "abnormal" ? "green" : "amber"; reason = status === "green" ? "inside_reported_interval" : "outside_or_flagged";
  }
  return { status, reason, wording: resultCopy[status] };
}
