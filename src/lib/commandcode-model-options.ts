// DeepSeek enables thinking by default. Short SDR copy needs the visible
// answer budget, not a hidden reasoning budget that can truncate the JSON.
export function commandCodeModelOptions(model: string) {
  return /deepseek/i.test(model)
    ? { thinking: { type: "disabled" as const }, reasoning_effort: "none" as const }
    : {};
}
