"use client";

import { otherNameProblem, payoff, type Payoff } from "@/lib/calc/tracker";
import { longDate, monthsText, rand } from "@/lib/format";
import { DEBT_TYPES, STATUSES, debtLabel, hasList, newDebt, type TDebt } from "@/lib/tracker/model";
import { deleteDebt, saveDebt } from "./actions";
import type { StepProps } from "./tracker";

const OTHER = "__other";

export function StepDebts({ data, setData, schedule, institutions, calc }: StepProps) {
  function commit(debts: TDebt[], changed?: TDebt, now = false) {
    setData({ ...data, debts });
    if (changed) {
      const sort = debts.findIndex((d) => d.id === changed.id);
      schedule(`debt:${changed.id}`, () => saveDebt(changed, sort), now);
    }
  }

  function update(id: string, patch: Partial<TDebt>, now = false) {
    let changed: TDebt | undefined;
    const debts = data.debts.map((d) => {
      if (d.id !== id) return d;
      changed = { ...d, ...patch };
      // A new type keeps the institution only if it's listed for that type.
      if (patch.type && patch.type !== d.type) {
        const listed = institutions.some((i) => i.id === d.institutionId && i.type === patch.type);
        if (!listed) changed.institutionId = null;
        changed.useOther = !hasList(patch.type, institutions) || (changed.useOther && !changed.institutionId);
      }
      return changed;
    });
    commit(debts, changed, now);
  }

  function add() {
    const d = newDebt(crypto.randomUUID());
    commit([...data.debts, d], d, true);
    setTimeout(() => document.getElementById(`type-${d.id}`)?.focus(), 0);
  }

  function remove(d: TDebt) {
    if (!window.confirm(`Remove ${debtLabel(d, institutions)} from your list?`)) return;
    setData({ ...data, debts: data.debts.filter((x) => x.id !== d.id) });
    schedule(`debt:${d.id}`, () => deleteDebt(d.id), true);
  }

  const { total, minimums, unknown } = calc.totals;
  const n = data.debts.length;

  return (
    <>
      <div className="section">
        <div className="debts">
          {data.debts.length === 0 && (
            <div className="card">
              <p style={{ margin: 0 }}>No debts listed yet. Start with the one that worries you most, then add the rest.</p>
            </div>
          )}
          {data.debts.map((d, i) => (
            <DebtCard key={d.id} d={d} calcDebt={calc.debts[i]} institutions={institutions} update={update} remove={remove} />
          ))}
        </div>
        <div>
          <button className="btn ghost" onClick={add}>
            + Add a debt
          </button>
        </div>
      </div>

      <div className="section">
        <div className="total ticks">
          <div>
            <div className="eyebrow">Total you owe</div>
            <div className="big">{rand(total)}</div>
            <small>
              {n} debt{n === 1 ? "" : "s"} · dated {longDate()}
              {unknown ? ` · ${unknown} with unknowns` : ""}
            </small>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="eyebrow">Minimums each month</div>
            <div className="big" style={{ fontSize: 24 }}>
              {rand(minimums)}
            </div>
          </div>
        </div>
        <p className="note">Write the total down. Date it. Keep it. Watching it shrink will carry you through the hard months.</p>
      </div>
    </>
  );
}

