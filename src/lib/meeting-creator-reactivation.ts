export type ReactivationStatus = "eligible" | "protected" | "needs_review";
export type ReactivationInput = {
  attemptedCalls: number;
  connectedCalls: number;
  bookedMeetings: number;
  openDeals: number;
  openFollowUpTasks: number;
  positiveReplies: number;
  completeCallHistory: boolean;
  newContactId?: string;
  previouslyCalledContactIds: string[];
  newContactCurrentEmployerVerified: boolean;
  newContactDecisionMakerFit: boolean;
  newContactBusinessPhoneAvailable: boolean;
};
export function evaluateReactivation(input: ReactivationInput): {status: ReactivationStatus; reason: string} {
  if (input.openDeals > 0 || input.bookedMeetings > 0 || input.connectedCalls > 0 || input.positiveReplies > 0) {
    return {status:"protected",reason:"Existing commercial engagement"};
  }
  if (input.openFollowUpTasks > 0) return {status:"protected",reason:"Open owner follow-up"};
  if (!input.completeCallHistory || input.attemptedCalls < 1) return {status:"needs_review",reason:"Insufficient failed-call evidence"};
  if (!input.newContactId || input.previouslyCalledContactIds.includes(input.newContactId)) {
    return {status:"needs_review",reason:"Different contact not verified"};
  }
  if (!input.newContactCurrentEmployerVerified || !input.newContactDecisionMakerFit) {
    return {status:"needs_review",reason:"Contact identity or persona not verified"};
  }
  if (!input.newContactBusinessPhoneAvailable) return {status:"needs_review",reason:"No verified business phone"};
  return {status:"eligible",reason:"Unconnected prior attempts; different verified decision maker"};
}
