"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { TEAMS, DRIVERS, RACES, SIMULATION_MODES } from "@/lib/f1Data";
import { simulateSingleRace } from "@/lib/simulationEngine";

const F1_RED = "#E10600";
const BG_DARK = "#080812";
const PANEL_BG = "#0d0d1a";
const PANEL_BORDER = "rgba(255,255,255,0.08)";
const GOLD = "#FFD700";
const SILVER = "#C0C0C0";
const BRONZE = "#CD7F32";
const TOTAL_ROUNDS = 24;
const SEASON = 2026;

// ─── HELPERS ──────────────────────────────────────────────────────────────
function getDriver(drivers, id) { return drivers?.find((d) => d.id === id); }
function getTeam(teams, id) { return teams?.find((t) => t.id === id); }
function getActiveDrivers(drivers) { return drivers.filter((d) => d.status === "active" && d.teamId); }

const GP_RACES = RACES.slice(0, TOTAL_ROUNDS).map((r) => ({ ...r, isSprint: false }));

function buildDriverStandings(raceResults, drivers) {
  const points = {};
  drivers.forEach((d) => (points[d.id] = 0));
  for (const race of raceResults) {
    for (const r of race.results || []) {
      points[r.driverId] = (points[r.driverId] || 0) + (r.points || 0);
    }
  }
  return drivers
    .map((d) => ({ driverId: d.id, teamId: d.teamId, points: points[d.id] || 0 }))
    .sort((a, b) => b.points - a.points);
}

function buildConstructorStandings(raceResults, teams) {
  const points = {};
  teams.forEach((t) => (points[t.id] = 0));
  for (const race of raceResults) {
    for (const r of race.results || []) {
      if (!r.dnf) points[r.teamId] = (points[r.teamId] || 0) + (r.points || 0);
    }
  }
  return teams
    .map((t) => ({ teamId: t.id, points: points[t.id] || 0 }))
    .sort((a, b) => b.points - a.points);
}

// Derive track temp from race location — used for quali display
function getTrackTemp(race, weather) {
  const hot = ["bahrain", "saudi", "australia", "miami", "singapore", "abu dhabi", "qatar", "las vegas"];
  const cool = ["britain", "belgium", "hungary", "austria", "netherlands", "canada", "japan", "china"];
  const loc = (race?.location ?? "").toLowerCase();
  const base = hot.some((h) => loc.includes(h)) ? 38 : cool.some((c) => loc.includes(c)) ? 18 : 28;
  const wetMod = weather === "wet" ? -8 : weather === "mixed" ? -4 : 0;
  return base + wetMod + Math.round((Math.random() - 0.5) * 4);
}

// Generate Q1/Q2/Q3 lap times from qualifying order
// Returns { q1: [{driverId, time, eliminated}], q2: [...], q3: [...] }
function buildQualifyingData(qualifyingOrder, drivers, teams, weather, seed) {
  if (!qualifyingOrder || qualifyingOrder.length === 0) return { q1: [], q2: [], q3: [] };

  // Deterministic pseudo-random using driver position as seed
  const rng = (i, offset = 0) => {
    const x = Math.sin(i * 127.1 + offset * 311.7 + seed * 0.01) * 43758.5453;
    return x - Math.floor(x);
  };

  const baseTime = weather === "wet" ? 105.0 : weather === "mixed" ? 98.5 : 88.0;
  const spread = 3.2; // seconds spread across 20 drivers

  // Assign a raw quali pace to each driver based on their final position + small noise
  const driverTimes = {};
  qualifyingOrder.forEach((id, i) => {
    const noise = (rng(i, 1) - 0.5) * 0.35;
    driverTimes[id] = baseTime + (i / (qualifyingOrder.length - 1)) * spread + noise;
  });

  const fmt = (secs) => {
    const m = Math.floor(secs / 60);
    const s = (secs % 60).toFixed(3).padStart(6, "0");
    return m + ":" + s;
  };

  // Q1: all 20, bottom 5 eliminated
  const q1Order = [...qualifyingOrder].sort((a, b) => driverTimes[a] - driverTimes[b]);
  const q1Cutoff = q1Order[14]; // 15th place is safe
  const q1 = q1Order.map((id, i) => ({
    driverId: id,
    time: fmt(driverTimes[id] + (rng(i, 10) - 0.5) * 0.2),
    eliminated: i >= 15,
    pos: i + 1,
  }));

  // Q2: top 15, bottom 5 eliminated
  const q2Drivers = q1Order.slice(0, 15);
  const q2Order = [...q2Drivers].sort((a, b) => driverTimes[a] - driverTimes[b]);
  const q2 = q2Order.map((id, i) => ({
    driverId: id,
    time: fmt(driverTimes[id] - 0.25 + (rng(i, 20) - 0.5) * 0.18),
    eliminated: i >= 10,
    pos: i + 1,
  }));

  // Q3: top 10
  const q3Drivers = q2Order.slice(0, 10);
  const q3Order = [...q3Drivers].sort((a, b) => driverTimes[a] - driverTimes[b]);
  const q3 = q3Order.map((id, i) => ({
    driverId: id,
    time: fmt(driverTimes[id] - 0.55 + (rng(i, 30) - 0.5) * 0.15),
    eliminated: false,
    pos: i + 1,
  }));

  return { q1, q2, q3 };
}