function DebtCard({
  d,
  calcDebt,
  institutions,
  update,
  remove,
}: {
  d: TDebt;
  calcDebt: StepProps["calc"]["debts"][number];
  institutions: StepProps["institutions"];
  update: (id: string, patch: Partial<TDebt>, now?: boolean) => void;
  remove: (d: TDebt) => void;
}) {
  const title = debtLabel(d, institutions);
  const list = institutions.filter((i) => i.type === d.type);
  const family = d.type === "Money owed to family";
  const informal = d.type === "Informal lender (mashonisa)";
  const showOther = !family && !informal && (d.useOther || list.length === 0);
  const otherProblem = showOther && d.otherName.trim() ? otherNameProblem(d.otherName) : null;

  return (
    <div className="card" aria-label={title}>
      <div className="debt-head">
        <span className="dtitle">{title}</span>
        <button className="x" onClick={() => remove(d)} aria-label={`Remove ${title}`}>
          Remove
        </button>
      </div>
      <div className="fields">
        <label className="f wide">
          What kind of debt?
          <select id={`type-${d.id}`} value={d.type} onChange={(e) => update(d.id, { type: e.target.value }, true)}>
            {DEBT_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>

        {family && (
          <label className="f wide">
            Who do you owe? (e.g. my uncle)
            <input value={d.familyWho} onChange={(e) => update(d.id, { familyWho: e.target.value })} placeholder="Who in your family" />
          </label>
        )}
        {informal && (
          <div className="note wide">
            Informal lenders often charge far more than the law allows. List it anyway: your coach needs the full truth. If you
            feel threatened, tell your coach.
          </div>
        )}
        {!family && !informal && (
          <div className="wide">
            {list.length > 0 ? (
              // Dropdown (Chuma's choice, 28 Sep 2026) instead of the prototype's tiles.
              <label className="f">
                Who is it with?
                <select
                  value={d.institutionId ?? (d.useOther ? OTHER : "")}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === OTHER) {
                      update(d.id, { institutionId: null, useOther: true }, true);
                      setTimeout(() => document.getElementById(`other-${d.id}`)?.focus(), 0);
                    } else {
                      update(d.id, { institutionId: v || null, useOther: false }, true);
                    }
                  }}
                >
                  <option value="">Choose one</option>
                  {list.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.name}
                    </option>
                  ))}
                  <option value={OTHER}>Other (type the name)</option>
                </select>
              </label>
            ) : (
              <div className="note" style={{ marginBottom: 6 }}>
                Who is it with? Type the name from your statement.
              </div>
            )}
            {showOther && (
              <>
                <label className="f" style={{ marginTop: 8 }}>
                  Name exactly as it appears on your statement or SMS
                  <input
                    id={`other-${d.id}`}
                    value={d.otherName}
                    onChange={(e) => update(d.id, { otherName: e.target.value })}
                    placeholder="e.g. the company name on your statement"
                    aria-invalid={Boolean(otherProblem)}
                  />
                </label>
                <div className="otherchk" aria-live="polite">
                  {otherProblem ? (
                    <>
                      <span className="chip unk">Needs a real name</span> {otherProblem}
                    </>
                  ) : d.otherName.trim() ? (
                    d.otherConfirmed ? (
                      <>
                        <span className="chip ok">Confirmed</span> Your coach checked this name.
                      </>
                    ) : (
                      <>
                        <span className="chip unk">Coach to confirm against statement</span>
                      </>
                    )
                  ) : null}
                </div>
              </>
            )}
          </div>
        )}

        <Money label="Balance owed (R)" value={d.balance} onChange={(v) => update(d.id, { balance: v })} />
        <Money label="Interest rate (% a year)" value={d.rate} onChange={(v) => update(d.id, { rate: v })} />
        <Money label="Minimum (R a month)" value={d.minimum} onChange={(v) => update(d.id, { minimum: v })} />
        <label className="f">
          Status
          <select value={d.status} onChange={(e) => update(d.id, { status: e.target.value as TDebt["status"] }, true)}>
            {STATUSES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      <CostLine d={d} c={calcDebt} />
    </div>
  );
}

function Money({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="f">
      {label}
      <input className="num" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="From statement" />
    </label>
  );
}

function CostLine({ d, c }: { d: TDebt; c: StepProps["calc"]["debts"][number] }) {
  const unknown: string[] = [];
  if (c.nameMissing) unknown.push("who it's with");
  if (c.balance === null) unknown.push("balance");
  if (c.rate === null) unknown.push("rate");
  if (c.minimum === null) unknown.push("minimum");
  const p: Payoff | null = unknown.length ? null : payoff(c.balance, c.rate, c.minimum);

  return (
    <div className="cost" aria-live="polite">
      {unknown.length > 0 ? (
        <>
          <span className="chip unk">UNKNOWN: {unknown.join(", ")}</span>
          <span>Get it from your statement. We won&apos;t guess.</span>
        </>
      ) : p && "never" in p ? (
        <>
          <span className="chip bad">Never clears</span>
          <span>Never clears. This minimum doesn&apos;t even cover the interest.</span>
        </>
      ) : p ? (
        <>
          <span>True cost at the minimum:</span>
          <strong>{monthsText(p.months)}</strong>
          <span>and</span>
          <strong>{rand(p.interest)}</strong>
          <span>in interest.</span>
        </>
      ) : null}
      {d.status === "attorneys" && (
        <>
          <span className="chip bad">With attorneys</span>
          <span>Get legal advice before you negotiate this one.</span>
        </>
      )}
      {d.status === "review" && (
        <>
          <span className="chip unk">Debt review</span>
          <span>Extra payments go through your debt counsellor and PDA only.</span>
        </>
      )}
    </div>
  );
}
