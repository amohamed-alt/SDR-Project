// Preserve source formatting; compare digits without guessing a country code.
export function distinctProspectPhones(values: string[]) {
  const seen = new Set<string>();
  return values.map(value => value.trim()).filter(value => {
    const key = value.replace(/[^0-9a-z]/gi, "").toLowerCase().replace(/^00(?=\d)/, "");
    const digits = value.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15 || /^(\d)\1+$/.test(digits) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function missingProspectPhoneProperties(
  prospect: { phone?: string; phones?: string[]; mobilephone?: string },
  current: { phone?: string | null; mobilephone?: string | null; gtm_additional_phone_numbers?: string | null } = {},
) {
  const values = distinctProspectPhones([prospect.phone || "", prospect.mobilephone || "", ...(prospect.phones || [])]);
  const mobile = distinctProspectPhones([prospect.mobilephone || ""])[0];
  const properties: Record<string, string> = {};
  if (!current.mobilephone?.trim() && mobile) properties.mobilephone = mobile;
  const mobileKey = (current.mobilephone || mobile || "").replace(/\D/g, "").replace(/^00/, "");
  const phone = values.find(value => value.replace(/\D/g, "").replace(/^00/, "") !== mobileKey) || values[0];
  if (!current.phone?.trim() && phone) properties.phone = phone;
  const phoneKey = (value: string) => value.replace(/\D/g, "").replace(/^00/, "");
  const additional = String(current.gtm_additional_phone_numbers || "").trim();
  const stored = new Set([
    current.phone || properties.phone || "",
    current.mobilephone || properties.mobilephone || "",
    ...distinctProspectPhones(additional.split(/[;,\n]+/)),
  ].map(phoneKey));
  const remaining = values.filter(value => !stored.has(phoneKey(value)));
  if (remaining.length) properties.gtm_additional_phone_numbers = [additional, ...remaining].filter(Boolean).join("\n");
  return properties;
}