// ─── SETUP SCREEN ─────────────────────────────────────────────────────────
function SetupScreen({ onBegin, simulationMode, setSimulationMode, focusDriverId, setFocusDriverId }) {
  const drivers = getActiveDrivers(DRIVERS);
  const realistic = SIMULATION_MODES.realistic;
  const wildcard = SIMULATION_MODES.wildcard;
  const isRealistic = simulationMode === realistic;

  return (
    <div className="min-h-screen text-white" style={{ background: BG_DARK }}>
      <div className="max-w-2xl mx-auto px-6 py-16 text-center">
        <h1 className="text-4xl md:text-5xl font-black uppercase tracking-wider" style={{ fontFamily: "var(--font-titillium)" }}>
          SINGLE SEASON
        </h1>
        <p className="mt-3 text-lg text-white/70">Follow every race of the {SEASON} season</p>
        <div className="mt-6 h-px w-24 mx-auto" style={{ background: F1_RED }} />

        <div className="mt-12 space-y-10 text-left">
          <div>
            <p className="text-sm text-white/60 uppercase tracking-wider mb-3">Simulation mode</p>
            <div className="grid grid-cols-2 gap-4">
              {[
                { mode: realistic, label: "Realistic", active: isRealistic },
                { mode: wildcard, label: "Wildcard", active: !isRealistic },
              ].map(({ mode, label, active }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setSimulationMode(mode)}
                  className="text-left p-5 rounded-lg border-2 transition-all"
                  style={{
                    background: PANEL_BG,
                    borderColor: active ? (label === "Wildcard" ? F1_RED : "#fff") : "rgba(255,255,255,0.15)",
                  }}
                >
                  <p className="font-bold text-white">{label}</p>
                  <p className="text-sm text-white/70 mt-1">{mode.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm text-white/60 uppercase tracking-wider mb-3">Focus driver</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {drivers.map((d) => {
                const team = getTeam(TEAMS, d.teamId);
                const selected = focusDriverId === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setFocusDriverId(d.id)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm border transition-all"
                    style={{
                      background: selected ? F1_RED : PANEL_BG,
                      borderColor: selected ? F1_RED : "rgba(255,255,255,0.2)",
                      color: "#fff",
                    }}
                  >
                    <span>{d.flag}</span>
                    <span>{d.name.split(" ").pop()}</span>
                    {team && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: team.color }} />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onBegin}
          className="mt-14 w-full py-4 font-black uppercase tracking-wider text-white rounded transition-all hover:opacity-95"
          style={{ background: F1_RED }}
        >
          BEGIN SEASON
        </button>
      </div>
    </div>
  );
}

// ─── QUALIFYING SESSION PANEL ──────────────────────────────────────────────
function QualiSessionPanel({ label, rows, drivers, teams, focusDriverId, isQ3 }) {
  return (
    <div className="rounded-lg border overflow-hidden" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
      <div className="px-4 py-2 border-b flex items-center gap-3" style={{ borderColor: PANEL_BORDER }}>
        <span className="text-xs font-black tracking-widest" style={{ color: F1_RED }}>{label}</span>
        {isQ3 && <span className="text-xs text-white/40">Pole position shoot-out</span>}
      </div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row) => {
            const d = getDriver(drivers, row.driverId);
            const t = d ? getTeam(teams, d.teamId) : null;
            const isFocus = row.driverId === focusDriverId;
            const isElim = row.eliminated;
            const isPole = isQ3 && row.pos === 1;
            return (
              <tr
                key={row.driverId}
                className="border-b"
                style={{
                  borderColor: PANEL_BORDER,
                  background: isPole
                    ? "rgba(255,215,0,0.08)"
                    : isFocus
                    ? "rgba(225,6,0,0.12)"
                    : isElim
                    ? "rgba(255,255,255,0.02)"
                    : undefined,
                  opacity: isElim ? 0.5 : 1,
                }}
              >
                <td className="pl-4 py-2 w-8 text-white/50 font-mono text-xs">{row.pos}</td>
                <td className="py-2 w-3">
                  {t && <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: t.color }} />}
                </td>
                <td className="py-2 pl-2 text-white font-medium">
                  {d?.flag} {d?.name ?? row.driverId}
                </td>
                <td className="py-2 text-white/50 text-xs">{t?.name ?? ""}</td>
                <td className="pr-4 py-2 text-right font-mono text-xs" style={{ color: isPole ? GOLD : isElim ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.8)" }}>
                  {isPole && "🏆 "}{row.time}
                </td>
                {isElim && (
                  <td className="pr-3 py-2 w-8">
                    <span className="text-xs px-1.5 py-0.5 rounded font-bold" style={{ background: "rgba(225,6,0,0.25)", color: F1_RED }}>OUT</span>
                  </td>
                )}
                {!isElim && <td className="w-8" />}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── LAP CHART SVG with driver pill toggles ───────────────────────────────
function InteractiveLapChart({ positionCheckpoints, qualifyingOrder, results, drivers, teams, focusDriverId, numCheckpoints }) {
  const allIds = qualifyingOrder;
  const [hidden, setHidden] = useState(new Set());

  const toggle = (id) => setHidden((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const showAll = () => setHidden(new Set());
  const hideAll = () => setHidden(new Set(allIds.filter((id) => id !== focusDriverId)));

  const getTeamColor = (id) => getTeam(teams, getDriver(drivers, id)?.teamId)?.color ?? "#666";

  const width = 760;
  const height = 240;
  const pad = { top: 16, right: 16, bottom: 28, left: 32 };
  const cw = width - pad.left - pad.right;
  const ch = height - pad.top - pad.bottom;
  const maxPos = 22;

  const lines = allIds.map((id) => {
    const cps = positionCheckpoints[id] || [];
    const pts = cps.map((pos, i) => {
      const x = pad.left + (i / (numCheckpoints - 1)) * cw;
      const y = pad.top + (Math.min(pos, maxPos) / maxPos) * ch;
      return [x, y];
    });
    return { id, pts, color: getTeamColor(id), isFocus: id === focusDriverId };
  });

  return (
    <div>
      {/* Pills */}
      <div className="px-4 pt-3 pb-2 border-b flex flex-wrap gap-1.5 items-center" style={{ borderColor: PANEL_BORDER }}>
        <button
          type="button"
          onClick={showAll}
          className="text-xs px-2 py-1 rounded border transition-all"
          style={{ borderColor: "rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.6)", background: "transparent" }}
        >
          All
        </button>
        <button
          type="button"
          onClick={hideAll}
          className="text-xs px-2 py-1 rounded border transition-all mr-1"
          style={{ borderColor: "rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.6)", background: "transparent" }}
        >
          Focus only
        </button>
        {allIds.map((id) => {
          const d = getDriver(drivers, id);
          const color = getTeamColor(id);
          const isOn = !hidden.has(id);
          const isFocus = id === focusDriverId;
          return (
            <button
              key={id}
              type="button"
              onClick={() => toggle(id)}
              className="text-xs px-2 py-1 rounded-full border transition-all font-medium"
              style={{
                borderColor: isOn ? color : "rgba(255,255,255,0.15)",
                background: isOn ? color + "28" : "transparent",
                color: isOn ? "#fff" : "rgba(255,255,255,0.3)",
                outline: isFocus ? ("2px solid " + color) : undefined,
                outlineOffset: "1px",
              }}
            >
              {d?.short ?? id}
            </button>
          );
        })}
      </div>
      {/* SVG */}
      <div className="p-4" style={{ height: "280px" }}>
        <svg width="100%" height={height} viewBox={"0 0 " + width + " " + height} className="overflow-visible">
          {[1, 5, 10, 15, 20].map((p) => (
            <g key={p}>
              <line
                x1={pad.left} y1={pad.top + (p / maxPos) * ch}
                x2={pad.left + cw} y2={pad.top + (p / maxPos) * ch}
                stroke="rgba(255,255,255,0.06)" strokeWidth="1"
              />
              <text x={pad.left - 6} y={pad.top + (p / maxPos) * ch + 4} fill="rgba(255,255,255,0.4)" fontSize="9" textAnchor="end">{p}</text>
            </g>
          ))}
          {[0, 5, 10, 15, 19].map((i) => (
            <text
              key={i}
              x={pad.left + (i / (numCheckpoints - 1)) * cw}
              y={height - 6}
              fill="rgba(255,255,255,0.4)"
              fontSize="9"
              textAnchor="middle"
            >
              {i === 0 ? "START" : i === 19 ? "FINISH" : "L" + Math.round((i / 19) * 57)}
            </text>
          ))}
          {lines.map(({ id, pts, color, isFocus }) => {
            if (hidden.has(id) || pts.length < 2) return null;
            const d = "M " + pts.map((p) => p[0] + "," + p[1]).join(" L ");
            const dnf = results.find((r) => r.driverId === id)?.dnf;
            const lastPt = pts[pts.length - 1];
            return (
              <g key={id}>
                <path d={d} fill="none" stroke={color} strokeWidth={isFocus ? 3 : 1.2} strokeOpacity={isFocus ? 1 : 0.65} />
                {dnf && lastPt && (
                  <circle cx={lastPt[0]} cy={lastPt[1]} r={isFocus ? 5 : 3} fill="none" stroke="#e11" strokeWidth="1.5" />
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ─── TYRE STRATEGY ────────────────────────────────────────────────────────
function TyreStrategy({ tyreStints, results, drivers, teams, focusDriverId }) {
  const TYRE_COLORS = {
    soft: "#E10600",
    medium: "#FFD700",
    hard: "#999",
    intermediate: "#0a0",
    wet: "#06f",
  };
  const displayDrivers = [
    ...(results || []).slice(0, 10).map((r) => r.driverId),
    ...(focusDriverId && !(results || []).slice(0, 10).find((r) => r.driverId === focusDriverId) ? [focusDriverId] : []),
  ];

  return (
    <div className="p-4 space-y-2">
      {displayDrivers.map((id) => {
        const stints = tyreStints[id] || [];
        const d = getDriver(drivers, id);
        const total = stints.reduce((s, x) => s + x.laps, 0);
        const isFocus = id === focusDriverId;
        return (
          <div key={id} className="flex items-center gap-3">
            <span className="text-sm w-28 truncate" style={{ color: isFocus ? "#fff" : "rgba(255,255,255,0.7)", fontWeight: isFocus ? 600 : 400 }}>
              {d?.name ?? id}
            </span>
            <div className="flex-1 flex h-6 rounded overflow-hidden" style={{ maxWidth: 380 }}>
              {stints.map((st, i) => {
                const w = total > 0 ? (st.laps / total) * 100 : 0;
                const letter = st.compound.charAt(0).toUpperCase();
                return (
                  <div
                    key={i}
                    className="flex items-center justify-center text-xs font-black text-black"
                    style={{ width: w + "%", minWidth: "20px", background: TYRE_COLORS[st.compound] ?? "#555" }}
                    title={st.compound + " " + st.laps + " laps"}
                  >
                    {w > 12 ? letter : ""}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── RACE RESULTS TABLE (full 22) ─────────────────────────────────────────
function RaceResultsTable({ results, drivers, teams, focusDriverId }) {
  const sorted = [...(results || [])].sort((a, b) => {
    if (a.dnf && !b.dnf) return 1;
    if (!a.dnf && b.dnf) return -1;
    return (a.position ?? 99) - (b.position ?? 99);
  });

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wider border-b" style={{ borderColor: PANEL_BORDER, color: "rgba(255,255,255,0.4)" }}>
          <th className="pl-4 py-2 w-10">Pos</th>
          <th className="py-2 w-4" />
          <th className="py-2">Driver</th>
          <th className="py-2">Team</th>
          <th className="py-2 text-right">Gap</th>
          <th className="pr-4 py-2 text-right w-12">Pts</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => {
          const d = getDriver(drivers, r.driverId);
          const t = getTeam(teams, r.teamId);
          const medal = r.position === 1 ? GOLD : r.position === 2 ? SILVER : r.position === 3 ? BRONZE : undefined;
          const isFocus = r.driverId === focusDriverId;
          return (
            <tr
              key={r.driverId}
              className="border-b"
              style={{
                borderColor: PANEL_BORDER,
                background: isFocus ? "rgba(225,6,0,0.12)" : r.dnf ? "rgba(255,255,255,0.01)" : undefined,
              }}
            >
              <td className="pl-4 py-2 font-black text-sm" style={{ color: r.dnf ? "rgba(255,255,255,0.2)" : medal ?? "rgba(255,255,255,0.8)" }}>
                {r.dnf ? "DNF" : r.position}
              </td>
              <td className="py-2 pr-1">
                {t && <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: t.color }} />}
              </td>
              <td className="py-2 font-medium" style={{ color: r.dnf ? "rgba(255,255,255,0.4)" : "#fff" }}>
                {d?.flag} {d?.name ?? r.driverId}
                {r.dnf && <span className="ml-2 text-xs text-red-400">{r.dnfReason ?? "DNF"}</span>}
              </td>
              <td className="py-2 text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>{t?.name ?? ""}</td>
              <td className="py-2 text-right text-xs font-mono" style={{ color: "rgba(255,255,255,0.6)" }}>
                {r.dnf ? "" : r.gap ?? ""}
              </td>
              <td className="pr-4 py-2 text-right font-bold" style={{ color: r.points > 0 ? "#fff" : "rgba(255,255,255,0.3)" }}>
                {r.dnf ? "" : (r.points ?? 0)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── RACE REVEAL SCREEN (dashboard) ───────────────────────────────────────
function RaceRevealScreen({
  raceResult, round, race, driverStandings, constructorStandings,
  previousRaceWinner, focusDriverId, seasonResults, onNextRace, onFinishSeason,
}) {
  const drivers = getActiveDrivers(DRIVERS);
  const [activeTab, setActiveTab] = useState("qualifying");
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [radioWinner, setRadioWinner] = useState(null);
  const [radioFocus, setRadioFocus] = useState(null);
  const [radioLoading, setRadioLoading] = useState(true);
  const trackTempRef = useRef(null);

  // Compute track temp once per race
  if (trackTempRef.current === null) {
    trackTempRef.current = getTrackTemp(race, raceResult?.weather);
  }
  const trackTemp = trackTempRef.current;

  // Reset tab + fetch AI on new race
  useEffect(() => {
    setActiveTab("qualifying");
    trackTempRef.current = getTrackTemp(race, raceResult?.weather);
    if (!raceResult) return;

    setReportLoading(true);
    setRadioLoading(true);
    setReport(null);
    setRadioWinner(null);
    setRadioFocus(null);

    fetch("/api/race-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        raceResult, qualifyingOrder: raceResult.qualifyingOrder || [],
        season: SEASON, round, totalRounds: TOTAL_ROUNDS,
        driverStandings, constructorStandings, previousRaceWinner,
        focusDriverId, drivers, teams: TEAMS, mode: "single",
      }),
    })
      .then((r) => r.json())
      .then((data) => setReport(data.commentary || ""))
      .catch(() => setReport("Race report unavailable."))
      .finally(() => setReportLoading(false));

    const winner = raceResult.results?.[0];
    const focusResult = focusDriverId ? raceResult.results?.find((r) => r.driverId === focusDriverId) : null;
    const winnerDriver = winner ? getDriver(drivers, winner.driverId) : null;
    const focusDriver = focusDriverId ? getDriver(drivers, focusDriverId) : null;
    const winnerTeam = winner ? getTeam(TEAMS, winner.teamId) : null;
    const focusTeam = focusDriver ? getTeam(TEAMS, focusDriver.teamId) : null;

    const promises = [];
    if (winnerDriver && winnerTeam) {
      promises.push(
        fetch("/api/team-radio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            driverName: winnerDriver.name, teamName: winnerTeam.name,
            position: 1, raceName: race?.name ?? "Grand Prix",
            isWin: true, isDNF: false, season: SEASON,
          }),
        })
          .then((r) => r.json())
          .then((data) => setRadioWinner(data.radio))
      );
    }
    if (focusDriverId && focusDriver && focusTeam && (!winnerDriver || winnerDriver.id !== focusDriverId)) {
      promises.push(
        fetch("/api/team-radio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            driverName: focusDriver.name, teamName: focusTeam.name,
            position: focusResult?.position, raceName: race?.name ?? "Grand Prix",
            isWin: false, isDNF: focusResult?.dnf ?? false,
            isFocusDriver: true, season: SEASON,
          }),
        })
          .then((r) => r.json())
          .then((data) => setRadioFocus(data.radio))
      );
    }
    Promise.all(promises).finally(() => setRadioLoading(false));
  }, [raceResult?.results, round]);

  if (!raceResult) return null;

  const winner = raceResult.results?.[0];
  const winnerDriver = winner ? getDriver(drivers, winner.driverId) : null;
  const winnerTeam = winner ? getTeam(TEAMS, winner.teamId) : null;
  const qualifyingOrder = raceResult.qualifyingOrder || [];
  const positionCheckpoints = raceResult.positionCheckpoints || {};
  const tyreStints = raceResult.tyreStints || {};
  const overtakeCount = raceResult.overtakeCount || {};
  const driverOfDayId = raceResult.driverOfDay;
  const driverOfDay = driverOfDayId ? getDriver(drivers, driverOfDayId) : null;

  const leader = driverStandings[0];
  const leaderName = leader ? getDriver(drivers, leader.driverId)?.name : "—";
  const leaderPts = leader?.points ?? 0;

  const qualiData = buildQualifyingData(qualifyingOrder, drivers, TEAMS, raceResult.weather, round * 100);
  const numCheckpoints = 20;

  const TABS = [
    { id: "qualifying", label: "QUALIFYING" },
    { id: "race", label: "RACE" },
    { id: "analysis", label: "ANALYSIS" },
  ];

  return (
    <div className="min-h-screen text-white" style={{ background: BG_DARK, fontFamily: "var(--font-titillium)" }}>

      {/* ── STICKY TOP STATS BAR ── */}
      <div
        className="sticky top-0 z-30 border-b"
        style={{ background: BG_DARK + "f0", borderColor: PANEL_BORDER, backdropFilter: "blur(8px)" }}
      >
        {/* Site nav row */}
        <div className="max-w-5xl mx-auto px-4 pt-2 pb-1 flex items-center justify-between">
          <Link href="/" className="text-white/40 text-xs hover:text-white/70 transition-colors">← Jake's Tools</Link>
          <Link
            href="/simulator"
            className="text-xs font-bold px-3 py-1 rounded border transition-all hover:bg-white/10"
            style={{ borderColor: "rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.6)" }}
          >
            Franchise Mode →
          </Link>
        </div>
        {/* Race header row */}
        <div className="max-w-5xl mx-auto px-4 py-2 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-white/40 text-xs uppercase tracking-wider shrink-0">R{round}/{TOTAL_ROUNDS}</span>
            <span className="text-white font-black text-sm uppercase tracking-wide truncate">{race?.flag} {race?.name ?? "Grand Prix"}</span>
          </div>

          <div className="flex items-center gap-3 ml-auto flex-wrap">
            {/* Weather pill */}
            <span
              className="text-xs font-bold px-2 py-0.5 rounded uppercase tracking-wide"
              style={{
                background: raceResult.weather === "wet" ? "rgba(0,100,255,0.25)" : raceResult.weather === "mixed" ? "rgba(255,150,0,0.25)" : "rgba(255,255,255,0.1)",
                color: raceResult.weather === "wet" ? "#88aaff" : raceResult.weather === "mixed" ? "#ffaa44" : "rgba(255,255,255,0.7)",
              }}
            >
              {raceResult.weather ?? "DRY"}
            </span>

            {/* Track temp */}
            <span className="text-xs text-white/50">
              🌡 {trackTemp}°C
            </span>

            {/* Safety car badge */}
            {raceResult.safetyCarDeployed && (
              <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: "rgba(255,200,0,0.2)", color: "#ffcc00" }}>SC</span>
            )}

            {/* Championship leader */}
            <span className="text-xs text-white/50 hidden sm:block">
              P1 Championship: <span className="text-white font-medium">{leaderName}</span> · {leaderPts} pts
            </span>
          </div>
        </div>

        {/* Season progress bar */}
        <div className="max-w-5xl mx-auto px-4 pb-2">
          <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: ((round / TOTAL_ROUNDS) * 100) + "%", background: F1_RED }}
            />
          </div>
        </div>

        {/* Tab bar */}
        <div className="max-w-5xl mx-auto px-4 flex gap-0 border-t" style={{ borderColor: PANEL_BORDER }}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className="px-6 py-3 text-xs font-black tracking-widest uppercase transition-all relative"
              style={{ color: activeTab === tab.id ? "#fff" : "rgba(255,255,255,0.4)" }}
            >
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t" style={{ background: F1_RED }} />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── TAB CONTENT ── */}
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">

        {/* ── QUALIFYING TAB ── */}
        {activeTab === "qualifying" && (
          <div className="space-y-4">
            {/* Track conditions banner */}
            <div
              className="rounded-lg px-5 py-4 flex flex-wrap gap-6 border"
              style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}
            >
              <div>
                <p className="text-xs text-white/40 uppercase tracking-wider">Circuit</p>
                <p className="text-white font-bold mt-0.5">{race?.location ?? race?.name ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-white/40 uppercase tracking-wider">Conditions</p>
                <p className="font-bold mt-0.5 capitalize" style={{
                  color: raceResult.weather === "wet" ? "#88aaff" : raceResult.weather === "mixed" ? "#ffaa44" : "rgba(255,255,255,0.9)"
                }}>
                  {raceResult.weather ?? "Dry"}
                </p>
              </div>
              <div>
                <p className="text-xs text-white/40 uppercase tracking-wider">Track Temp</p>
                <p className="text-white font-bold mt-0.5">{trackTemp}°C</p>
              </div>
              <div>
                <p className="text-xs text-white/40 uppercase tracking-wider">Air Temp</p>
                <p className="text-white font-bold mt-0.5">{Math.round(trackTemp * 0.72)}°C</p>
              </div>
              <div>
                <p className="text-xs text-white/40 uppercase tracking-wider">Date</p>
                <p className="text-white font-bold mt-0.5">{race?.date ?? "—"}</p>
              </div>
            </div>

            {/* Q1, Q2, Q3 panels */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <QualiSessionPanel label="Q1" rows={qualiData.q1} drivers={drivers} teams={TEAMS} focusDriverId={focusDriverId} />
              <QualiSessionPanel label="Q2" rows={qualiData.q2} drivers={drivers} teams={TEAMS} focusDriverId={focusDriverId} />
              <QualiSessionPanel label="Q3" rows={qualiData.q3} drivers={drivers} teams={TEAMS} focusDriverId={focusDriverId} isQ3 />
            </div>
          </div>
        )}

        {/* ── RACE TAB ── */}
        {activeTab === "race" && (
          <div className="space-y-4">
            {/* Race header card */}
            <div
              className="rounded-lg px-5 py-4 border flex flex-wrap gap-4 items-center"
              style={{
                background: winnerTeam?.color ? (winnerTeam.color + "18") : PANEL_BG,
                borderColor: winnerTeam?.color ? (winnerTeam.color + "44") : PANEL_BORDER,
              }}
            >
              <div>
                <p className="text-xs text-white/40 uppercase tracking-wider">Winner</p>
                <p className="text-white font-black text-xl mt-0.5">{winnerDriver?.flag} {winnerDriver?.name ?? "—"}</p>
                <p className="text-xs mt-0.5" style={{ color: winnerTeam?.color ?? "rgba(255,255,255,0.5)" }}>{winnerTeam?.name ?? ""}</p>
              </div>
              {raceResult.results?.[0]?.fastestLap && (
                <div className="ml-auto text-right">
                  <p className="text-xs text-white/40 uppercase tracking-wider">Fastest Lap</p>
                  <p className="text-white font-bold mt-0.5">{raceResult.results[0].fastestLap}</p>
                </div>
              )}
            </div>

            {/* Full results table */}
            <div className="rounded-lg border overflow-hidden" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
              <div className="px-4 py-2.5 border-b" style={{ borderColor: PANEL_BORDER }}>
                <span className="text-xs font-black tracking-widest" style={{ color: F1_RED }}>RACE RESULT</span>
              </div>
              <RaceResultsTable results={raceResult.results} drivers={drivers} teams={TEAMS} focusDriverId={focusDriverId} />
            </div>

            {/* Lap chart */}
            <div className="rounded-lg border overflow-hidden" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
              <div className="px-4 py-2.5 border-b" style={{ borderColor: PANEL_BORDER }}>
                <span className="text-xs font-black tracking-widest" style={{ color: F1_RED }}>LAP CHART</span>
              </div>
              <InteractiveLapChart
                positionCheckpoints={positionCheckpoints}
                qualifyingOrder={qualifyingOrder}
                results={raceResult.results || []}
                drivers={drivers}
                teams={TEAMS}
                focusDriverId={focusDriverId}
                numCheckpoints={numCheckpoints}
              />
            </div>

            {/* Tyre strategy */}
            <div className="rounded-lg border overflow-hidden" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
              <div className="px-4 py-2.5 border-b" style={{ borderColor: PANEL_BORDER }}>
                <span className="text-xs font-black tracking-widest" style={{ color: F1_RED }}>TYRE STRATEGY</span>
              </div>
              <TyreStrategy tyreStints={tyreStints} results={raceResult.results} drivers={drivers} teams={TEAMS} focusDriverId={focusDriverId} />
            </div>

            {/* Championship standings shift */}
            <ChampionshipShift driverStandings={driverStandings} seasonResults={seasonResults} drivers={drivers} round={round} />
          </div>
        )}

        {/* ── ANALYSIS TAB ── */}
        {activeTab === "analysis" && (
          <div className="space-y-4">
            {/* Driver of the day */}
            {driverOfDay && (() => {
              const dotdTeam = getTeam(TEAMS, driverOfDay.teamId);
              const dotdResult = raceResult.results?.find((r) => r.driverId === driverOfDayId);
              const dotdQualiPos = qualifyingOrder.indexOf(driverOfDayId) + 1;
              return (
                <div className="rounded-lg p-5 border-l-4 border" style={{ background: PANEL_BG, borderLeftColor: dotdTeam?.color ?? F1_RED, borderColor: PANEL_BORDER }}>
                  <p className="text-xs text-white/40 uppercase tracking-wider">Driver of the Day</p>
                  <p className="text-2xl font-black text-white mt-1">{driverOfDay.flag} {driverOfDay.name}</p>
                  <p className="text-sm mt-1" style={{ color: dotdTeam?.color ?? "rgba(255,255,255,0.6)" }}>{dotdTeam?.name ?? ""}</p>
                  <p className="text-white/70 text-sm mt-2">
                    +{overtakeCount[driverOfDayId] || 0} positions · Started P{dotdQualiPos}, Finished P{dotdResult?.position ?? "—"}
                  </p>
                </div>
              );
            })()}

            {/* Race report */}
            <div className="rounded-lg border overflow-hidden" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
              <div className="px-4 py-2.5 border-b" style={{ borderColor: PANEL_BORDER }}>
                <span className="text-xs font-black tracking-widest" style={{ color: F1_RED }}>RACE REPORT</span>
              </div>
              <div className="p-5 pl-9 relative" style={{ background: "#0e0e22" }}>
                <span className="absolute left-4 top-4 text-3xl leading-none font-black" style={{ color: F1_RED }}>"</span>
                {reportLoading ? (
                  <div className="animate-pulse space-y-2">
                    <div className="h-3 rounded bg-white/15 w-full" />
                    <div className="h-3 rounded bg-white/15 w-5/6" />
                    <div className="h-3 rounded bg-white/15 w-4/5" />
                    <div className="h-3 rounded bg-white/15 w-full" />
                    <div className="h-3 rounded bg-white/15 w-3/4" />
                  </div>
                ) : (
                  <p className="text-white/90 italic text-sm leading-relaxed">{report}</p>
                )}
              </div>
            </div>

            {/* Team radio */}
            {!radioLoading && (radioWinner || radioFocus) && (
              <div className="space-y-3">
                {radioWinner && (
                  <RadioCard
                    driver={winnerDriver}
                    team={winnerTeam}
                    text={radioWinner}
                    label="WINNER RADIO"
                  />
                )}
                {radioFocus && (!winner || winner.driverId !== focusDriverId) && (() => {
                  const fd = getDriver(drivers, focusDriverId);
                  const ft = getTeam(TEAMS, fd?.teamId);
                  return <RadioCard driver={fd} team={ft} text={radioFocus} label="DRIVER RADIO" />;
                })()}
              </div>
            )}
            {radioLoading && (
              <div className="rounded-lg border p-5" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
                <div className="animate-pulse flex gap-3 items-center">
                  <div className="w-16 h-4 rounded bg-white/15" />
                  <div className="flex-1 h-3 rounded bg-white/10" />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── NEXT RACE BUTTON ── */}
        <div className="pt-4 pb-10">
          {round < TOTAL_ROUNDS ? (
            <button
              type="button"
              onClick={onNextRace}
              className="w-full py-4 font-black uppercase tracking-wider text-white rounded transition-all hover:opacity-90"
              style={{ background: F1_RED }}
            >
              SIMULATE NEXT RACE →
            </button>
          ) : (
            <button
              type="button"
              onClick={onFinishSeason}
              className="w-full py-4 font-black uppercase tracking-wider text-white rounded transition-all hover:opacity-90"
              style={{ background: F1_RED }}
            >
              VIEW CHAMPIONSHIP FINALE →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── RADIO CARD ────────────────────────────────────────────────────────────
function RadioCard({ driver, team, text, label }) {
  return (
    <div
      className="rounded-lg border border-l-4 p-5"
      style={{ background: PANEL_BG, borderColor: PANEL_BORDER, borderLeftColor: team?.color ?? F1_RED }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-black tracking-widest px-2 py-0.5 rounded" style={{ background: "rgba(0,200,80,0.15)", color: "#4ade80" }}>
          ● {label}
        </span>
        <span className="text-white font-bold text-sm">{driver?.flag} {driver?.name ?? "—"}</span>
        {team && <span className="text-xs" style={{ color: team.color }}>{team.name}</span>}
      </div>
      <p className="text-white/90 text-sm font-mono leading-relaxed">{text}</p>
    </div>
  );
}

// ─── CHAMPIONSHIP SHIFT ────────────────────────────────────────────────────
function ChampionshipShift({ driverStandings, seasonResults, drivers, round }) {
  const prevStandings = useMemo(() => {
    if (seasonResults.length <= 1) return [];
    return buildDriverStandings(seasonResults.slice(0, -1), drivers);
  }, [seasonResults, drivers]);

  if (prevStandings.length === 0) return null;

  return (
    <div className="rounded-lg border overflow-hidden" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
      <div className="px-4 py-2.5 border-b" style={{ borderColor: PANEL_BORDER }}>
        <span className="text-xs font-black tracking-widest" style={{ color: F1_RED }}>CHAMPIONSHIP — AFTER ROUND {round}</span>
      </div>
      <div className="p-4 space-y-2">
        {driverStandings.slice(0, 8).map((row, i) => {
          const prevIdx = prevStandings.findIndex((p) => p.driverId === row.driverId);
          const prevPos = prevIdx >= 0 ? prevIdx + 1 : null;
          const currPos = i + 1;
          const gained = prevPos != null && currPos < prevPos;
          const lost = prevPos != null && currPos > prevPos;
          const d = getDriver(drivers, row.driverId);
          const t = getTeam(TEAMS, row.teamId);
          return (
            <div key={row.driverId} className="flex items-center gap-3 text-sm">
              <span className="w-6 text-white/40 text-xs font-mono">{currPos}</span>
              {t && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: t.color }} />}
              <span className="flex-1 text-white/80">{d?.name ?? row.driverId}</span>
              {gained && <span className="text-green-400 text-xs">▲</span>}
              {lost && <span className="text-red-400 text-xs">▼</span>}
              <span className="font-bold text-white">{row.points}</span>
              <span className="text-white/30 text-xs">pts</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── FINALE SCREEN ────────────────────────────────────────────────────────
function FinaleScreen({ seasonResults, driverStandings, constructorStandings, focusDriverId, onPlayAgain }) {
  const drivers = getActiveDrivers(DRIVERS);
  const [tab, setTab] = useState("champion");
  const [expandedRace, setExpandedRace] = useState(null);
  const [selectedDriverId, setSelectedDriverId] = useState(null);

  // ── Derived season stats ──
  const wins = useMemo(() => {
    const w = {};
    seasonResults.forEach((r) => { const id = r.results?.[0]?.driverId; if (id) w[id] = (w[id] || 0) + 1; });
    return w;
  }, [seasonResults]);

  const podiums = useMemo(() => {
    const p = {};
    seasonResults.forEach((r) => (r.results || []).slice(0, 3).forEach((x) => { if (!x.dnf) p[x.driverId] = (p[x.driverId] || 0) + 1; }));
    return p;
  }, [seasonResults]);

  const dnfs = useMemo(() => {
    const d = {};
    seasonResults.forEach((r) => (r.results || []).filter((x) => x.dnf).forEach((x) => { d[x.driverId] = (d[x.driverId] || 0) + 1; }));
    return d;
  }, [seasonResults]);

  const poles = useMemo(() => {
    const p = {};
    seasonResults.forEach((r) => { const id = r.qualifyingOrder?.[0]; if (id) p[id] = (p[id] || 0) + 1; });
    return p;
  }, [seasonResults]);

  const bestFinish = useMemo(() => {
    const b = {};
    seasonResults.forEach((r) => (r.results || []).forEach((x) => {
      if (!x.dnf) b[x.driverId] = Math.min(b[x.driverId] ?? 99, x.position ?? 99);
    }));
    return b;
  }, [seasonResults]);

  // Points per round for gap chart
  const cumulativePoints = useMemo(() => {
    const pts = {};
    drivers.forEach((d) => (pts[d.id] = []));
    let running = {};
    drivers.forEach((d) => (running[d.id] = 0));
    seasonResults.forEach((race) => {
      (race.results || []).forEach((r) => { running[r.driverId] = (running[r.driverId] || 0) + (r.points || 0); });
      drivers.forEach((d) => { pts[d.id] = [...(pts[d.id] || []), running[d.id] || 0]; });
    });
    return pts;
  }, [seasonResults, drivers]);

  const champ = driverStandings[0];
  const champDriver = champ ? getDriver(drivers, champ.driverId) : null;
  const champTeam = champ ? getTeam(TEAMS, champ.teamId) : null;
  const conChamp = constructorStandings[0];
  const conChampTeam = conChamp ? getTeam(TEAMS, conChamp.teamId) : null;
  const focusDriver = focusDriverId ? getDriver(drivers, focusDriverId) : null;
  const focusTeam = focusDriver ? getTeam(TEAMS, focusDriver.teamId) : null;
  const focusStanding = driverStandings.find((s) => s.driverId === focusDriverId);
  const focusPos = driverStandings.findIndex((s) => s.driverId === focusDriverId) + 1;

  const totalDnfs = seasonResults.reduce((s, r) => s + (r.results?.filter((x) => x.dnf).length || 0), 0);
  const safetyCars = seasonResults.filter((r) => r.safetyCarDeployed).length;

  const TABS = [
    { id: "champion", label: "CHAMPION" },
    { id: "drivers", label: "DRIVERS" },
    { id: "races", label: "RACES" },
    { id: "teams", label: "TEAMS" },
  ];

  return (
    <div className="min-h-screen text-white" style={{ background: BG_DARK, fontFamily: "var(--font-titillium)" }}>
      {/* Header */}
      <div className="border-b" style={{ borderColor: PANEL_BORDER }}>
        <div className="max-w-5xl mx-auto px-4 pt-10 pb-4 text-center">
          <p className="text-xs uppercase tracking-widest text-white/40 mb-1">2026 Season Complete</p>
          <h1 className="text-4xl md:text-5xl font-black" style={{ color: champTeam?.color ?? F1_RED }}>
            {champDriver?.name ?? "—"}
          </h1>
          <p className="text-white/60 mt-1">{champTeam?.name} · {champ?.points ?? 0} pts · {wins[champ?.driverId] || 0} wins</p>
        </div>
        {/* Tabs */}
        <div className="max-w-5xl mx-auto px-4 flex gap-0">
          {TABS.map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className="px-6 py-3 text-xs font-black tracking-widest uppercase transition-all relative"
              style={{ color: tab === t.id ? "#fff" : "rgba(255,255,255,0.4)" }}>
              {t.label}
              {tab === t.id && <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t" style={{ background: F1_RED }} />}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">

        {/* ── CHAMPION TAB ── */}
        {tab === "champion" && (
          <div className="space-y-4">
            {/* Champion hero */}
            <div className="rounded-lg p-6 border-l-4 border" style={{ background: PANEL_BG, borderColor: PANEL_BORDER, borderLeftColor: champTeam?.color ?? F1_RED }}>
              <p className="text-xs text-white/40 uppercase tracking-wider">World Champion</p>
              <p className="text-4xl font-black text-white mt-1">{champDriver?.flag} {champDriver?.name ?? "—"}</p>
              <p className="mt-1 font-bold" style={{ color: champTeam?.color ?? F1_RED }}>{champTeam?.name}</p>
              <div className="mt-4 grid grid-cols-4 gap-3">
                {[
                  { label: "Points", value: champ?.points ?? 0 },
                  { label: "Wins", value: wins[champ?.driverId] || 0 },
                  { label: "Podiums", value: podiums[champ?.driverId] || 0 },
                  { label: "Poles", value: poles[champ?.driverId] || 0 },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded p-3 text-center" style={{ background: "rgba(255,255,255,0.05)" }}>
                    <p className="text-2xl font-black text-white">{value}</p>
                    <p className="text-xs text-white/50 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Focus driver card */}
            {focusDriver && focusDriverId !== champ?.driverId && (
              <div className="rounded-lg p-5 border-l-4 border" style={{ background: PANEL_BG, borderColor: PANEL_BORDER, borderLeftColor: focusTeam?.color ?? F1_RED }}>
                <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Your Driver</p>
                <p className="text-2xl font-black text-white">{focusDriver.flag} {focusDriver.name}</p>
                <p className="text-sm mt-0.5" style={{ color: focusTeam?.color ?? "rgba(255,255,255,0.5)" }}>{focusTeam?.name}</p>
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {[
                    { label: "P" + focusPos, sub: "Championship" },
                    { label: focusStanding?.points ?? 0, sub: "Points" },
                    { label: wins[focusDriverId] || 0, sub: "Wins" },
                    { label: podiums[focusDriverId] || 0, sub: "Podiums" },
                  ].map(({ label, sub }) => (
                    <div key={sub} className="rounded p-2 text-center" style={{ background: "rgba(255,255,255,0.05)" }}>
                      <p className="text-xl font-black text-white">{label}</p>
                      <p className="text-xs text-white/40 mt-0.5">{sub}</p>
                    </div>
                  ))}
                </div>
                {/* Focus driver race-by-race points */}
                <div className="mt-4">
                  <p className="text-xs text-white/40 uppercase mb-2">Points per race</p>
                  <div className="flex gap-1 flex-wrap">
                    {seasonResults.map((race, i) => {
                      const r = race.results?.find((x) => x.driverId === focusDriverId);
                      const pts = r?.points ?? 0;
                      const isDnf = r?.dnf;
                      return (
                        <div key={i} className="flex flex-col items-center gap-0.5" title={(race.race?.name ?? "R" + (i + 1)) + ": " + (isDnf ? "DNF" : pts + " pts")}>
                          <div
                            className="w-6 rounded-sm"
                            style={{
                              height: Math.max(4, (pts / 25) * 40) + "px",
                              background: isDnf ? "#e11" : pts > 0 ? (focusTeam?.color ?? F1_RED) : "rgba(255,255,255,0.15)",
                            }}
                          />
                          <span className="text-white/30 text-xs">{i + 1}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Constructors champion */}
            <div className="rounded-lg p-5 border-l-4 border" style={{ background: PANEL_BG, borderColor: PANEL_BORDER, borderLeftColor: conChampTeam?.color ?? F1_RED }}>
              <p className="text-xs text-white/40 uppercase tracking-wider">Constructors Champion</p>
              <p className="text-2xl font-black text-white mt-1">{conChampTeam?.name ?? "—"}</p>
              <p className="text-white/60">{conChamp?.points ?? 0} pts</p>
            </div>

            {/* Season numbers */}
            <div className="rounded-lg p-5 border" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
              <p className="text-xs text-white/40 uppercase tracking-wider mb-3">Season in numbers</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Races", value: seasonResults.length },
                  { label: "DNFs", value: totalDnfs },
                  { label: "Safety Cars", value: safetyCars },
                  { label: "Different Winners", value: Object.keys(wins).length },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded p-3 text-center" style={{ background: "rgba(255,255,255,0.04)" }}>
                    <p className="text-2xl font-black text-white">{value}</p>
                    <p className="text-xs text-white/40 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-2 pb-8">
              <button type="button" onClick={onPlayAgain}
                className="w-full py-4 font-black uppercase tracking-wider rounded text-white hover:opacity-90"
                style={{ background: F1_RED }}>
                Play again
              </button>
            </div>
          </div>
        )}

        {/* ── DRIVERS TAB ── */}
        {tab === "drivers" && (
          <div className="space-y-5">
            {/* Full standings table */}
            <div className="rounded-lg border overflow-hidden" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
              <div className="px-4 py-2.5 border-b" style={{ borderColor: PANEL_BORDER }}>
                <span className="text-xs font-black tracking-widest" style={{ color: F1_RED }}>DRIVER STANDINGS</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider border-b" style={{ borderColor: PANEL_BORDER, color: "rgba(255,255,255,0.4)" }}>
                    <th className="pl-4 py-2 w-10">Pos</th>
                    <th className="py-2 w-4" />
                    <th className="py-2">Driver</th>
                    <th className="py-2">Team</th>
                    <th className="py-2 text-right">Pts</th>
                    <th className="py-2 text-right">Wins</th>
                    <th className="py-2 text-right">Pods</th>
                    <th className="py-2 text-right">DNFs</th>
                    <th className="pr-4 py-2 text-right">Best</th>
                  </tr>
                </thead>
                <tbody>
                  {driverStandings.map((row, i) => {
                    const d = getDriver(drivers, row.driverId);
                    const t = getTeam(TEAMS, row.teamId);
                    const medal = i === 0 ? GOLD : i === 1 ? SILVER : i === 2 ? BRONZE : undefined;
                    const isFocus = row.driverId === focusDriverId;
                    const isSelected = selectedDriverId === row.driverId;
                    return (
                      <tr key={row.driverId}
                        className="border-b cursor-pointer hover:bg-white/5 transition-colors"
                        style={{ borderColor: PANEL_BORDER, background: isFocus ? "rgba(225,6,0,0.1)" : isSelected ? "rgba(255,255,255,0.05)" : undefined }}
                        onClick={() => setSelectedDriverId(isSelected ? null : row.driverId)}>
                        <td className="pl-4 py-2.5 font-black text-sm" style={{ color: medal ?? "rgba(255,255,255,0.7)" }}>{i + 1}</td>
                        <td className="py-2.5">{t && <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: t.color }} />}</td>
                        <td className="py-2.5 font-medium text-white">{d?.flag} {d?.name ?? row.driverId}</td>
                        <td className="py-2.5 text-xs text-white/50">{t?.name}</td>
                        <td className="py-2.5 text-right font-bold text-white">{row.points}</td>
                        <td className="py-2.5 text-right text-white/70">{wins[row.driverId] || 0}</td>
                        <td className="py-2.5 text-right text-white/70">{podiums[row.driverId] || 0}</td>
                        <td className="py-2.5 text-right" style={{ color: dnfs[row.driverId] ? "#f87171" : "rgba(255,255,255,0.4)" }}>{dnfs[row.driverId] || 0}</td>
                        <td className="pr-4 py-2.5 text-right text-white/60">{bestFinish[row.driverId] ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Driver breakdown on click */}
            {selectedDriverId && (() => {
              const d = getDriver(drivers, selectedDriverId);
              const t = getTeam(TEAMS, d?.teamId);
              const standing = driverStandings.find((s) => s.driverId === selectedDriverId);
              const pos = driverStandings.findIndex((s) => s.driverId === selectedDriverId) + 1;
              return (
                <div className="rounded-lg border-l-4 border p-5 space-y-4" style={{ background: PANEL_BG, borderColor: PANEL_BORDER, borderLeftColor: t?.color ?? F1_RED }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xl font-black text-white">{d?.flag} {d?.name}</p>
                      <p className="text-sm mt-0.5" style={{ color: t?.color ?? "rgba(255,255,255,0.5)" }}>{t?.name} · P{pos} Championship</p>
                    </div>
                    <button type="button" onClick={() => setSelectedDriverId(null)} className="text-white/40 hover:text-white text-lg">✕</button>
                  </div>
                  {/* Race-by-race bar chart */}
                  <div>
                    <p className="text-xs text-white/40 uppercase mb-2">Points per race</p>
                    <div className="flex gap-1 items-end" style={{ height: "60px" }}>
                      {seasonResults.map((race, i) => {
                        const r = race.results?.find((x) => x.driverId === selectedDriverId);
                        const pts = r?.points ?? 0;
                        const isDnf = r?.dnf;
                        return (
                          <div key={i} className="flex-1 flex flex-col items-center justify-end gap-0.5"
                            title={(race.race?.name ?? "R" + (i + 1)) + ": " + (isDnf ? "DNF" : pts + " pts")}>
                            <div className="w-full rounded-sm min-h-[3px]"
                              style={{ height: Math.max(3, (pts / 25) * 48) + "px", background: isDnf ? "#e11" : pts > 0 ? (t?.color ?? F1_RED) : "rgba(255,255,255,0.1)" }} />
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex gap-1 mt-1">
                      {seasonResults.map((_, i) => (
                        <div key={i} className="flex-1 text-center text-white/20" style={{ fontSize: "8px" }}>{i + 1}</div>
                      ))}
                    </div>
                  </div>
                  {/* Key stats row */}
                  <div className="grid grid-cols-5 gap-2">
                    {[
                      { label: "Points", value: standing?.points ?? 0 },
                      { label: "Wins", value: wins[selectedDriverId] || 0 },
                      { label: "Podiums", value: podiums[selectedDriverId] || 0 },
                      { label: "Poles", value: poles[selectedDriverId] || 0 },
                      { label: "DNFs", value: dnfs[selectedDriverId] || 0 },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded p-2 text-center" style={{ background: "rgba(255,255,255,0.05)" }}>
                        <p className="text-lg font-black text-white">{value}</p>
                        <p className="text-xs text-white/40">{label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Championship gap chart */}
            <div className="rounded-lg border overflow-hidden" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
              <div className="px-4 py-2.5 border-b" style={{ borderColor: PANEL_BORDER }}>
                <span className="text-xs font-black tracking-widest" style={{ color: F1_RED }}>CHAMPIONSHIP GAP — TOP 5 TO LEADER</span>
              </div>
              <div className="p-4">
                <ChampionshipGapChart
                  cumulativePoints={cumulativePoints}
                  driverStandings={driverStandings}
                  drivers={drivers}
                  seasonResults={seasonResults}
                />
              </div>
            </div>
          </div>
        )}

        {/* ── RACES TAB ── */}
        {tab === "races" && (
          <div className="space-y-2">
            <p className="text-xs text-white/40 uppercase tracking-wider mb-3">Click a race to expand full results</p>
            {seasonResults.map((race, i) => {
              const round = race.round ?? i + 1;
              const raceName = race.race?.name ?? race.raceName ?? "Round " + round;
              const raceFlag = race.race?.flag ?? "🏁";
              const winner = race.results?.[0];
              const winnerDriver = winner ? getDriver(drivers, winner.driverId) : null;
              const winnerTeam = winner ? getTeam(TEAMS, winner.teamId) : null;
              const isExpanded = expandedRace === round;
              const weather = race.weather ?? "dry";
              const hasSC = race.safetyCarDeployed;
              const dnfCount = (race.results || []).filter((r) => r.dnf).length;
              return (
                <div key={round} className="rounded-lg border overflow-hidden" style={{ borderColor: isExpanded ? (winnerTeam?.color ?? F1_RED) : PANEL_BORDER }}>
                  <button
                    type="button"
                    onClick={() => setExpandedRace(isExpanded ? null : round)}
                    className="w-full text-left px-4 py-3 flex items-center gap-3 transition-colors hover:bg-white/5"
                    style={{ background: PANEL_BG }}
                  >
                    <span className="text-white/40 text-xs font-mono w-8 shrink-0">R{round}</span>
                    <span className="text-lg shrink-0">{raceFlag}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-bold text-sm truncate">{raceName}</p>
                      <p className="text-xs mt-0.5" style={{ color: winnerTeam?.color ?? "rgba(255,255,255,0.5)" }}>
                        {winnerDriver?.flag} {winnerDriver?.name ?? "—"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs px-1.5 py-0.5 rounded"
                        style={{ background: weather === "wet" ? "rgba(0,100,255,0.2)" : weather === "mixed" ? "rgba(255,150,0,0.2)" : "rgba(255,255,255,0.08)", color: weather === "wet" ? "#88aaff" : weather === "mixed" ? "#ffaa44" : "rgba(255,255,255,0.5)" }}>
                        {weather.toUpperCase()}
                      </span>
                      {hasSC && <span className="text-xs px-1.5 py-0.5 rounded font-bold" style={{ background: "rgba(255,200,0,0.15)", color: "#ffcc00" }}>SC</span>}
                      {dnfCount > 0 && <span className="text-xs text-red-400/70">{dnfCount} DNF</span>}
                      <span className="text-white/30 text-sm">{isExpanded ? "▲" : "▼"}</span>
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="border-t" style={{ borderColor: PANEL_BORDER }}>
                      <RaceResultsTable results={race.results} drivers={drivers} teams={TEAMS} focusDriverId={focusDriverId} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── TEAMS TAB ── */}
        {tab === "teams" && (
          <div className="space-y-4">
            {/* Constructor standings */}
            <div className="rounded-lg border overflow-hidden" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
              <div className="px-4 py-2.5 border-b" style={{ borderColor: PANEL_BORDER }}>
                <span className="text-xs font-black tracking-widest" style={{ color: F1_RED }}>CONSTRUCTOR STANDINGS</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider border-b" style={{ borderColor: PANEL_BORDER, color: "rgba(255,255,255,0.4)" }}>
                    <th className="pl-4 py-2 w-10">Pos</th>
                    <th className="py-2">Team</th>
                    <th className="py-2 text-right">Pts</th>
                    <th className="pr-4 py-2 text-right">Wins</th>
                  </tr>
                </thead>
                <tbody>
                  {constructorStandings.map((row, i) => {
                    const t = getTeam(TEAMS, row.teamId);
                    const teamWins = seasonResults.reduce((sum, race) => {
                      const w = race.results?.[0];
                      return sum + (w?.teamId === row.teamId ? 1 : 0);
                    }, 0);
                    const medal = i === 0 ? GOLD : i === 1 ? SILVER : i === 2 ? BRONZE : undefined;
                    return (
                      <tr key={row.teamId} className="border-b" style={{ borderColor: PANEL_BORDER }}>
                        <td className="pl-4 py-2.5 font-black" style={{ color: medal ?? "rgba(255,255,255,0.6)" }}>{i + 1}</td>
                        <td className="py-2.5">
                          <div className="flex items-center gap-2">
                            {t && <span className="w-3 h-3 rounded-full shrink-0" style={{ background: t.color }} />}
                            <span className="text-white font-medium">{t?.name ?? row.teamId}</span>
                          </div>
                        </td>
                        <td className="py-2.5 text-right font-bold text-white">{row.points}</td>
                        <td className="pr-4 py-2.5 text-right text-white/60">{teamWins}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Teammate comparisons */}
            <div className="rounded-lg border overflow-hidden" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
              <div className="px-4 py-2.5 border-b" style={{ borderColor: PANEL_BORDER }}>
                <span className="text-xs font-black tracking-widest" style={{ color: F1_RED }}>TEAMMATE HEAD-TO-HEAD</span>
              </div>
              <div className="divide-y" style={{ borderColor: PANEL_BORDER }}>
                {TEAMS.map((team) => {
                  const teamDriverStandings = driverStandings.filter((s) => s.teamId === team.id);
                  if (teamDriverStandings.length < 2) return null;
                  const [d1s, d2s] = teamDriverStandings;
                  const d1 = getDriver(drivers, d1s.driverId);
                  const d2 = getDriver(drivers, d2s.driverId);
                  const total = (d1s.points || 0) + (d2s.points || 0) || 1;
                  const d1pct = Math.round((d1s.points / total) * 100);
                  const d1wins = wins[d1s.driverId] || 0;
                  const d2wins = wins[d2s.driverId] || 0;
                  const d1pods = podiums[d1s.driverId] || 0;
                  const d2pods = podiums[d2s.driverId] || 0;
                  const isFocusTeam = d1s.driverId === focusDriverId || d2s.driverId === focusDriverId;
                  return (
                    <div key={team.id} className="px-4 py-4" style={{ background: isFocusTeam ? "rgba(225,6,0,0.06)" : undefined }}>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: team.color }} />
                        <span className="text-white font-bold text-sm">{team.name}</span>
                      </div>
                      {/* Points bar */}
                      <div className="flex items-center gap-2 text-xs mb-2">
                        <span className="w-24 text-right text-white/80 truncate">{d1?.name?.split(" ").pop()}</span>
                        <div className="flex-1 flex h-5 rounded overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                          <div className="h-full flex items-center justify-end pr-1 text-xs font-bold text-white/80"
                            style={{ width: d1pct + "%", background: team.color + "cc", minWidth: "24px" }}>
                            {d1s.points}
                          </div>
                          <div className="h-full flex items-center pl-1 text-xs font-bold text-white/50"
                            style={{ width: (100 - d1pct) + "%", minWidth: "24px" }}>
                            {d2s.points}
                          </div>
                        </div>
                        <span className="w-24 text-white/80 truncate">{d2?.name?.split(" ").pop()}</span>
                      </div>
                      {/* Wins + podiums row */}
                      <div className="flex text-xs text-white/50 gap-4 pl-26">
                        <span style={{ marginLeft: "6.5rem" }}>
                          {d1wins}W {d1pods}P
                          <span className="mx-2 text-white/20">vs</span>
                          {d2wins}W {d2pods}P
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ── Championship gap SVG chart ─────────────────────────────────────────────
function ChampionshipGapChart({ cumulativePoints, driverStandings, drivers, seasonResults }) {
  const top5 = driverStandings.slice(0, 5);
  const leaderId = driverStandings[0]?.driverId;
  const n = seasonResults.length;
  if (!leaderId || n === 0) return null;

  const width = 700, height = 200;
  const pad = { top: 16, right: 80, bottom: 28, left: 40 };
  const cw = width - pad.left - pad.right;
  const ch = height - pad.top - pad.bottom;

  // Gap = leader pts - driver pts at each round
  const gaps = top5.map((s) => ({
    driverId: s.driverId,
    color: getTeam(TEAMS, s.teamId)?.color ?? "#888",
    points: (cumulativePoints[s.driverId] || []).map((pts, i) => {
      const leaderPts = (cumulativePoints[leaderId] || [])[i] ?? 0;
      return leaderPts - pts;
    }),
  }));

  const maxGap = Math.max(...gaps.flatMap((g) => g.points), 1);

  return (
    <svg width="100%" height={height} viewBox={"0 0 " + width + " " + height} className="overflow-visible">
      {[0, 25, 50, 75, 100].map((g) => {
        const y = pad.top + (g / maxGap) * ch;
        if (y > height - pad.bottom + 5) return null;
        return (
          <g key={g}>
            <line x1={pad.left} y1={y} x2={pad.left + cw} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <text x={pad.left - 6} y={y + 4} fill="rgba(255,255,255,0.35)" fontSize="9" textAnchor="end">{g}</text>
          </g>
        );
      })}
      {gaps.map(({ driverId, color, points }) => {
        if (points.length < 2) return null;
        const d = getDriver(drivers, driverId);
        const isLeader = driverId === leaderId;
        const pts = points.map((gap, i) => {
          const x = pad.left + (i / (n - 1)) * cw;
          const y = pad.top + (Math.min(gap, maxGap) / maxGap) * ch;
          return [x, y];
        });
        const path = "M " + pts.map((p) => p[0] + "," + p[1]).join(" L ");
        const last = pts[pts.length - 1];
        return (
          <g key={driverId}>
            <path d={path} fill="none" stroke={color} strokeWidth={isLeader ? 2.5 : 1.5} strokeOpacity={isLeader ? 1 : 0.75} />
            {last && (
              <text x={last[0] + 6} y={last[1] + 4} fill={color} fontSize="10" fontWeight="bold">
                {d?.short ?? d?.name?.split(" ").pop() ?? driverId}
              </text>
            )}
          </g>
        );
      })}
      {[0, Math.floor(n / 2), n - 1].map((i) => (
        <text key={i} x={pad.left + (i / (n - 1)) * cw} y={height - 6} fill="rgba(255,255,255,0.35)" fontSize="9" textAnchor="middle">
          R{i + 1}
        </text>
      ))}
    </svg>
  );
}

// ─── MAIN PAGE ─────────────────────────────────────────────────────────────
export default function SingleSeasonPage() {
  const [screen, setScreen] = useState("setup");
  const [simulationMode, setSimulationMode] = useState(SIMULATION_MODES.realistic);
  const [focusDriverId, setFocusDriverId] = useState("norris");
  const [seasonResults, setSeasonResults] = useState([]);
  const [currentRound, setCurrentRound] = useState(0);
  const [currentRaceResult, setCurrentRaceResult] = useState(null);
  const [loadingNext, setLoadingNext] = useState(false);

  const drivers = useMemo(() => getActiveDrivers(DRIVERS), []);
  const driverStandings = useMemo(() => buildDriverStandings(seasonResults, drivers), [seasonResults, drivers]);
  const constructorStandings = useMemo(() => buildConstructorStandings(seasonResults, TEAMS), [seasonResults]);
  const currentRace = currentRound >= 1 && currentRound <= TOTAL_ROUNDS ? GP_RACES[currentRound - 1] : null;
  const previousRaceWinner = seasonResults.length >= 2
    ? getDriver(drivers, seasonResults[seasonResults.length - 2]?.results?.[0]?.driverId)?.name
    : null;

  const simulateRound = useCallback((round) => {
    const race = GP_RACES[round - 1];
    if (!race) return;
    const result = simulateSingleRace(race, round, drivers, TEAMS, {
      chaosLevel: simulationMode?.chaosLevel ?? 5,
      safetyCarFrequency: simulationMode?.safetyCarFrequency ?? 5,
      upgradesEnabled: true,
      focusDriverId,
    });
    result.race = race;
    return result;
  }, [drivers, simulationMode, focusDriverId]);

  const handleBeginSeason = useCallback(() => {
    setScreen("race");
    setCurrentRound(1);
    const result = simulateRound(1);
    setCurrentRaceResult(result);
    setSeasonResults([result]);
  }, [simulateRound]);

  const handleNextRace = useCallback(() => {
    if (currentRound >= TOTAL_ROUNDS) return;
    setLoadingNext(true);
    const nextRound = currentRound + 1;
    setTimeout(() => {
      const result = simulateRound(nextRound);
      setCurrentRaceResult(result);
      setSeasonResults((prev) => [...prev, result]);
      setCurrentRound(nextRound);
      setLoadingNext(false);
    }, 600);
  }, [currentRound, simulateRound]);

  if (screen === "setup") {
    return (
      <SetupScreen
        onBegin={handleBeginSeason}
        simulationMode={simulationMode}
        setSimulationMode={setSimulationMode}
        focusDriverId={focusDriverId}
        setFocusDriverId={setFocusDriverId}
      />
    );
  }

  if (screen === "finale") {
    return (
      <FinaleScreen
        seasonResults={seasonResults}
        driverStandings={driverStandings}
        constructorStandings={constructorStandings}
        onPlayAgain={() => { setScreen("setup"); setSeasonResults([]); setCurrentRound(0); setCurrentRaceResult(null); }}
      />
    );
  }

  if (loadingNext) {
    const nextRace = GP_RACES[currentRound];
    return (
      <div className="min-h-screen flex items-center justify-center text-white" style={{ background: BG_DARK }}>
        <div className="text-center space-y-4">
          <div className="inline-block w-10 h-10 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          <p className="text-white/80 text-lg">Simulating {nextRace?.name ?? "next race"}...</p>
          <p className="text-white/40 text-sm">{nextRace?.location ?? ""} {nextRace?.flag ?? ""}</p>
        </div>
      </div>
    );
  }

  return (
    <RaceRevealScreen
      raceResult={currentRaceResult}
      round={currentRound}
      race={currentRace}
      driverStandings={driverStandings}
      constructorStandings={constructorStandings}
      previousRaceWinner={previousRaceWinner}
      focusDriverId={focusDriverId}
      seasonResults={seasonResults}
      onNextRace={handleNextRace}
      onFinishSeason={() => setScreen("finale")}
    />
  );
}
