// Fixed lists and wording from PORTAL_SPEC.md. Change only if the spec changes.

export const NEEDS = [
  "Getting out of debt",
  "Questions about debt review",
  "Staying out of debt",
  "Building wealth",
] as const;

export const HEARD_FROM = [
  "MFG website",
  "LinkedIn",
  "TikTok",
  "Facebook",
  "The Debt Millionaire book",
  "The book launch",
  "A friend or family member",
  "Other",
] as const;

export const PROVINCES = [
  "Eastern Cape",
  "Free State",
  "Gauteng",
  "KwaZulu-Natal",
  "Limpopo",
  "Mpumalanga",
  "North West",
  "Northern Cape",
  "Western Cape",
  "Outside South Africa",
] as const;

export const EXPERIENCE = [
  "None yet, but I've lived it",
  "Informal: I help friends and family with budgets",
  "Professional coach or mentor",
  "I work in financial services",
] as const;

export const READ_BOOK = ["Yes, all of it", "Part of it", "Not yet"] as const;

export const QUESTIONS = [
  {
    key: "q1",
    text: "Does your monthly pay cover rent, food, transport AND all your minimum debt payments?",
    options: ["Yes, easily", "Just", "No"],
  },
  { key: "q2", text: "Are you borrowing to pay other debts?", options: ["Yes", "No"] },
  {
    key: "q3",
    text: "Do you still have bad debt: credit cards, store accounts, personal loans or micro loans?",
    options: ["Yes", "No"],
  },
  { key: "q4", text: "Do you have savings for at least 3 months of essential costs?", options: ["Yes", "No"] },
] as const;

export type QuestionKey = (typeof QUESTIONS)[number]["key"];

export const STAGES = [
  { n: 1, name: "Survival", say: "This is the hardest stage, and you're facing it. That takes courage. The job right now: stop the bleeding." },
  { n: 2, name: "Stability", say: "The hole has stopped getting deeper. Now we climb, one debt at a time." },
  { n: 3, name: "Security", say: "Bad debt is behind you. Now we protect what you've built." },
  { n: 4, name: "Independence", say: "Your money has started working for you." },
  { n: 5, name: "Freedom", say: "What you own pays for how you live." },
] as const;

export const COACH_PROTOCOL =
  "I understand MFG coaches teach and hold clients accountable. We never sell or recommend financial products, never handle client money, never contact creditors for clients, and always follow the referral protocol.";

export const AUTH_METHOD_LABEL: Record<string, string> = {
  email: "Email",
  google: "Google",
  apple: "Apple",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  linkedin_oidc: "LinkedIn",
};
