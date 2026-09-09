import fs from "node:fs";

function replaceExact(file, before, after) {
  let source = fs.readFileSync(file, "utf8");
  if (!source.includes(before)) throw new Error(`Anchor not found in ${file}: ${before.slice(0, 100)}`);
  source = source.replace(before, after);
  fs.writeFileSync(file, source);
}

function replaceRegex(file, pattern, after, label) {
  let source = fs.readFileSync(file, "utf8");
  if (!pattern.test(source)) throw new Error(`Regex anchor not found in ${file}: ${label}`);
  pattern.lastIndex = 0;
  source = source.replace(pattern, after);
  fs.writeFileSync(file, source);
}

replaceExact(
  "src/components/AccountIntelligence.tsx",
  "    force ? setRefreshing(true) : setLoading(true);",
  "    if (force) setRefreshing(true);\n    else setLoading(true);",
);
replaceExact(
  "src/components/AccountIntelligence.tsx",
  "  const accounts = payload?.accounts || [];",
  "  const accounts = useMemo(() => payload?.accounts ?? [], [payload?.accounts]);",
);

replaceExact(
  "src/components/SalesNavPipeline.tsx",
  "      for (const row of selectable) allSelected ? next.delete(row.key) : next.add(row.key);",
  "      for (const row of selectable) {\n        if (allSelected) next.delete(row.key);\n        else next.add(row.key);\n      }",
);
replaceExact(
  "src/components/SalesNavPipeline.tsx",
  "onChange={() => setSelected((current) => { const next = new Set(current); next.has(row.key) ? next.delete(row.key) : next.add(row.key); return next; })}",
  "onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(row.key)) next.delete(row.key); else next.add(row.key); return next; })}",
);

replaceExact(
  "src/components/SalesNavPipelineV2.tsx",
  "  function toggleVisible() { setSelected((current) => { const next = new Set(current); for (const row of selectable) allSelected ? next.delete(row.key) : next.add(row.key); return next; }); }",
  "  function toggleVisible() { setSelected((current) => { const next = new Set(current); for (const row of selectable) { if (allSelected) next.delete(row.key); else next.add(row.key); } return next; }); }",
);
replaceExact(
  "src/components/SalesNavPipelineV2.tsx",
  "onChange={() => setSelected((current) => { const next = new Set(current); next.has(row.key) ? next.delete(row.key) : next.add(row.key); return next; })}",
  "onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(row.key)) next.delete(row.key); else next.add(row.key); return next; })}",
);

replaceExact(
  "src/lib/talentera-intelligence.ts",
  "\nfunction marketScore(country: string) {\n  return getTalenteraMarket(country).score;\n}\n",
  "",
);

replaceRegex(
  "src/app/api/target-account-pool/route.ts",
  /\nfunction organizationDomain\(org: ApolloOrganization\) \{[\s\S]*?\n\}\n\nfunction accountText\(org: ApolloOrganization\) \{/,
  "\nfunction accountText(org: ApolloOrganization) {",
  "remove unused organization domain/country helpers",
);
replaceRegex(
  "src/app/api/target-account-pool/route.ts",
  /\nfunction inferredIndustry\(org: ApolloOrganization\) \{[\s\S]*?\n\}\n\nasync function existingHubSpotDomains\(domains: string\[\]\) \{/,
  "\nasync function existingHubSpotDomains(domains: string[]) {",
  "remove unused target-industry helper cluster",
);

console.log("Zero-warning lint cleanup applied.");
