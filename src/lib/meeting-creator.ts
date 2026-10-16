import {
  scoreTalenteraAccount,
  type TalenteraAccountInput,
  type TalenteraPersonas,
} from "./talentera-intelligence.ts";
import {
  scoreEvalufyAccount,
  type EvalufyAccountInput,
  type EvalufyPersonas,
} from "./evalufy-intelligence.ts";

export type MeetingCreatorProduct = "Talentera" | "Evalufy" | "Talentera + Evalufy";
export type MeetingCreatorConfidence = "high" | "medium" | "low";

export type MeetingCreatorAccountInput = TalenteraAccountInput & Pick<EvalufyAccountInput, "hrHeadcount">;

export type MeetingCreatorPersonas = {
  primary: string;
  secondary: string;
  economicBuyer: string;
  technicalInfluencer: string;
  reason: string;
};

export type MeetingCreatorAccountScore = {
  recommendedProduct: MeetingCreatorProduct;
  productConfidence: MeetingCreatorConfidence;
  meetingScore: number;
  talenteraScore: number;
  evalufyScore: number;
  productReason: string;
  recommendedAngle: string;
  personas: MeetingCreatorPersonas;
  talentera: ReturnType<typeof scoreTalenteraAccount>;
  evalufy: ReturnType<typeof scoreEvalufyAccount>;
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizePersonas(personas: TalenteraPersonas | EvalufyPersonas): MeetingCreatorPersonas {
  return {
    primary: personas.primary,
    secondary: personas.secondary,
    economicBuyer: personas.economicBuyer,
    technicalInfluencer: personas.technicalInfluencer,
    reason: personas.reason,
  };
}

export function scoreMeetingCreatorAccount(input: MeetingCreatorAccountInput): MeetingCreatorAccountScore {
  const talentera = scoreTalenteraAccount(input);
  const evalufy = scoreEvalufyAccount(input);
  const delta = evalufy.score - talentera.score;
  const absoluteDelta = Math.abs(delta);

  let recommendedProduct: MeetingCreatorProduct;
  if (talentera.score >= 75 && evalufy.score >= 75 && absoluteDelta <= 6) {
    recommendedProduct = "Talentera + Evalufy";
  } else {
    recommendedProduct = delta >= 5 ? "Evalufy" : "Talentera";
  }

  const productConfidence: MeetingCreatorConfidence = recommendedProduct === "Talentera + Evalufy"
    ? "medium"
    : absoluteDelta >= 14 ? "high" : absoluteDelta >= 7 ? "medium" : "low";

  const meetingScore = clamp(
    recommendedProduct === "Talentera + Evalufy"
      ? Math.max(talentera.score, evalufy.score) + 3
      : Math.max(talentera.score, evalufy.score),
  );

  if (recommendedProduct === "Evalufy") {
    return {
      recommendedProduct,
      productConfidence,
      meetingScore,
      talenteraScore: talentera.score,
      evalufyScore: evalufy.score,
      productReason: `Evalufy leads by ${Math.max(0, delta)} points because the account shows stronger assessment/screening and ATS-integration fit than ATS-replacement fit.`,
      recommendedAngle: evalufy.recommendedAngle,
      personas: normalizePersonas(evalufy.personas),
      talentera,
      evalufy,
    };
  }

  if (recommendedProduct === "Talentera + Evalufy") {
    return {
      recommendedProduct,
      productConfidence,
      meetingScore,
      talenteraScore: talentera.score,
      evalufyScore: evalufy.score,
      productReason: "Both products score strongly and within six points; qualify the recruiting workflow first, then choose ATS modernization, assessment, or a combined motion from the discovery call.",
      recommendedAngle: `${talentera.recommendedAngle} If screening volume is also painful, introduce Evalufy as the assessment layer rather than forcing a second unrelated pitch.`,
      personas: normalizePersonas(talentera.personas),
      talentera,
      evalufy,
    };
  }

  return {
    recommendedProduct,
    productConfidence,
    meetingScore,
    talenteraScore: talentera.score,
    evalufyScore: evalufy.score,
    productReason: `Talentera leads by ${Math.max(0, -delta)} points because the account shows stronger ATS modernization / recruiting-workflow opportunity than assessment-layer fit.`,
    recommendedAngle: talentera.recommendedAngle,
    personas: normalizePersonas(talentera.personas),
    talentera,
    evalufy,
  };
}
