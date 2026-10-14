"use client";
import { useState } from "react";
import { CRIT, HIST, MAX_V, WOUND_LIMIT, condText, initials, nextPoseIdx, riskOf, type Patient, type PoseSet } from "../lib/model";
import { alertsFor, urgency, type Track } from "../lib/ward";

const ring =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1b1610]";

const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
const fmtHM = (min: number) => `${pad(min / 60)}:${pad(min % 60)}`;

export default function WardDashboard({
  roster,
  tracks,
  poseSets,
  focusId,
  colorOf,
  onOpen,
  onTurn,
  onAdd,
  onEdit,
  onClose,
}: {
  roster: Patient[];
  tracks: Record<string, Track>;
  poseSets: Record<string, PoseSet>;
  focusId: string | null;
  colorOf: (v: number) => string;
  onOpen: (id: string) => void;
  onTurn: (id: string) => void;
  onAdd: () => void;
  onEdit: (id: string) => void;
  onClose: () => void;
}) {
  const [sort, setSort] = useState<"urgent" | "bed">("urgent");

  const rows = roster
    .filter((p) => tracks[p.id] && poseSets[p.id])
    .map((p) => {
      const t = tracks[p.id];
      const ps = poseSets[p.id];
      const remaining = p.interval - t.minInPos;
      const woundHot = t.wounds.some((w) => w.loaded && w.v >= WOUND_LIMIT);
      return {
        p,
        t,
        ps,
        remaining,
        overdue: remaining <= 0,
        critical: t.peak >= CRIT || woundHot,
        woundHot,
        alerts: alertsFor(p, t, ps),
        u: urgency(p, t, ps),
      };
    })
    .sort((a, b) => (sort === "urgent" ? b.u - a.u : a.p.bed.localeCompare(b.p.bed)));

  const stats = [
    { k: "Patients on ward", v: rows.length, c: "#1b1610" },
    { k: "Critical now", v: rows.filter((r) => r.critical).length, c: "#a1241a" },
    { k: "Overdue turns", v: rows.filter((r) => r.overdue).length, c: "#a1241a" },
    { k: "Due within 20 min", v: rows.filter((r) => !r.overdue && r.remaining <= 20).length, c: "#8a5a06" },
    { k: "Wounds under load", v: rows.filter((r) => r.woundHot).length, c: "#c2410c" },
  ];

  return (
    <div className="ward-view-bg absolute inset-0 z-50 flex flex-col overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="ward-title">
      <div className="relative mx-auto flex h-full w-full max-w-[1540px] flex-col px-6 py-6 md:px-10">
        {/* header */}
        <header className="rise flex flex-wrap items-end justify-between gap-4 border-b border-[#1b1610]/15 pb-4">
          <div>
            <p className="eyebrow flex items-center gap-2">
              <span className="dot-live h-2.5 w-2.5 rounded-full bg-[#1f6b43]" /> Live Ward Dashboard · All Beds
            </p>
            <h2 id="ward-title" className="font-display mt-1 text-[clamp(40px,4.5vw,64px)] leading-[0.95]">
              Ward overview
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <div className="seg" role="group" aria-label="Sort">
              <button className={sort === "urgent" ? "on" : ""} onClick={() => setSort("urgent")}>
                Most urgent
              </button>
              <button className={sort === "bed" ? "on" : ""} onClick={() => setSort("bed")}>
                By bed
              </button>
            </div>
            <button id="ward-add" onClick={onAdd} className={`btn-ink rounded-full px-5 py-2.5 text-sm font-semibold ${ring}`}>
              + Add patient
            </button>
            <button
              onClick={onClose}
              className={`btn-ghost flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold ${ring}`}
              aria-label="View mattress pressure map"
            >
              <span>Close to Bed Map</span>
              <span className="font-bold">→</span>
            </button>
          </div>
        </header>

        {/* stats */}
        <div className="rise mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {stats.map((s) => (
            <div key={s.k} className="card px-5 py-3.5">
              <p className="eyebrow">{s.k}</p>
              <p className="font-display tnum mt-1 text-4xl leading-none" style={{ color: s.v > 0 ? s.c : "rgba(27,22,16,0.35)" }}>
                {s.v}
              </p>
            </div>
          ))}
        </div>

        {/* cards */}
        <div className="mt-4 grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(330px,1fr))] gap-4 overflow-y-auto pb-6 pr-1 [scrollbar-width:thin]">
          {rows.map((r, idx) => {
            const risk = riskOf(r.p.braden);
            const frac = Math.min(1, r.t.minInPos / r.p.interval);
            const ringC = r.overdue ? "#b42318" : r.remaining <= 20 ? "#c2760a" : "#1f6b43";
            const next = r.ps.poses[nextPoseIdx(r.t.pose, r.ps.allowed)].name;
            const hot = [...r.t.zones].sort((a, b) => b.v - a.v)[0];
            const pts = r.t.hist.map((v, i) => `${((i / (HIST - 1)) * 200).toFixed(1)},${(40 - (Math.min(v, MAX_V) / MAX_V) * 40).toFixed(1)}`);
            const top = r.alerts[0];
            return (
              <article
                key={r.p.id}
                className={`card ward-card rise relative flex flex-col p-5 ${r.critical ? "is-critical" : ""} ${focusId === r.p.id ? "is-focus" : ""}`}
                style={{ animationDelay: `${40 + idx * 25}ms` }}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="font-display flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 bg-[#f6ebd0] text-lg font-medium"
                    style={{ borderColor: risk.color }}
                  >
                    {initials(r.p.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display truncate text-2xl leading-tight">{r.p.name}</h3>
                    <p className="truncate text-xs text-[#1b1610]/70 font-medium">
                      Bed {r.p.bed} · {r.p.age}y {r.p.sex.toLowerCase()} · Braden <span style={{ color: risk.color }} className="font-bold">{r.p.braden}</span>
                    </p>
                  </div>
                  <span
                    className={`chip ${r.critical ? "chip-crit" : r.t.peak >= 50 || r.remaining <= 20 ? "chip-warn" : "chip-ok"}`}
                  >
                    {r.critical ? "Critical" : r.overdue ? "Overdue" : r.t.peak >= 50 ? "Elevated" : "Stable"}
                  </span>
                </div>

                <div className="mt-4 flex items-center gap-4">
                  <div className="relative h-[72px] w-[72px] shrink-0">
                    <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
                      <circle cx="40" cy="40" r="33" fill="none" stroke="rgba(27,22,16,0.12)" strokeWidth="6" />
                      <circle
                        cx="40"
                        cy="40"
                        r="33"
                        fill="none"
                        stroke={ringC}
                        strokeWidth="6"
                        strokeLinecap="round"
                        strokeDasharray={`${frac * 207} 207`}
                        style={{ transition: "stroke-dasharray .4s" }}
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className={`font-display tnum text-lg leading-none ${r.overdue ? "text-[#a1241a] font-bold" : ""}`}>
                        {r.overdue ? "Late" : fmtHM(r.remaining)}
                      </span>
                      <span className="text-[9px] font-semibold text-[#1b1610]/55">{r.overdue ? `+${Math.round(-r.remaining)}m` : "to turn"}</span>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-display tnum text-[38px] leading-none" style={{ color: colorOf(r.t.peak) }}>
                        {Math.round(r.t.peak)}
                      </span>
                      <span className="text-xs text-[#1b1610]/60 font-semibold">mmHg peak</span>
                    </div>
                    <p className="truncate text-xs text-[#1b1610]/75 font-medium mt-0.5">
                      {hot ? `${hot.name}` : "-"} · {r.ps.poses[r.t.pose].name}
                    </p>
                    <svg viewBox="0 0 200 40" preserveAspectRatio="none" className="mt-1.5 h-7 w-full">
                      <line x1="0" x2="200" y1={40 - (CRIT / MAX_V) * 40} y2={40 - (CRIT / MAX_V) * 40} stroke="#b42318" strokeOpacity=".5" strokeDasharray="3 3" />
                      {pts.length > 1 && (
                        <polyline points={pts.join(" ")} fill="none" stroke="#1b1610" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
                      )}
                    </svg>
                  </div>
                </div>

                {r.p.conditions.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {r.p.conditions.map((c) => (
                      <span key={c.id} className="tag">
                        {condText(c)}
                      </span>
                    ))}
                  </div>
                )}

                {top && (
                  <p
                    className="mt-3 rounded-lg bg-[#1b1610]/5 px-2.5 py-1.5 border-l-[3px] text-[13px] leading-snug"
                    style={{ borderColor: top.level === "critical" ? "#b42318" : top.level === "warn" ? "#c2760a" : "#2f7d4f" }}
                  >
                    {top.text}
                  </p>
                )}

                <div className="mt-auto flex items-center gap-2 pt-4">
                  <button
                    onClick={() => onTurn(r.p.id)}
                    className={`btn-ink flex-1 rounded-full px-3 py-2 text-xs font-semibold ${ring}`}
                    title={`Confirm turn to ${next}`}
                  >
                    Turned to {next.replace(" 30°", "")}
                  </button>
                  <button
                    onClick={() => onOpen(r.p.id)}
                    className={`btn-ghost rounded-full px-3.5 py-2 text-xs font-semibold ${ring}`}
                  >
                    Open Bed Map
                  </button>
                  <button
                    onClick={() => onEdit(r.p.id)}
                    className={`btn-ghost h-8 w-8 rounded-full text-xs ${ring}`}
                    aria-label={`Edit ${r.p.name}`}
                    title="Edit details"
                  >
                    ✎
                  </button>
                </div>
              </article>
            );
          })}

          <button
            onClick={onAdd}
            className={`rise flex min-h-[250px] flex-col items-center justify-center rounded-[20px] border-2 border-dashed border-[#1b1610]/25 bg-[#f7ecc8]/70 text-[#1b1610]/70 transition hover:border-[#1b1610]/50 hover:bg-[#f7ecc8] hover:text-[#1b1610] ${ring}`}
          >
            <span className="font-display text-5xl leading-none">+</span>
            <span className="mt-2 text-sm font-semibold">Admit a new patient</span>
          </button>
        </div>
      </div>
    </div>
  );
}
