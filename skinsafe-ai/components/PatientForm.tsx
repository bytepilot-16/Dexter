"use client";
import { useMemo, useState } from "react";
import {
  COND_META,
  REGION_LABEL,
  buildPoses,
  cid,
  condText,
  deriveSens,
  riskOf,
  suggestInterval,
  uid,
  type CondKind,
  type Condition,
  type Patient,
  type Region,
} from "../lib/model";

const ring =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1b1610]";

const BRADEN = [
  { key: "Sensory perception", max: 4, opts: ["Completely limited", "Very limited", "Slightly limited", "No impairment"] },
  { key: "Moisture", max: 4, opts: ["Constantly moist", "Very moist", "Occasionally moist", "Rarely moist"] },
  { key: "Activity", max: 4, opts: ["Bedfast", "Chairfast", "Walks occasionally", "Walks frequently"] },
  { key: "Mobility", max: 4, opts: ["Completely immobile", "Very limited", "Slightly limited", "No limitation"] },
  { key: "Nutrition", max: 4, opts: ["Very poor", "Probably inadequate", "Adequate", "Excellent"] },
  { key: "Friction and shear", max: 3, opts: ["Problem", "Potential problem", "No apparent problem"] },
];

const MOBILITY = [
  "Bed-bound",
  "Needs full assist",
  "Moves with help",
  "Unresponsive to position",
  "No sensation below injury",
  "Bed rest, limb immobilised",
  "Independent",
];
const NUTRITION = ["Adequate", "Low albumin", "Tube feeding", "Nil by mouth", "Poor intake"];

type Draft = Omit<Patient, "sens" | "startMin" | "startPose"> & {
  startPose: number;
  autoInterval: boolean;
};

const toDraft = (p?: Patient): Draft =>
  p
    ? { ...p, conditions: p.conditions.map((c) => ({ ...c })), autoInterval: false }
    : {
        id: uid(),
        name: "",
        age: 65,
        sex: "Female",
        bed: "",
        dx: "",
        weightKg: 65,
        braden: 14,
        mobility: "Bed-bound",
        nutrition: "Adequate",
        interval: suggestInterval(14),
        startPose: 0,
        conditions: [],
        autoInterval: true,
      };

