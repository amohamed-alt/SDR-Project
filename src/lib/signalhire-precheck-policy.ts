export type SignalHirePrecheckPolicyInput = {
  contactExists: boolean;
  companyExists: boolean;
  retention: boolean;
  protectedCompany: boolean;
  engagementChecked: boolean;
  engaged: boolean;
};

export type SignalHirePrecheckStage =
  | "ready"
  | "existing"
  | "engaged"
  | "retention"
  | "protected"
  | "error";

export function signalHirePrecheckStage(input: SignalHirePrecheckPolicyInput): SignalHirePrecheckStage {
  if (input.retention) return "retention";
  if (input.contactExists) return "existing";
  if (input.protectedCompany) return "protected";
  if (input.companyExists && !input.engagementChecked) return "error";
  if (input.engaged) return "engaged";
  return "ready";
}
