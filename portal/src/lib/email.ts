import "server-only";
import { Resend } from "resend";
import { fillTemplate, type EmailTemplate } from "@/lib/email-template";

export type EmailResult = { sent: true } | { sent: false; reason: string };

/**
 * Sends a plain-text email through Resend.
 * Rule (§11.2): no debt figures or other financial data in any email.
 * Callers pass only names and links.
 */
export async function sendTemplate(
  to: string,
  template: EmailTemplate | null,
  values: Record<string, string>,
): Promise<EmailResult> {
  if (!template) return { sent: false, reason: "The email wording isn't set yet." };
  const key = process.env.EMAIL_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return { sent: false, reason: "Email sending isn't set up yet (EMAIL_API_KEY and EMAIL_FROM)." };

  const { subject, text } = fillTemplate(template, values);
  try {
    const resend = new Resend(key);
    const { error } = await resend.emails.send({ from, to, subject, text });
    if (error) return { sent: false, reason: "The email service refused the message." };
    return { sent: true };
  } catch {
    return { sent: false, reason: "The email service couldn't be reached." };
  }
}
