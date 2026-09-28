import { describe, expect, it } from "vitest";
import {
  capacityColour,
  daysWaiting,
  leastBusyCoach,
  loadLabel,
  waitingColour,
  type CoachLoad,
} from "./assignment";

const coach = (id: string, clients: number, capacity: number, status = "certified"): CoachLoad => ({
  id,
  name: `${id} Coach`,
  status,
  capacity,
  clients,
});

describe("leastBusyCoach (§6)", () => {
  it("picks the lowest clients ÷ capacity", () => {
    // Nomsa 4/10 = 0.4, Kagiso 3/8 = 0.375, Chuma 2/5 = 0.4
    const pick = leastBusyCoach([coach("Nomsa", 4, 10), coach("Kagiso", 3, 8), coach("Chuma", 2, 5)]);
    expect(pick?.id).toBe("Kagiso");
  });
  it("skips full coaches", () => {
    expect(leastBusyCoach([coach("A", 1, 1), coach("B", 4, 5)])?.id).toBe("B");
  });
  it("skips coaches who aren't certified", () => {
    expect(leastBusyCoach([coach("T", 0, 5, "training"), coach("P", 0, 5, "inactive"), coach("C", 3, 5)])?.id).toBe("C");
  });
  it("returns null when everyone is full", () => {
    expect(leastBusyCoach([coach("A", 2, 2)])).toBeNull();
  });
  it("breaks ties by more free places", () => {
    expect(leastBusyCoach([coach("Small", 1, 2), coach("Big", 5, 10)])?.id).toBe("Big");
  });
});

describe("labels and colours", () => {
  it("formats the dropdown load like the spec", () => {
    expect(loadLabel({ id: "k", name: "Kagiso Phiri", status: "certified", clients: 3, capacity: 8 })).toBe(
      "Kagiso P. · 3/8",
    );
  });
  it("colours days waiting: green today, amber 1–2, red 3+", () => {
    expect([0, 1, 2, 3, 9].map(waitingColour)).toEqual(["green", "amber", "amber", "red", "red"]);
  });
  it("counts calendar days in South African time", () => {
    // 23:30 SAST on the 1st and 00:30 SAST on the 2nd are one day apart.
    expect(daysWaiting(new Date("2026-09-01T21:30:00Z"), new Date("2026-09-01T22:30:00Z"))).toBe(1);
    expect(daysWaiting(new Date("2026-09-01T06:00:00Z"), new Date("2026-09-01T20:00:00Z"))).toBe(0);
    expect(daysWaiting(new Date("2026-09-01T06:00:00Z"), new Date("2026-09-04T06:00:00Z"))).toBe(3);
  });
  it("colours capacity: amber from 80%, red when full", () => {
    expect(capacityColour(3, 8)).toBe("green");
    expect(capacityColour(4, 5)).toBe("amber");
    expect(capacityColour(5, 5)).toBe("red");
  });
});
