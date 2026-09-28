// Sign-up rules (§4) and coach application rules (§5).
// Every error says exactly what to fix, in the prototype's words.

import { EXPERIENCE, HEARD_FROM, NEEDS, PROVINCES, QUESTIONS, READ_BOOK, type QuestionKey } from "./constants";

export type Answers = Partial<Record<QuestionKey, string>>;

/** Starting stage from the four questions (§4). */
export function stageFromAnswers(a: Answers): 1 | 2 | 3 {
  if (a.q1 === "No" || a.q2 === "Yes") return 1;
  if (a.q3 === "Yes") return 2;
  return 3;
}

export function digitCount(s: string): number {
  return (s.match(/\d/g) || []).length;
}

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function checkEmailPassword(email: string, password: string): string | null {
  if (!EMAIL_RE.test(email.trim())) return "Enter a valid email address, like name@example.com.";
  if (password.length < 8) return "Your password needs 8 or more characters.";
  return null;
}

export type AboutYou = { name: string; whatsapp: string; need: string; heard: string };

export function checkAboutYou(v: AboutYou): string | null {
  if (wordCount(v.name) < 2) return "Add your first name and surname.";
  if (digitCount(v.whatsapp) < 9) return "Add your WhatsApp number so your coach can reach you.";
  if (!(NEEDS as readonly string[]).includes(v.need)) return "Choose what you need help with.";
  if (!(HEARD_FROM as readonly string[]).includes(v.heard)) return "Tell us how you heard about MFG.";
  return null;
}

export function checkWhereYouAre(a: Answers, termsTicked: boolean): string | null {
  for (const q of QUESTIONS) {
    const v = a[q.key];
    if (!v || !(q.options as readonly string[]).includes(v)) {
      return "Answer all four questions. There are no wrong answers.";
    }
  }
  if (!termsTicked) return "Tick the box to agree to the Terms and Privacy Policy.";
  return null;
}

export type CoachApplication = {
  name: string;
  email: string;
  whatsapp: string;
  province: string;
  experience: string;
  readBook: string;
  capacity: string;
  why: string;
  qualifications: string;
  agreed: boolean;
};

export function checkCoachApplication(a: CoachApplication): string | null {
  if (wordCount(a.name) < 2) return "Add your first name and surname.";
  if (!EMAIL_RE.test(a.email.trim())) return "Enter a valid email address.";
  if (digitCount(a.whatsapp) < 9) return "Add your WhatsApp number.";
  if (!(PROVINCES as readonly string[]).includes(a.province)) return "Choose your province.";
  if (!(EXPERIENCE as readonly string[]).includes(a.experience)) return "Choose your experience.";
  if (!(READ_BOOK as readonly string[]).includes(a.readBook)) return "Tell us if you've read the book.";
  if (!isPositiveWhole(a.capacity)) return "Say how many clients you could take.";
  if (a.why.trim().length < 20) return "Tell us a little more about why you want to coach (a few sentences).";
  if (!a.agreed) return "Tick the box to confirm you understand how MFG coaches work.";
  return null;
}

export function isPositiveWhole(s: string): boolean {
  return /^\s*\d+\s*$/.test(s) && Number(s) > 0 && Number(s) <= 1000;
}

/** "Sipho Khumalo" → "Sipho". */
export function firstName(full: string | null | undefined): string {
  return (full || "").trim().split(/\s+/)[0] || "";
}
