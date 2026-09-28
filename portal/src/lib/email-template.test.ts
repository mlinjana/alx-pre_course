import { describe, expect, it } from "vitest";
import { fillTemplate, parseTemplate } from "./email-template";

describe("email templates", () => {
  it("fills known placeholders and leaves others", () => {
    const t = { subject: "Your MFG coach is {coach_name}", text: "Hi {first_name}, {unknown}" };
    expect(fillTemplate(t, { coach_name: "Nomsa D.", first_name: "Sipho" })).toEqual({
      subject: "Your MFG coach is Nomsa D.",
      text: "Hi Sipho, {unknown}",
    });
  });
  it("keeps subjects on one line", () => {
    expect(fillTemplate({ subject: "{x}", text: "" }, { x: "a\nb" }).subject).toBe("a b");
  });
  it("treats placeholder wording as not set", () => {
    expect(parseTemplate({ text: "[CHUMA TO PROVIDE]" })).toBeNull();
    expect(parseTemplate({ subject: "S", text: "[CHUMA TO PROVIDE]" })).toBeNull();
    expect(parseTemplate(null)).toBeNull();
    expect(parseTemplate({ subject: "S", text: "T", status: "draft" })).toEqual({ subject: "S", text: "T" });
  });
});
