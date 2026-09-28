import { describe, expect, it } from "vitest";
import {
  checkAboutYou,
  checkCoachApplication,
  checkEmailPassword,
  checkWhereYouAre,
  stageFromAnswers,
  type CoachApplication,
} from "./signup";

describe("stageFromAnswers (§4)", () => {
  it("Q1 = No → Stage 1, whatever else", () => {
    expect(stageFromAnswers({ q1: "No", q2: "No", q3: "No", q4: "Yes" })).toBe(1);
  });
  it("Q2 = Yes → Stage 1, even if pay covers everything", () => {
    expect(stageFromAnswers({ q1: "Yes, easily", q2: "Yes", q3: "No", q4: "Yes" })).toBe(1);
  });
  it("otherwise Q3 = Yes → Stage 2", () => {
    expect(stageFromAnswers({ q1: "Just", q2: "No", q3: "Yes", q4: "No" })).toBe(2);
  });
  it("otherwise → Stage 3", () => {
    expect(stageFromAnswers({ q1: "Yes, easily", q2: "No", q3: "No", q4: "No" })).toBe(3);
  });
  it("Q4 never changes the stage", () => {
    for (const q4 of ["Yes", "No"]) {
      expect(stageFromAnswers({ q1: "Just", q2: "No", q3: "No", q4 })).toBe(3);
    }
  });
});

describe("screen 1 · email and password", () => {
  it("needs a valid email", () => {
    expect(checkEmailPassword("sipho", "longenough")).toBe("Enter a valid email address, like name@example.com.");
  });
  it("needs at least 8 characters", () => {
    expect(checkEmailPassword("a@b.co", "1234567")).toBe("Your password needs 8 or more characters.");
    expect(checkEmailPassword("a@b.co", "12345678")).toBeNull();
  });
});

describe("screen 2 · about you", () => {
  const ok = { name: "Sipho Khumalo", whatsapp: "082 000 0000", need: "Getting out of debt", heard: "LinkedIn" };
  it("accepts a complete form", () => expect(checkAboutYou(ok)).toBeNull());
  it("needs two words of name", () => {
    expect(checkAboutYou({ ...ok, name: "Sipho" })).toBe("Add your first name and surname.");
  });
  it("needs at least 9 digits of WhatsApp, with the spec's message", () => {
    expect(checkAboutYou({ ...ok, whatsapp: "082 000 00" })).toBe(
      "Add your WhatsApp number so your coach can reach you.",
    );
    expect(checkAboutYou({ ...ok, whatsapp: "+27 82 000 0000" })).toBeNull();
  });
  it("needs a listed need and source", () => {
    expect(checkAboutYou({ ...ok, need: "Something else" })).toBe("Choose what you need help with.");
    expect(checkAboutYou({ ...ok, heard: "" })).toBe("Tell us how you heard about MFG.");
  });
});

describe("screen 3 · where you are now", () => {
  const all = { q1: "Just", q2: "No", q3: "Yes", q4: "No" };
  it("needs all four answers", () => {
    expect(checkWhereYouAre({ ...all, q4: undefined }, true)).toBe(
      "Answer all four questions. There are no wrong answers.",
    );
  });
  it("rejects answers that aren't options", () => {
    expect(checkWhereYouAre({ ...all, q1: "Maybe" }, true)).not.toBeNull();
  });
  it("needs the terms tick", () => {
    expect(checkWhereYouAre(all, false)).toBe("Tick the box to agree to the Terms and Privacy Policy.");
    expect(checkWhereYouAre(all, true)).toBeNull();
  });
});

describe("coach application (§5)", () => {
  const ok: CoachApplication = {
    name: "Lindiwe Sithole",
    email: "lindiwe@example.com",
    whatsapp: "072 000 0000",
    province: "Gauteng",
    experience: "Informal: I help friends and family with budgets",
    readBook: "Yes, all of it",
    capacity: "5",
    why: "I cleared my own store accounts and want to help others.",
    qualifications: "",
    agreed: true,
  };
  it("accepts a complete form, with qualifications optional", () => expect(checkCoachApplication(ok)).toBeNull());
  it("checks each required field in order", () => {
    expect(checkCoachApplication({ ...ok, province: "" })).toBe("Choose your province.");
    expect(checkCoachApplication({ ...ok, experience: "" })).toBe("Choose your experience.");
    expect(checkCoachApplication({ ...ok, readBook: "" })).toBe("Tell us if you've read the book.");
    expect(checkCoachApplication({ ...ok, capacity: "0" })).toBe("Say how many clients you could take.");
    expect(checkCoachApplication({ ...ok, capacity: "three" })).toBe("Say how many clients you could take.");
    expect(checkCoachApplication({ ...ok, agreed: false })).toBe(
      "Tick the box to confirm you understand how MFG coaches work.",
    );
  });
  it("needs at least 20 characters of why", () => {
    expect(checkCoachApplication({ ...ok, why: "I like helping." })).toBe(
      "Tell us a little more about why you want to coach (a few sentences).",
    );
    expect(checkCoachApplication({ ...ok, why: "12345678901234567890" })).toBeNull();
  });
});
