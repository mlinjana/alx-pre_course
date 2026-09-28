// Email wording lives in the `settings` table so the owner can change it.
// Placeholders look like {first_name}. Unknown placeholders are left as they are.

export type EmailTemplate = { subject: string; text: string };

export function parseTemplate(value: unknown): EmailTemplate | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.subject !== "string" || typeof v.text !== "string") return null;
  if (v.text.includes("[CHUMA TO PROVIDE]") || !v.subject.trim() || !v.text.trim()) return null;
  return { subject: v.subject, text: v.text };
}

export function fillTemplate(t: EmailTemplate, values: Record<string, string>): EmailTemplate {
  const fill = (s: string) =>
    s.replace(/\{([a-z_]+)\}/g, (whole, key: string) => (key in values ? values[key] : whole));
  // Subjects are one line.
  return { subject: fill(t.subject).replace(/[\r\n]+/g, " "), text: fill(t.text) };
}
