// Called only for records returned by the Saudi HQ / 200+ Apollo query.
// Missing exact headcounts remain unknown, with the provider filter as evidence.
export function saudi200Candidate(country: string, employeeCount: number) {
  return country === "Saudi Arabia" && (employeeCount === 0 || employeeCount >= 200);
}

export function saudiPolicyExcluded(domain: string, sourceText: string) {
  return domain.endsWith(".gov.sa") || /government|ministry|municipality|job board|job vacancies|وظائف|وظيفة|recruitment software|applicant tracking software|وزارة|بلدية|حكوم/i.test(sourceText);
}