export default function PatientForm({
  initial,
  takenBeds,
  onSave,
  onDelete,
  onClose,
}: {
  initial?: Patient;
  takenBeds: string[];
  onSave: (p: Patient) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
}) {
  const [d, setD] = useState<Draft>(() => toDraft(initial));
  const [calc, setCalc] = useState(false);
  const [parts, setParts] = useState<number[]>([2, 3, 2, 2, 3, 2]);
  const [confirmDel, setConfirmDel] = useState(false);
  const [touched, setTouched] = useState(false);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const setBraden = (b: number) =>
    setD((x) => ({ ...x, braden: b, interval: x.autoInterval ? suggestInterval(b) : x.interval }));

  const ps = useMemo(() => buildPoses(d), [d]);
  const risk = riskOf(d.braden);

  const errors: Partial<Record<"name" | "bed" | "age" | "weight" | "dx", string>> = {};
  if (!d.name.trim()) errors.name = "Name is required";
  if (!d.bed.trim()) errors.bed = "Bed is required";
  else if (takenBeds.includes(d.bed.trim().toUpperCase()) && d.bed.trim().toUpperCase() !== initial?.bed.toUpperCase())
    errors.bed = "Bed already occupied";
  if (!(d.age >= 0 && d.age <= 120)) errors.age = "0 to 120";
  if (!(d.weightKg >= 20 && d.weightKg <= 300)) errors.weight = "20 to 300 kg";
  if (!d.dx.trim()) errors.dx = "Add a short diagnosis";
  const valid = Object.keys(errors).length === 0;

  const addCond = () => {
    const kind: CondKind = "fracture";
    set("conditions", [...d.conditions, { id: cid(), kind, region: COND_META[kind].regions[0] }]);
  };
  const updCond = (id: string, patch: Partial<Condition>) =>
    set(
      "conditions",
      d.conditions.map((c) => {
        if (c.id !== id) return c;
        const n = { ...c, ...patch };
        if (!COND_META[n.kind].regions.includes(n.region)) n.region = COND_META[n.kind].regions[0];
        return n;
      }),
    );
  const delCond = (id: string) => set("conditions", d.conditions.filter((c) => c.id !== id));

  const save = () => {
    setTouched(true);
    if (!valid) return;
    const startPose = ps.allowed[d.startPose] ? d.startPose : Math.max(0, ps.allowed.indexOf(true));
    onSave({
      id: d.id,
      name: d.name.trim(),
      age: Math.round(d.age),
      sex: d.sex,
      bed: d.bed.trim().toUpperCase(),
      dx: d.dx.trim(),
      weightKg: Math.round(d.weightKg),
      braden: d.braden,
      mobility: d.mobility,
      nutrition: d.nutrition,
      interval: Math.max(15, Math.round(d.interval)),
      sens: deriveSens(d.braden, d.age, d.nutrition),
      startMin: initial?.startMin ?? 0,
      startPose,
      conditions: d.conditions,
    });
  };

  const field = "mt-1 w-full rounded-xl border border-[#1b1610]/20 bg-[#fbf5e4] px-3 py-2 text-sm text-[#1b1610] outline-none transition focus:border-[#1b1610]/60 focus:bg-[#fffdf7] focus:shadow-[0_0_0_3px_rgba(201,162,74,0.35)]";
  const label = "eyebrow block";
  const err = (k: keyof typeof errors) =>
    touched && errors[k] ? <span className="mt-1 block text-[11px] font-semibold text-[#a1241a]">{errors[k]}</span> : null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="pf-title">
      {/* Opaque backdrop overlay to eliminate any see-through bleed from underlying views */}
      <div className="fixed inset-0 bg-[#2d2212]/60 backdrop-blur-sm" onClick={onClose} />
      
      {/* Solid Parchment Modal Sheet */}
      <div className="modal-sheet rise relative z-10 flex max-h-[92vh] w-[min(1040px,96vw)] flex-col overflow-hidden rounded-[28px]">
        {/* header */}
        <div className="flex items-start justify-between gap-4 border-b border-[#1b1610]/15 bg-[#f6ebd0] px-8 pb-5 pt-6">
          <div>
            <p className="eyebrow">{initial ? `Editing ${initial.id}` : "New admission"}</p>
            <h2 id="pf-title" className="font-display mt-1 text-[38px] leading-none">
              {initial ? "Edit patient" : "Add patient"}
            </h2>
          </div>
          <button onClick={onClose} className={`btn-ghost h-10 w-10 rounded-full text-xl ${ring}`} aria-label="Close">
            ×
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-6 overflow-y-auto px-8 py-6 [scrollbar-width:thin] lg:grid-cols-[1fr_310px]">
          <div className="flex flex-col gap-6">
            {/* identity */}
            <section className="card p-5">
              <p className="eyebrow">01 · Identity</p>
              <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-4">
                <label className="col-span-2">
                  <span className={label}>Full name</span>
                  <input id="pf-name" className={field} value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Priya Menon" />
                  {err("name")}
                </label>
                <label>
                  <span className={label}>Bed</span>
                  <input id="pf-bed" className={field} value={d.bed} onChange={(e) => set("bed", e.target.value)} placeholder="04A" />
                  {err("bed")}
                </label>
                <label>
                  <span className={label}>Sex</span>
                  <select id="pf-sex" className={field} value={d.sex} onChange={(e) => set("sex", e.target.value)}>
                    <option>Female</option>
                    <option>Male</option>
                    <option>Other</option>
                  </select>
                </label>
                <label>
                  <span className={label}>Age</span>
                  <input id="pf-age" type="number" className={field} value={d.age} onChange={(e) => set("age", Number(e.target.value))} />
                  {err("age")}
                </label>
                <label>
                  <span className={label}>Weight, kg</span>
                  <input id="pf-weight" type="number" className={field} value={d.weightKg} onChange={(e) => set("weightKg", Number(e.target.value))} />
                  {err("weight")}
                </label>
                <label className="col-span-2">
                  <span className={label}>Diagnosis</span>
                  <input id="pf-dx" className={field} value={d.dx} onChange={(e) => set("dx", e.target.value)} placeholder="e.g. Pneumonia, sedated" />
                  {err("dx")}
                </label>
              </div>
            </section>

            {/* risk */}
            <section className="card p-5">
              <div className="flex items-center justify-between">
                <p className="eyebrow">02 · Risk and schedule</p>
                <button onClick={() => setCalc((c) => !c)} className={`text-xs font-semibold underline decoration-[#1b1610]/40 underline-offset-4 ${ring}`}>
                  {calc ? "Enter total directly" : "Calculate Braden from subscales"}
                </button>
              </div>

              {!calc ? (
                <div className="mt-4 flex items-center gap-5">
                  <div className="text-center">
                    <p className="font-display tnum text-5xl leading-none" style={{ color: risk.color }}>
                      {d.braden}
                    </p>
                    <p className="mt-1 text-[11px] font-semibold" style={{ color: risk.color }}>
                      {risk.label}
                    </p>
                  </div>
                  <input
                    id="pf-braden"
                    type="range"
                    min={6}
                    max={23}
                    value={d.braden}
                    onChange={(e) => setBraden(Number(e.target.value))}
                    className="range flex-1 accent-[#1b1610]"
                    aria-label="Braden score"
                  />
                </div>
              ) : (
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                  {BRADEN.map((b, i) => (
                    <label key={b.key}>
                      <span className={label}>{b.key}</span>
                      <select
                        className={field}
                        value={parts[i]}
                        onChange={(e) => {
                          const np = [...parts];
                          np[i] = Number(e.target.value);
                          setParts(np);
                          setBraden(np.reduce((a, c) => a + c, 0));
                        }}
                      >
                        {b.opts.map((o, k) => (
                          <option key={o} value={k + 1}>
                            {k + 1}. {o}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <p className="text-sm md:col-span-2">
                    Total <b className="tnum">{d.braden}</b> of 23,{" "}
                    <span className="font-semibold" style={{ color: risk.color }}>
                      {risk.label.toLowerCase()}
                    </span>
                  </p>
                </div>
              )}

              <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
                <label className="col-span-2 md:col-span-1">
                  <span className={label}>Mobility</span>
                  <select className={field} value={d.mobility} onChange={(e) => set("mobility", e.target.value)}>
                    {[...new Set([d.mobility, ...MOBILITY])].map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <label className="col-span-2 md:col-span-1">
                  <span className={label}>Nutrition</span>
                  <select className={field} value={d.nutrition} onChange={(e) => set("nutrition", e.target.value)}>
                    {[...new Set([d.nutrition, ...NUTRITION])].map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className={label}>Turn every, min</span>
                  <input
                    id="pf-interval"
                    type="number"
                    min={15}
                    step={15}
                    className={field}
                    value={d.interval}
                    onChange={(e) => setD((x) => ({ ...x, interval: Number(e.target.value), autoInterval: false }))}
                  />
                </label>
                <label>
                  <span className={label}>Current position</span>
                  <select className={field} value={d.startPose} onChange={(e) => set("startPose", Number(e.target.value))}>
                    {ps.poses.map((p, i) => (
                      <option key={p.name} value={i}>
                        {p.name}
                        {!ps.allowed[i] ? " (avoid)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="mt-2 text-[11px] text-[#1b1610]/65">
                Suggested interval for Braden {d.braden}: every {suggestInterval(d.braden)} min.
                {!d.autoInterval && d.interval !== suggestInterval(d.braden) && (
                  <button
                    className="ml-2 font-semibold underline underline-offset-2"
                    onClick={() => setD((x) => ({ ...x, interval: suggestInterval(x.braden), autoInterval: true }))}
                  >
                    Use it
                  </button>
                )}
              </p>
            </section>

            {/* body notes */}
            <section className="card p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="eyebrow">03 · Body notes</p>
                  <p className="mt-1 text-xs text-[#1b1610]/65">
                    Fractures, casts, arm on chest, elevated legs, or existing wounds. These adjust the pressure map and prevent unsafe turns.
                  </p>
                </div>
                <button onClick={addCond} className={`btn-ghost shrink-0 rounded-full px-4 py-2 text-xs font-semibold ${ring}`}>
                  + Add note
                </button>
              </div>
              {d.conditions.length === 0 ? (
                <p className="mt-4 rounded-xl border border-dashed border-[#1b1610]/20 bg-[#fbf3dc]/40 px-4 py-5 text-center text-sm text-[#1b1610]/60">
                  No body notes added. If patient has a fractured limb, cast, arm resting on chest, or elevated heel, add it here.
                </p>
              ) : (
                <ul className="mt-4 flex flex-col gap-3">
                  {d.conditions.map((c) => (
                    <li key={c.id} className="grid grid-cols-[1fr_1fr_auto] items-end gap-3 rounded-2xl bg-[#f6ebd0] p-3.5 border border-[#1b1610]/15 md:grid-cols-[1.2fr_1fr_1.2fr_auto]">
                      <label>
                        <span className={label}>Type</span>
                        <select className={field} value={c.kind} onChange={(e) => updCond(c.id, { kind: e.target.value as CondKind })}>
                          {(Object.keys(COND_META) as CondKind[]).map((k) => (
                            <option key={k} value={k}>
                              {COND_META[k].label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span className={label}>Where</span>
                        <select className={field} value={c.region} onChange={(e) => updCond(c.id, { region: e.target.value as Region })}>
                          {COND_META[c.kind].regions.map((r) => (
                            <option key={r} value={r}>
                              {REGION_LABEL[r]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="col-span-2 md:col-span-1">
                        <span className={label}>Note</span>
                        <input
                          className={field}
                          value={c.note ?? ""}
                          onChange={(e) => updCond(c.id, { note: e.target.value })}
                          placeholder={c.kind === "wound" ? "Stage 2" : "optional"}
                        />
                      </label>
                      <button
                        onClick={() => delCond(c.id)}
                        className={`mb-1 h-9 w-9 rounded-full text-[#a1241a] transition hover:bg-[#b42318]/15 ${ring}`}
                        aria-label={`Remove ${condText(c)}`}
                      >
                        ×
                      </button>
                      <p className="col-span-full -mt-1 flex items-center gap-2 text-[11px] text-[#1b1610]/70 font-medium">
                        <span className="h-2 w-2 rounded-full" style={{ background: COND_META[c.kind].color }} />
                        {COND_META[c.kind].hint}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* preview */}
          <aside className="card sticky top-0 flex h-fit flex-col items-center p-5 bg-[#fbf5e2]">
            <p className="eyebrow self-start">Live anatomy preview</p>
            <BodyPreview ps={ps} pose={0} />
            <div className="mt-3 w-full text-xs">
              <p className="eyebrow mb-1.5">Turn plan</p>
              {ps.poses.map((p, i) => (
                <div key={p.name} className="flex items-center justify-between border-b border-[#1b1610]/10 py-1.5 last:border-0">
                  <span className="font-medium">{p.name}</span>
                  {ps.allowed[i] ? (
                    <span className="font-semibold text-[#1a623c]">Allowed</span>
                  ) : (
                    <span className="max-w-[55%] truncate text-right font-semibold text-[#9f1c13]" title={ps.why[i] ?? ""}>
                      Avoid: {ps.why[i]}
                    </span>
                  )}
                </div>
              ))}
              {ps.noSafe && (
                <p className="mt-2 rounded-lg bg-[#b42318]/12 px-2.5 py-1.5 font-semibold text-[#a1241a]">
                  No safe lateral turn position. Request alternating air mattress.
                </p>
              )}
            </div>
          </aside>
        </div>

        {/* footer */}
        <div className="flex items-center justify-between gap-3 border-t border-[#1b1610]/15 bg-[#f6ebd0] px-8 py-4">
          <div>
            {initial && onDelete && (
              confirmDel ? (
                <span className="flex items-center gap-3 text-sm">
                  Discharge {initial.name.split(" ")[0]}?
                  <button onClick={() => onDelete(initial.id)} className={`rounded-full bg-[#b42318] px-4 py-1.5 text-xs font-semibold text-white ${ring}`}>
                    Yes, discharge
                  </button>
                  <button onClick={() => setConfirmDel(false)} className={`text-xs underline ${ring}`}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button onClick={() => setConfirmDel(true)} className={`text-sm text-[#a1241a] underline decoration-[#a1241a]/40 underline-offset-4 ${ring}`}>
                  Discharge patient
                </button>
              )
            )}
          </div>
          <div className="flex items-center gap-3">
            {touched && !valid && <span className="text-xs font-semibold text-[#a1241a]">Fix highlighted fields</span>}
            <button onClick={onClose} className={`btn-ghost rounded-full px-5 py-2.5 text-sm font-semibold ${ring}`}>
              Cancel
            </button>
            <button id="pf-save" onClick={save} className={`btn-ink rounded-full px-6 py-2.5 text-sm font-semibold ${ring}`}>
              {initial ? "Save changes" : "Admit patient"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* top-down body sketch */
export function BodyPreview({ ps, pose, size = 230 }: { ps: ReturnType<typeof buildPoses>; pose: number; size?: number }) {
  const P = ps.poses[pose];
  const S = size;
  const W = S * 0.6;
  const X = (x: number) => W / 2 + x * S;
  const Y = (y: number) => 8 + y * (S - 16);
  return (
    <svg viewBox={`0 0 ${W} ${S}`} width={W} height={S} className="mt-2" aria-label="Body map preview">
      {P.caps.map((c, i) => (
        <line
          key={i}
          x1={X(c.ax)}
          y1={Y(c.ay)}
          x2={X(c.bx)}
          y2={Y(c.by)}
          stroke="rgba(27,22,16,0.18)"
          strokeWidth={c.r * 2 * S}
          strokeLinecap="round"
        />
      ))}
      {P.blobs.map((b, i) => (
        <circle key={i} cx={X(b.x)} cy={Y(b.y)} r={Math.max(2.5, b.s * S * 0.9)} fill={`rgba(206,48,40,${Math.min(0.85, b.p / 120)})`} />
      ))}
      {ps.overlays[pose].map((o, i) => (
        <g key={i}>
          {o.pts && (
            <polyline
              points={o.pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ")}
              fill="none"
              stroke={o.color}
              strokeWidth={10}
              strokeOpacity={0.25}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {o.pts && (
            <polyline
              points={o.pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ")}
              fill="none"
              stroke={o.color}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              strokeLinecap="round"
            />
          )}
          {o.cap && (
            <line
              x1={X(o.cap.ax)}
              y1={Y(o.cap.ay)}
              x2={X(o.cap.bx)}
              y2={Y(o.cap.by)}
              stroke={o.color}
              strokeOpacity={0.35}
              strokeWidth={o.cap.r * 2 * S}
              strokeLinecap="round"
            />
          )}
          <circle cx={X(o.x)} cy={Y(o.y)} r={5} fill="#fffaf0" stroke={o.color} strokeWidth={2} />
        </g>
      ))}
    </svg>
  );
}
