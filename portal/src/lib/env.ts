// Reads environment variables in one place, so a missing one fails loudly.

export function supabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function supabasePublishableKey(): string {
  return required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function ownerEmails(): string[] {
  return parseEmailList(process.env.OWNER_EMAILS);
}

export function parseEmailList(raw: string | undefined): string[] {
  return (raw || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export type Provider = "google" | "apple" | "facebook" | "linkedin";

// NEXT_PUBLIC_* values are inlined at build time, so each must be read literally.
export function enabledProviders(): Record<Provider, boolean> {
  return {
    google: process.env.NEXT_PUBLIC_AUTH_GOOGLE === "true",
    apple: process.env.NEXT_PUBLIC_AUTH_APPLE === "true",
    facebook: process.env.NEXT_PUBLIC_AUTH_FACEBOOK === "true",
    linkedin: process.env.NEXT_PUBLIC_AUTH_LINKEDIN === "true",
  };
}

export function staffIdleTimeoutMs(): number {
  const minutes = Number(process.env.STAFF_IDLE_TIMEOUT_MINUTES || 30);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 30) * 60_000;
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return value;
}
