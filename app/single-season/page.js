"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { TEAMS, DRIVERS, RACES, SIMULATION_MODES, RESERVE_DRIVERS } from "@/lib/f1Data";
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

function getTrackTemp(race, weather) {
  const hot = ["bahrain", "saudi", "australia", "miami", "singapore", "abu dhabi", "qatar", "las vegas"];
  const cool = ["britain", "belgium", "hungary", "austria", "netherlands", "canada", "japan", "china"];
  const loc = (race?.location ?? "").toLowerCase();
  const base = hot.some((h) => loc.includes(h)) ? 38 : cool.some((c) => loc.includes(c)) ? 18 : 28;
  return base + (weather === "wet" ? -8 : weather === "mixed" ? -4 : 0) + Math.round((Math.random() - 0.5) * 4);
}

function buildQualifyingData(qualifyingOrder, drivers, teams, weather, seed) {
  if (!qualifyingOrder || qualifyingOrder.length === 0) return { q1: [], q2: [], q3: [] };

  const noise = (driverId, session, attempt) => {
    const h = (s) => { let v = 0; for (let i = 0; i < s.length; i++) v = Math.imul(31, v) + s.charCodeAt(i) | 0; return v; };
    const n = h(driverId + session + attempt + seed);
    const x = Math.sin(n) * 43758.5453;
    return x - Math.floor(x);
  };

  const isWet = weather === "wet";
  const isMixed = weather === "mixed";
  const baseTime = isWet ? 104.5 : isMixed ? 97.8 : 87.2;
  const spread = 3.8;

  const scoreDriver = (id, sessionSeed) => {
    const d = getDriver(drivers, id);
    const t = d ? getTeam(teams, d.teamId) : null;
    if (!d || !t) return 50;
    const pace = d.pace ?? 75;
    const consistency = d.consistency ?? 75;
    const wet = d.wetWeather ?? 75;
    const teamPace = t.basePace ?? 80;
    const score = isWet
      ? wet * 0.45 + pace * 0.25 + teamPace * 0.20 + consistency * 0.10
      : isMixed
      ? wet * 0.25 + pace * 0.30 + teamPace * 0.30 + consistency * 0.15
      : teamPace * 0.50 + pace * 0.30 + consistency * 0.20;
    const n = noise(id, sessionSeed, "score");
    return score + (n - 0.5) * 5.0;
  };

  const fmt = (s) => { const m = Math.floor(s / 60); return m + ":" + (s % 60).toFixed(3).padStart(6, "0"); };

 const scoreToTime = (score, maxScore, minScore, deltaImprovement) => {
    const norm = maxScore === minScore ? 0.5 : (score - minScore) / (maxScore - minScore);
    return baseTime + spread * (1 - norm) - deltaImprovement;
  };

  const q1Scores = qualifyingOrder.map((id) => ({ id, score: scoreDriver(id, "q1") }));
  const q1Max = Math.max(...q1Scores.map((s) => s.score));
  const q1Min = Math.min(...q1Scores.map((s) => s.score));
  const q1Sorted = [...q1Scores].sort((a, b) => b.score - a.score);
  const q1Times = q1Sorted.map((s) => scoreToTime(s.score, q1Max, q1Min, 0));
  const q1 = q1Sorted.map((s, i) => ({ driverId: s.id, time: fmt(q1Times[i]), gap: i === 0 ? null : "+" + (q1Times[i] - q1Times[0]).toFixed(3), eliminated: i >= 15, pos: i + 1 }));

  const q2Pool = q1Sorted.slice(0, 15).map((s) => s.id);
  const q2Scores = q2Pool.map((id) => ({ id, score: scoreDriver(id, "q2") }));
  const q2Max = Math.max(...q2Scores.map((s) => s.score));
  const q2Min = Math.min(...q2Scores.map((s) => s.score));
  const q2Sorted = [...q2Scores].sort((a, b) => b.score - a.score);
  const q2Times = q2Sorted.map((s) => scoreToTime(s.score, q2Max, q2Min, 0.28));
  const q2 = q2Sorted.map((s, i) => ({ driverId: s.id, time: fmt(q2Times[i]), gap: i === 0 ? null : "+" + (q2Times[i] - q2Times[0]).toFixed(3), eliminated: i >= 10, pos: i + 1 }));

  const q3Pool = q2Sorted.slice(0, 10).map((s) => s.id);
  const q3Scores = q3Pool.map((id) => ({ id, score: scoreDriver(id, "q3") }));
  const q3Max = Math.max(...q3Scores.map((s) => s.score));
  const q3Min = Math.min(...q3Scores.map((s) => s.score));
  const q3Sorted = [...q3Scores].sort((a, b) => b.score - a.score);
  const q3Times = q3Sorted.map((s) => scoreToTime(s.score, q3Max, q3Min, 0.52));
  const q3 = q3Sorted.map((s, i) => ({ driverId: s.id, time: fmt(q3Times[i]), gap: i === 0 ? null : "+" + (q3Times[i] - q3Times[0]).toFixed(3), eliminated: false, pos: i + 1 }));

  return { q1, q2, q3 };
}


// ─── DRIVER FOCUS PICKER ─────────────────────────────────────────────────
function DriverFocusPicker({ focusDriverId, setFocusDriverId, gridDrivers, onSwapConfirm }) {
  const [showReserves, setShowReserves] = useState(false);
  const [swapMode, setSwapMode] = useState(false);
  const [swapSource, setSwapSource] = useState(null);
  const [swapTarget, setSwapTarget] = useState(null);
  const [localGrid, setLocalGrid] = useState(gridDrivers);

  const teamRows = TEAMS.map((team) => ({
    team,
    drivers: localGrid.filter((d) => d.teamId === team.id),
  })).filter((r) => r.drivers.length > 0);

  const allReserves = RESERVE_DRIVERS.filter((r) => !localGrid.find((g) => g.id === r.id));
  const selectedDriver = localGrid.find((d) => d.id === focusDriverId) ?? allReserves.find((d) => d.id === focusDriverId);
  const selectedTeam = selectedDriver ? getTeam(TEAMS, selectedDriver.teamId) : null;

  function handleGridDriverClick(d) {
    if (swapMode) { setSwapSource(swapSource === d.id ? null : d.id); setSwapTarget(null); }
    else setFocusDriverId(d.id);
  }
  function handleReserveClick(r) {
    if (!swapMode) { setFocusDriverId(r.id); return; }
    if (!swapSource) return;
    setSwapTarget(r.id);
  }
  function confirmSwap() {
    if (!swapSource || !swapTarget) return;
    const src = localGrid.find((d) => d.id === swapSource);
    const tgt = RESERVE_DRIVERS.find((d) => d.id === swapTarget);
    if (!src || !tgt) return;
    const newGrid = localGrid.map((d) => d.id === swapSource ? { ...tgt, teamId: src.teamId, number: src.number } : d);
    setLocalGrid(newGrid);
    onSwapConfirm(newGrid);
    if (focusDriverId === swapSource) setFocusDriverId(swapTarget);
    setSwapSource(null); setSwapTarget(null); setSwapMode(false); setShowReserves(false);
  }

  const ratingBar = (val) => (
    <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
      <div className="h-full rounded-full" style={{ width: val + "%", background: val >= 90 ? "#22c55e" : val >= 80 ? "#facc15" : val >= 70 ? "#f97316" : "#ef4444" }} />
    </div>
  );

  return (
    <div className="space-y-3 h-full flex flex-col">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-white/60 uppercase tracking-wider">Focus driver</p>
        <div className="flex gap-2">
          {swapMode ? (
            <>
              {swapSource && swapTarget && (
                <button type="button" onClick={confirmSwap}
                  className="text-xs px-3 py-1.5 rounded font-bold"
                  style={{ background: "#22c55e", color: "#000" }}>
                  Confirm swap ✓
                </button>
              )}
              <button type="button" onClick={() => { setSwapMode(false); setSwapSource(null); setSwapTarget(null); }}
                className="text-xs px-3 py-1.5 rounded font-bold border"
                style={{ borderColor: "rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.6)" }}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={() => { setSwapMode(true); setShowReserves(true); }}
              className="text-xs px-3 py-1.5 rounded font-bold border hover:bg-white/5 transition-all"
              style={{ borderColor: "rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.6)" }}>
              ⇄ Swap seats
            </button>
          )}
        </div>
      </div>

      {/* Swap instruction banner */}
      {swapMode && (
        <div className="rounded-lg px-4 py-2.5 text-xs border" style={{ background: "rgba(225,6,0,0.08)", borderColor: F1_RED + "44" }}>
          {!swapSource
            ? <span style={{ color: "#ffaa44" }}>① Select a grid driver to replace</span>
            : !swapTarget
            ? <span style={{ color: "#ffaa44" }}>② Select a reserve driver to bring in</span>
            : <span style={{ color: "#22c55e" }}>Ready — confirm the swap above</span>}
        </div>
      )}

      {/* Selected driver card */}
      {selectedDriver && (
        <div className="rounded-lg px-4 py-3 border flex items-center gap-4"
          style={{ background: selectedTeam?.color ? selectedTeam.color + "14" : PANEL_BG, borderColor: selectedTeam?.color ? selectedTeam.color + "55" : PANEL_BORDER }}>
          <div className="text-3xl font-black shrink-0 w-12 text-center" style={{ color: selectedTeam?.color ?? F1_RED }}>
            {selectedDriver.number ?? "—"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-black text-white text-base leading-tight">{selectedDriver.flag} {selectedDriver.name}</p>
            <p className="text-xs mt-0.5" style={{ color: selectedTeam?.color ?? "rgba(255,255,255,0.4)" }}>
              {selectedTeam?.name ?? (selectedDriver.status === "reserve" ? "Reserve driver" : "F2")}
            </p>
          </div>
          <div className="space-y-1.5 shrink-0 w-32">
            {[["Pace", selectedDriver.pace], ["Consistency", selectedDriver.consistency], ["Wet", selectedDriver.wetWeather]].map(([label, val]) => (
              <div key={label} className="flex items-center gap-2">
                <span className="text-white/40 text-xs w-16 text-right">{label}</span>
                {ratingBar(val)}
                <span className="text-xs font-bold text-white w-6 text-right">{val}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Grid — 2 drivers per team row, teams stacked, fills available height */}
      <div className="rounded-lg border overflow-hidden flex-1" style={{ borderColor: PANEL_BORDER }}>
        {teamRows.map(({ team, drivers }, ti) => (
          <div key={team.id} className={ti > 0 ? "border-t" : ""} style={{ borderColor: PANEL_BORDER }}>
            <div className="px-3 py-1 flex items-center gap-2" style={{ background: team.color + "18" }}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: team.color }} />
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: team.color }}>{team.name}</span>
            </div>
            <div className="grid grid-cols-2">
              {drivers.map((d, di) => {
                const isFocus = d.id === focusDriverId;
                const isSwapSource = swapSource === d.id;
                return (
                  <button key={d.id} type="button" onClick={() => handleGridDriverClick(d)}
                    className={"flex items-center gap-2 px-3 py-2 text-left transition-all hover:bg-white/5" + (di === 0 ? " border-r" : "")}
                    style={{ borderColor: PANEL_BORDER, background: isSwapSource ? F1_RED + "18" : isFocus ? team.color + "18" : undefined, outline: "2px solid " + (isSwapSource ? F1_RED : isFocus ? team.color : "transparent"), outlineOffset: "-2px" }}>
                    <span className="font-black shrink-0 w-6 text-center" style={{ color: team.color, fontSize: "13px" }}>{d.number}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white leading-tight truncate">{d.flag} {d.short}</p>
                      <p className="text-xs leading-tight truncate" style={{ color: "rgba(255,255,255,0.4)", fontSize: "11px" }}>{d.name.split(" ").pop()}</p>
                    </div>
                    <span className="ml-auto text-xs shrink-0">
                      {isSwapSource ? <span style={{ color: F1_RED }}>⇄</span> : isFocus ? <span style={{ color: team.color }}>●</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Reserve pool toggle */}
      <button type="button" onClick={() => setShowReserves((v) => !v)}
        className="w-full text-left px-4 py-2.5 rounded-lg border flex items-center justify-between hover:bg-white/5 transition-all"
        style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
        <span className="text-sm font-bold text-white/70">
          Reserve &amp; F2 drivers <span className="text-white/30 font-normal text-xs">({allReserves.length} available)</span>
        </span>
        <span className="text-white/40 text-sm">{showReserves ? "▲" : "▼"}</span>
      </button>

      {showReserves && (
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: PANEL_BORDER }}>
          {/* 2-column grid for reserves to keep it compact */}
          <div className="grid grid-cols-2">
            {allReserves.map((r, ri) => {
              const isFocus = r.id === focusDriverId;
              const isSwapTarget = swapTarget === r.id;
              const disabled = swapMode && !swapSource;
              const isOdd = ri % 2 === 0;
              return (
                <button key={r.id} type="button" onClick={() => !disabled && handleReserveClick(r)}
                  className={"flex items-center gap-2 px-3 py-2 text-left border-b transition-all" + (isOdd ? " border-r" : "") + (disabled ? " opacity-40 cursor-not-allowed" : " hover:bg-white/5")}
                  style={{ borderColor: PANEL_BORDER, background: isSwapTarget ? "#22c55e18" : isFocus ? F1_RED + "18" : undefined, outline: isSwapTarget ? "2px solid #22c55e" : isFocus ? "2px solid " + F1_RED : undefined, outlineOffset: "-2px" }}>
                  <span className="text-sm shrink-0">{r.flag}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-white leading-tight truncate">{r.name}</p>
                    <p className="text-xs leading-tight" style={{ color: "rgba(255,255,255,0.35)", fontSize: "11px" }}>Reserve</p>
                  </div>
                  <div className="flex gap-2 items-center shrink-0">
                    {[["P", r.pace], ["C", r.consistency], ["W", r.wetWeather]].map(([lbl, val]) => (
                      <div key={lbl} className="flex flex-col items-center">
                        <span className="text-xs font-bold text-white leading-none">{val}</span>
                        <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "10px" }}>{lbl}</span>
                      </div>
                    ))}
                  </div>
                  {isSwapTarget && <span className="text-xs ml-1" style={{ color: "#22c55e" }}>✓</span>}
                  {isFocus && !isSwapTarget && <span className="text-xs ml-1" style={{ color: F1_RED }}>●</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── RACE LOADING SCREEN ─────────────────────────────────────────────────
function RaceLoadingScreen({ race, round, totalRounds, mode, remainingCount }) {
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("Preparing...");
  const duration = (mode === "full" || mode === "toend") ? 5000 : 2000;

  useEffect(() => {
    const steps = (mode === "full")
      ? [
          [0,   "Simulating all " + totalRounds + " races..."],
          [20,  "Battles at the front unfolding..."],
          [45,  "Mid-season upgrades arriving..."],
          [70,  "Championship fight intensifying..."],
          [90,  "Final rounds decided..."],
          [100, "Season complete."],
        ]
      : (mode === "toend")
      ? [
          [0,   "Simulating remaining " + remainingCount + " races..."],
          [20,  "Racing through the calendar..."],
          [45,  "Key battles intensifying..."],
          [70,  "Championship fight reaches its peak..."],
          [90,  "Final rounds decided..."],
          [100, "Season complete."],
        ]
      : [
          [0,   "Drivers line up on the grid..."],
          [30,  "Lights out! Race underway..."],
          [65,  "Pit stop windows opening..."],
          [90,  "Final laps..."],
          [100, "Chequered flag!"],
        ];

    const interval = 80;
    const totalTicks = duration / interval;
    let tick = 0;
    const timer = setInterval(() => {
      tick++;
      const pct = Math.min(100, Math.round((tick / totalTicks) * 100));
      setProgress(pct);
      const step = [...steps].reverse().find(([threshold]) => pct >= threshold);
      if (step) setStatusText(step[1]);
      if (pct >= 100) clearInterval(timer);
    }, interval);
    return () => clearInterval(timer);
  }, []);

  const isMultiRace = mode === "full" || mode === "toend";

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6"
      style={{ background: BG_DARK, fontFamily: "var(--font-titillium)" }}
    >
      {/* Racing stripe — matches franchise SimulatingScreen exactly */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 w-full"
          style={{
            background: "repeating-linear-gradient(90deg, " + F1_RED + " 0px, " + F1_RED + " 20px, transparent 20px, transparent 40px)",
            animation: "racing-line 1.5s linear infinite",
          }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10 text-center space-y-2">
        {isMultiRace ? (
          <>
            <p className="text-white/40 text-xs uppercase tracking-widest">
              {mode === "full" ? "Full Season" : "Simulating to End"}
            </p>
            <h2 className="text-4xl md:text-5xl font-black text-white uppercase tracking-wider">
              2026 Season
            </h2>
            <p className="text-white/60 text-lg">
              {mode === "full"
                ? "Simulating all " + totalRounds + " races"
                : "Simulating remaining " + remainingCount + " races"}
            </p>
          </>
        ) : (
          <>
            <p className="text-white/40 text-xs uppercase tracking-widest">
              {"Round " + round + " of " + totalRounds}
            </p>
            <h2 className="text-4xl md:text-5xl font-black text-white uppercase tracking-wider">
              {(race?.flag ?? "") + " " + (race?.name ?? "Grand Prix")}
            </h2>
            <p className="text-white/60 text-lg">{race?.location ?? ""}</p>
          </>
        )}
      </div>

      {/* Pulsing SIMULATING label */}
      <div className="relative z-10 mt-8">
        <p
          className="text-xs font-black tracking-widest uppercase"
          style={{ color: F1_RED, animation: "pulse-text 1.2s ease-in-out infinite" }}
        >
          ● SIMULATING
        </p>
      </div>

      {/* Progress bar */}
      <div className="relative z-10 w-full max-w-md mt-6">
        <div
          className="h-3 w-full rounded-sm overflow-hidden border border-white/20"
          style={{ background: PANEL_BG }}
        >
          <div
            className="h-full rounded-sm transition-all duration-75"
            style={{ width: progress + "%", background: F1_RED }}
          />
        </div>
        <p className="mt-4 text-center text-white/60 text-sm min-h-[1.5rem]">{statusText}</p>
      </div>

      <style>{`
        @keyframes racing-line {
          from { background-position: 0 0; }
          to   { background-position: 40px 0; }
        }
        @keyframes pulse-text {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

// ─── SLIDER ───────────────────────────────────────────────────────────────
function Slider({ label, value, min, max, step = 1, onChange, description, colorHigh }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-sm text-white/70">{label}</span>
        <span className="text-sm font-bold text-white">{value}{max === 1 ? "" : "/" + max}</span>
      </div>
      <div className="relative h-6 flex items-center">
        <div className="w-full h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.1)" }}>
          <div className="h-full rounded-full transition-all" style={{ width: pct + "%", background: colorHigh && value > max * 0.6 ? colorHigh : F1_RED }} />
        </div>
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer h-full" />
      </div>
      {description && <p className="text-xs text-white/30 mt-0.5">{description}</p>}
    </div>
  );
}


// ─── SETUP SCREEN ─────────────────────────────────────────────────────────
function SetupScreen({ onBegin, simulationMode, setSimulationMode, focusDriverId, setFocusDriverId, advancedConfig, setAdvancedConfig, gridDrivers, onSwapConfirm }) {
  const realistic = SIMULATION_MODES.realistic;
  const wildcard = SIMULATION_MODES.wildcard;
  const isRealistic = simulationMode === realistic;
  const [showAdvanced, setShowAdvanced] = useState(false);

  const applyPreset = (mode) => {
    setSimulationMode(mode);
    setAdvancedConfig({
      chaosLevel: mode.chaosLevel ?? 5,
      safetyCarFrequency: mode.safetyCarFrequency ?? 5,
      upgradesEnabled: true,
      wetWeatherBoost: 5,
      dnfRate: 5,
    });
  };

  return (
    <div className="min-h-screen text-white" style={{ background: BG_DARK, fontFamily: "var(--font-titillium)" }}>
      {/* Page header — full width, centred */}
      <div className="max-w-5xl mx-auto px-6 pt-14 pb-8 text-center">
        <h1 className="text-4xl md:text-5xl font-black uppercase tracking-wider">SINGLE SEASON</h1>
        <p className="mt-3 text-lg text-white/70">Follow every race of the {SEASON} season</p>
        <div className="mt-5 h-px w-24 mx-auto" style={{ background: F1_RED }} />
      </div>

      {/* Two-column layout: left = settings, right = driver picker */}
      <div className="max-w-5xl mx-auto px-6 pb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">

          {/* ── LEFT COLUMN: mode + advanced ── */}
          <div className="space-y-6">
            {/* Simulation mode */}
            <div>
              <p className="text-sm text-white/60 uppercase tracking-wider mb-3">Simulation mode</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { mode: realistic, label: "Realistic", desc: realistic.description, active: isRealistic, border: "#fff" },
                  { mode: wildcard, label: "Wildcard", desc: wildcard.description, active: !isRealistic, border: F1_RED },
                ].map(({ mode, label, desc, active, border }) => (
                  <button key={label} type="button" onClick={() => applyPreset(mode)}
                    className="text-left p-4 rounded-lg border-2 transition-all hover:opacity-90"
                    style={{ background: PANEL_BG, borderColor: active ? border : "rgba(255,255,255,0.15)" }}>
                    <p className="font-bold text-white">{label}</p>
                    <p className="text-sm text-white/60 mt-1">{desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Advanced settings */}
            <div className="rounded-lg border overflow-hidden" style={{ borderColor: PANEL_BORDER }}>
              <button type="button" onClick={() => setShowAdvanced((v) => !v)}
                className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/5 transition-colors"
                style={{ background: PANEL_BG }}>
                <span className="text-sm font-bold text-white/80 uppercase tracking-wider">Advanced settings</span>
                <span className="text-white/40 text-sm">{showAdvanced ? "▲ Hide" : "▼ Show"}</span>
              </button>
              {showAdvanced && (
                <div className="px-5 pb-5 space-y-5" style={{ background: PANEL_BG }}>
                  <Slider label="Chaos level" value={advancedConfig.chaosLevel} min={1} max={10}
                    onChange={(v) => setAdvancedConfig((c) => ({ ...c, chaosLevel: v }))}
                    description="Higher = more random results, upsets, position swings" colorHigh={F1_RED} />
                  <Slider label="Safety car frequency" value={advancedConfig.safetyCarFrequency} min={1} max={10}
                    onChange={(v) => setAdvancedConfig((c) => ({ ...c, safetyCarFrequency: v }))}
                    description="How often safety cars appear" />
                  <Slider label="DNF rate" value={advancedConfig.dnfRate} min={1} max={10}
                    onChange={(v) => setAdvancedConfig((c) => ({ ...c, dnfRate: v }))}
                    description="Reliability — higher = more retirements" colorHigh="#f87171" />
                  <Slider label="Wet weather variability" value={advancedConfig.wetWeatherBoost} min={1} max={10}
                    onChange={(v) => setAdvancedConfig((c) => ({ ...c, wetWeatherBoost: v }))}
                    description="How much rain shuffles the running order" />
                  <div className="flex items-center justify-between pt-1">
                    <div>
                      <p className="text-sm text-white/70">Team upgrades</p>
                      <p className="text-xs text-white/30">Teams gain pace mid-season</p>
                    </div>
                    <button type="button" onClick={() => setAdvancedConfig((c) => ({ ...c, upgradesEnabled: !c.upgradesEnabled }))}
                      className="px-4 py-2 rounded font-bold text-sm transition-all"
                      style={{ background: advancedConfig.upgradesEnabled ? F1_RED : "rgba(255,255,255,0.1)", color: "#fff" }}>
                      {advancedConfig.upgradesEnabled ? "On" : "Off"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* CTA buttons — sit naturally below settings on left col */}
            <div className="space-y-3 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => onBegin("racebyrace")}
                  className="py-4 font-black uppercase tracking-wider rounded transition-all hover:opacity-90 border-2"
                  style={{ background: F1_RED }}>
                  Race by Race →
                </button>
                <button type="button" onClick={() => onBegin("full")}
                  className="py-4 font-black uppercase tracking-wider text-white rounded transition-all hover:opacity-90"
                  style={{ background: "transparent", borderColor: F1_RED, color: F1_RED}}>
                  Full Season
                </button>
              </div>
              <p className="text-white/30 text-xs text-center">
                Race by Race: simulate one race at a time · Full Season: jump straight to the finale
              </p>
            </div>
          </div>

          {/* ── RIGHT COLUMN: driver picker ── */}
          <div>
            <DriverFocusPicker
              focusDriverId={focusDriverId}
              setFocusDriverId={setFocusDriverId}
              gridDrivers={gridDrivers}
              onSwapConfirm={onSwapConfirm}
            />
          </div>

        </div>
      </div>
    </div>
  );
}

// ─── QUALIFYING SESSION PANEL ─────────────────────────────────────────────
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
            const isPole = isQ3 && row.pos === 1;
            return (
              <tr key={row.driverId} className="border-b"
                style={{ borderColor: PANEL_BORDER, background: isPole ? "rgba(255,215,0,0.08)" : isFocus ? "rgba(225,6,0,0.12)" : undefined, opacity: row.eliminated ? 0.45 : 1 }}>
                <td className="pl-4 py-2 w-8 text-white/40 font-mono text-xs">{row.pos}</td>
                <td className="py-2 w-3">{t && <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: t.color }} />}</td>
                <td className="py-2 pl-2 text-white font-medium">{d?.flag} {d?.name ?? row.driverId}</td>
                <td className="py-2 text-white/40 text-xs">{t?.name}</td>
                <td className="pr-2 py-2 text-right font-mono text-xs" style={{ color: isPole ? GOLD : row.eliminated ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.8)" }}>
                  {isPole && "🏆 "}{row.time}
                </td>
                <td className="pr-2 py-2 text-right font-mono text-xs w-20" style={{ color: "rgba(255,255,255,0.35)" }}>
                  {row.gap ?? ""}
                </td>
                <td className="pr-3 py-2 w-10">
                  {row.eliminated && <span className="text-xs px-1.5 py-0.5 rounded font-bold" style={{ background: "rgba(225,6,0,0.25)", color: F1_RED }}>OUT</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── INTERACTIVE LAP CHART ────────────────────────────────────────────────
function InteractiveLapChart({ positionCheckpoints, qualifyingOrder, results, drivers, teams, focusDriverId, numCheckpoints }) {
  const [hidden, setHidden] = useState(new Set());
  const toggle = (id) => setHidden((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const getColor = (id) => getTeam(teams, getDriver(drivers, id)?.teamId)?.color ?? "#666";
  const width = 760, height = 240;
  const pad = { top: 16, right: 16, bottom: 28, left: 32 };
  const cw = width - pad.left - pad.right, ch = height - pad.top - pad.bottom, maxPos = 22;
  const lines = qualifyingOrder.map((id) => {
    const cps = positionCheckpoints[id] || [];
    const pts = cps.map((pos, i) => [pad.left + (i / (numCheckpoints - 1)) * cw, pad.top + (Math.min(pos, maxPos) / maxPos) * ch]);
    return { id, pts, color: getColor(id), isFocus: id === focusDriverId };
  });
  return (
    <div>
      <div className="px-4 pt-3 pb-2 border-b flex flex-wrap gap-1.5 items-center" style={{ borderColor: PANEL_BORDER }}>
        <button type="button" onClick={() => setHidden(new Set())} className="text-xs px-2 py-1 rounded border" style={{ borderColor: "rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.6)" }}>All</button>
        <button type="button" onClick={() => setHidden(new Set(qualifyingOrder.filter((id) => id !== focusDriverId)))} className="text-xs px-2 py-1 rounded border mr-1" style={{ borderColor: "rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.6)" }}>Focus only</button>
        {qualifyingOrder.map((id) => {
          const d = getDriver(drivers, id);
          const color = getColor(id);
          const isOn = !hidden.has(id);
          return (
            <button key={id} type="button" onClick={() => toggle(id)}
              className="text-xs px-2 py-1 rounded-full border transition-all font-medium"
              style={{ borderColor: isOn ? color : "rgba(255,255,255,0.15)", background: isOn ? color + "28" : "transparent", color: isOn ? "#fff" : "rgba(255,255,255,0.3)", outline: id === focusDriverId ? "2px solid " + color : undefined, outlineOffset: "1px" }}>
              {d?.short ?? id}
            </button>
          );
        })}
      </div>
      <div className="p-4" style={{ height: "280px" }}>
        <svg width="100%" height={height} viewBox={"0 0 " + width + " " + height} className="overflow-visible">
          {[1, 5, 10, 15, 20].map((p) => (
            <g key={p}>
              <line x1={pad.left} y1={pad.top + (p / maxPos) * ch} x2={pad.left + cw} y2={pad.top + (p / maxPos) * ch} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
              <text x={pad.left - 6} y={pad.top + (p / maxPos) * ch + 4} fill="rgba(255,255,255,0.4)" fontSize="9" textAnchor="end">{p}</text>
            </g>
          ))}
          {[0, 5, 10, 15, 19].map((i) => (
            <text key={i} x={pad.left + (i / (numCheckpoints - 1)) * cw} y={height - 6} fill="rgba(255,255,255,0.4)" fontSize="9" textAnchor="middle">
              {i === 0 ? "START" : i === 19 ? "FINISH" : "L" + Math.round((i / 19) * 57)}
            </text>
          ))}
          {lines.map(({ id, pts, color, isFocus }) => {
            if (hidden.has(id) || pts.length < 2) return null;
            const path = "M " + pts.map((p) => p[0] + "," + p[1]).join(" L ");
            const dnf = results.find((r) => r.driverId === id)?.dnf;
            const last = pts[pts.length - 1];
            return (
              <g key={id}>
                <path d={path} fill="none" stroke={color} strokeWidth={isFocus ? 3 : 1.2} strokeOpacity={isFocus ? 1 : 0.65} />
                {dnf && last && <circle cx={last[0]} cy={last[1]} r={isFocus ? 5 : 3} fill="none" stroke="#e11" strokeWidth="1.5" />}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ─── TYRE STRATEGY ────────────────────────────────────────────────────────
const TYRE_COLORS = { soft: "#E10600", medium: "#FFD700", hard: "#888", intermediate: "#22c55e", wet: "#3b82f6" };
const TYRE_LABEL = { soft: "S", medium: "M", hard: "H", intermediate: "I", wet: "W" };

function TyreStrategy({ tyreStints, results, drivers, teams, focusDriverId }) {
  const sorted = [...(results || [])].sort((a, b) => {
    if (a.dnf && !b.dnf) return 1;
    if (!a.dnf && b.dnf) return -1;
    return (a.position ?? 99) - (b.position ?? 99);
  });
  return (
    <div className="p-3 space-y-1">
      {sorted.map((r) => {
        const id = r.driverId;
        const stints = tyreStints[id] || [];
        const d = getDriver(drivers, id);
        const t = getTeam(teams, r.teamId);
        const total = stints.reduce((s, x) => s + x.laps, 0);
        const isFocus = id === focusDriverId;
        return (
          <div key={id} className="flex items-center gap-2 py-0.5"
            style={{ background: isFocus ? "rgba(225,6,0,0.08)" : undefined, borderRadius: "4px" }}>
            <span className="w-6 text-right text-xs font-mono shrink-0" style={{ color: r.dnf ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.4)" }}>
              {r.dnf ? "—" : r.position}
            </span>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: t?.color ?? "#666" }} />
            <span className="w-20 text-xs truncate shrink-0"
              style={{ color: isFocus ? "#fff" : r.dnf ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.75)", fontWeight: isFocus ? 700 : 400 }}>
              {d?.short ?? d?.name?.split(" ").pop() ?? id}
            </span>
            <div className="flex-1 flex gap-px h-5">
              {stints.length === 0 ? (
                <div className="flex-1 rounded text-xs flex items-center justify-center text-white/20" style={{ background: "rgba(255,255,255,0.05)" }}>—</div>
              ) : stints.map((st, i) => {
                const w = total > 0 ? (st.laps / total) * 100 : 0;
                const color = TYRE_COLORS[st.compound] ?? "#555";
                const label = TYRE_LABEL[st.compound] ?? "?";
                return (
                  <div key={i} className="flex items-center justify-center text-xs font-black rounded-sm"
                    style={{ width: w + "%", minWidth: "18px", background: color, color: st.compound === "medium" || st.compound === "hard" ? "#000" : "#fff", opacity: r.dnf ? 0.5 : 1 }}
                    title={st.compound + " · " + st.laps + " laps"}>
                    {w > 10 ? label : ""}
                  </div>
                );
              })}
            </div>
            <span className="w-8 text-right text-xs shrink-0" style={{ color: "rgba(255,255,255,0.25)" }}>
              {total > 0 ? total : ""}
            </span>
          </div>
        );
      })}
      <div className="flex gap-3 pt-2 flex-wrap">
        {Object.entries(TYRE_LABEL).map(([compound, label]) => (
          <div key={compound} className="flex items-center gap-1">
            <span className="w-4 h-4 rounded-sm text-xs font-black flex items-center justify-center"
              style={{ background: TYRE_COLORS[compound], color: compound === "medium" || compound === "hard" ? "#000" : "#fff" }}>{label}</span>
            <span className="text-xs capitalize" style={{ color: "rgba(255,255,255,0.35)" }}>{compound}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── RACE RESULTS TABLE ───────────────────────────────────────────────────
function RaceResultsTable({ results, drivers, teams, focusDriverId }) {
  const sorted = [...(results || [])].sort((a, b) => { if (a.dnf && !b.dnf) return 1; if (!a.dnf && b.dnf) return -1; return (a.position ?? 99) - (b.position ?? 99); });
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wider border-b" style={{ borderColor: PANEL_BORDER, color: "rgba(255,255,255,0.4)" }}>
          <th className="pl-4 py-2 w-10">Pos</th><th className="py-2 w-4" /><th className="py-2">Driver</th><th className="py-2">Team</th><th className="py-2 text-right">Gap</th><th className="pr-4 py-2 text-right w-12">Pts</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => {
          const d = getDriver(drivers, r.driverId);
          const t = getTeam(teams, r.teamId);
          const medal = r.position === 1 ? GOLD : r.position === 2 ? SILVER : r.position === 3 ? BRONZE : undefined;
          const isFocus = r.driverId === focusDriverId;
          return (
            <tr key={r.driverId} className="border-b" style={{ borderColor: PANEL_BORDER, background: isFocus ? "rgba(225,6,0,0.12)" : r.dnf ? "rgba(255,255,255,0.01)" : undefined }}>
              <td className="pl-4 py-2 font-black text-sm" style={{ color: r.dnf ? "rgba(255,255,255,0.2)" : medal ?? "rgba(255,255,255,0.8)" }}>{r.dnf ? "DNF" : r.position}</td>
              <td className="py-2 pr-1">{t && <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: t.color }} />}</td>
              <td className="py-2 font-medium" style={{ color: r.dnf ? "rgba(255,255,255,0.4)" : "#fff" }}>
                {d?.flag} {d?.name ?? r.driverId}
                {r.dnf && <span className="ml-2 text-xs text-red-400">{r.dnfReason ?? "DNF"}</span>}
              </td>
              <td className="py-2 text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>{t?.name}</td>
               <td className="py-2 text-right text-xs font-mono" style={{ color: r.position === 1 ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.6)" }}>{r.dnf ? "" : r.position === 1 ? "WINNER" : r.gap ?? ""}</td>
              <td className="pr-4 py-2 text-right font-bold" style={{ color: r.points > 0 ? "#fff" : "rgba(255,255,255,0.3)" }}>{r.dnf ? "" : (r.points ?? 0)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── RADIO CARD ───────────────────────────────────────────────────────────
function RadioCard({ driver, team, text, label }) {
  return (
    <div className="rounded-lg border border-l-4 p-4" style={{ background: PANEL_BG, borderColor: PANEL_BORDER, borderLeftColor: team?.color ?? F1_RED }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-black tracking-widest px-2 py-0.5 rounded" style={{ background: "rgba(0,200,80,0.15)", color: "#4ade80" }}>● {label}</span>
        <span className="text-white font-bold text-sm">{driver?.flag} {driver?.name}</span>
        {team && <span className="text-xs" style={{ color: team.color }}>{team.name}</span>}
      </div>
      <p className="text-white/90 text-sm font-mono leading-relaxed">{text}</p>
    </div>
  );
}

// ─── RACE DASHBOARD (reusable — live race + finale races tab) ─────────────
function RaceReportBody({ text }) {
  if (!text) return null;

  const sentences = text
    .split(/\n\n|\n/)
    .flatMap((block) =>
      block
        .split(/(?<=\.)\s+/)
        .map((s) => s.trim())
        .filter(Boolean)
    );

  function iconFor(s) {
    const l = s.toLowerCase();
    if (l.includes("power unit"))                                                return "🔥";
    if (l.includes("engine"))                                                    return "🔥";
    if (l.includes("collision") || l.includes("contact") || l.includes("incident")) return "💥";
    if (l.includes("puncture") || l.includes("blowout"))                        return "🔴";
    if (l.includes("hydraulic"))                                                 return "⚠️";
    if (l.includes("gearbox"))                                                   return "⚙️";
    if (l.includes("suspension"))                                                return "🔧";
    if (l.includes("brake"))                                                     return "🛑";
    if (l.includes("electrical"))                                                return "⚡";
    if (l.includes("retired") || l.includes("retirement") || l.includes("retire")) return "🚩";
    if (l.includes("safety car") || l.includes("virtual safety"))               return "🟡";
    if (l.includes("wet") || l.includes("rain") || l.includes("intermediate"))  return "🌧️";
    if (l.includes("pole") || l.includes("qualifying"))                         return "⏱️";
    if (l.includes("champion") || l.includes("title") || l.includes("standings")) return "🏆";
    if (l.includes("fastest lap"))                                               return "⚡";
    if (l.includes("driver of the day"))                                         return "⭐";
    if (l.includes("overtake") || l.includes("passed") || l.includes("charging")) return "🔁";
    if (l.includes("pit stop") || l.includes("strategy") || l.includes("tyre")) return "🔩";
    if (l.includes("victory") || l.includes("winner") || l.includes("podium"))  return "🥇";
    return "▸";
  }

  return (
    <div className="space-y-3">
      {sentences.map((s, i) => (
        <div key={i} className="flex gap-2.5 items-start">
          <span className="shrink-0 mt-0.5 text-sm w-5 text-center">{iconFor(s)}</span>
          <p className="text-white/85 text-sm leading-relaxed">{s}</p>
        </div>
      ))}
    </div>
  );
}
function RaceDashboard({ raceResult, round, race, drivers, focusDriverId, reportContent, reportLoading, radioWinner, radioFocus, radioLoading, onGenerateReport }) {
  const [tab, setTab] = useState("qualifying");
  const trackTemp = useMemo(() => getTrackTemp(race, raceResult?.weather), [race, raceResult?.weather]);
  const qualiData = useMemo(() => buildQualifyingData(raceResult?.qualifyingOrder || [], drivers, TEAMS, raceResult?.weather, round * 100), [raceResult, round, drivers]);
  const qualifyingOrder = raceResult?.qualifyingOrder || [];
  const positionCheckpoints = raceResult?.positionCheckpoints || {};
  const tyreStints = raceResult?.tyreStints || {};
  const overtakeCount = raceResult?.overtakeCount || {};
  const driverOfDayId = raceResult?.driverOfDay;
  const driverOfDay = driverOfDayId ? getDriver(drivers, driverOfDayId) : null;
  const winner = raceResult?.results?.[0];
  const winnerDriver = winner ? getDriver(drivers, winner.driverId) : null;
  const winnerTeam = winner ? getTeam(TEAMS, winner.teamId) : null;

  const TABS = [{ id: "qualifying", label: "QUALIFYING" }, { id: "race", label: "RACE" }, { id: "analysis", label: "ANALYSIS" }];

  return (
    <div>
      <div className="flex border-b" style={{ borderColor: PANEL_BORDER }}>
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className="px-4 py-2.5 text-xs font-black tracking-widest uppercase transition-all relative"
            style={{ color: tab === t.id ? "#fff" : "rgba(255,255,255,0.4)" }}>
            {t.label}
            {tab === t.id && <span className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: F1_RED }} />}
          </button>
        ))}
      </div>

      <div className="p-4 space-y-4">
        {tab === "qualifying" && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-4 text-sm">
              {[
                { label: "Conditions", value: raceResult?.weather ?? "Dry", colored: true },
                { label: "Track Temp", value: trackTemp + "°C" },
                { label: "Air Temp", value: Math.round(trackTemp * 0.72) + "°C" },
              ].map(({ label, value, colored }) => (
                <div key={label}>
                  <p className="text-xs text-white/40 uppercase">{label}</p>
                  <p className="font-bold mt-0.5 capitalize" style={{ color: colored && raceResult?.weather === "wet" ? "#88aaff" : colored && raceResult?.weather === "mixed" ? "#ffaa44" : "#fff" }}>{value}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <QualiSessionPanel label="Q1" rows={qualiData.q1} drivers={drivers} teams={TEAMS} focusDriverId={focusDriverId} />
              <QualiSessionPanel label="Q2" rows={qualiData.q2} drivers={drivers} teams={TEAMS} focusDriverId={focusDriverId} />
              <QualiSessionPanel label="Q3" rows={qualiData.q3} drivers={drivers} teams={TEAMS} focusDriverId={focusDriverId} isQ3 />
            </div>
          </div>
        )}

        {tab === "race" && (
          <div className="grid grid-cols-5 gap-4">
            {/* LEFT — winner card + results */}
            <div className="col-span-2 space-y-3">
              {winnerDriver && (
                <div className="rounded-lg px-4 py-3 border" style={{ background: winnerTeam?.color ? winnerTeam.color + "18" : PANEL_BG, borderColor: winnerTeam?.color ? winnerTeam.color + "44" : PANEL_BORDER }}>
                  <p className="text-xs text-white/40 uppercase">Winner</p>
                  <p className="font-black text-white text-base mt-0.5">{winnerDriver.flag} {winnerDriver.name}</p>
                  <p className="text-xs mt-0.5" style={{ color: winnerTeam?.color }}>{winnerTeam?.name}</p>
                  {raceResult?.safetyCarDeployed && <span className="mt-2 inline-block text-xs font-bold px-2 py-0.5 rounded" style={{ background: "rgba(255,200,0,0.15)", color: "#ffcc00" }}>SC deployed</span>}
                </div>
              )}
              <div className="rounded-lg border overflow-hidden" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
                <div className="px-3 py-2 border-b" style={{ borderColor: PANEL_BORDER }}><span className="text-xs font-black tracking-widest" style={{ color: F1_RED }}>RACE RESULT</span></div>
                <RaceResultsTable results={raceResult?.results} drivers={drivers} teams={TEAMS} focusDriverId={focusDriverId} />
              </div>
            </div>

            {/* RIGHT — lap chart, tyres */}
            <div className="col-span-3 space-y-3">
              <div className="rounded-lg border overflow-hidden" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
                <div className="px-3 py-2 border-b" style={{ borderColor: PANEL_BORDER }}><span className="text-xs font-black tracking-widest" style={{ color: F1_RED }}>LAP CHART</span></div>
                <InteractiveLapChart positionCheckpoints={positionCheckpoints} qualifyingOrder={qualifyingOrder} results={raceResult?.results || []} drivers={drivers} teams={TEAMS} focusDriverId={focusDriverId} numCheckpoints={20} />
              </div>
              <div className="rounded-lg border overflow-hidden" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
                <div className="px-3 py-2 border-b" style={{ borderColor: PANEL_BORDER }}><span className="text-xs font-black tracking-widest" style={{ color: F1_RED }}>TYRE STRATEGY</span></div>
                <TyreStrategy tyreStints={tyreStints} results={raceResult?.results} drivers={drivers} teams={TEAMS} focusDriverId={focusDriverId} />
              </div>
            </div>
          </div>
        )}

        {tab === "analysis" && (
          <div className="space-y-4">
            {driverOfDay && (() => {
              const dotdTeam = getTeam(TEAMS, driverOfDay.teamId);
              const dotdResult = raceResult?.results?.find((r) => r.driverId === driverOfDayId);
              const dotdQualiPos = qualifyingOrder.indexOf(driverOfDayId) + 1;
              return (
                <div className="rounded-lg p-4 border-l-4 border" style={{ background: PANEL_BG, borderLeftColor: dotdTeam?.color ?? F1_RED, borderColor: PANEL_BORDER }}>
                  <p className="text-xs text-white/40 uppercase">Driver of the Day</p>
                  <p className="text-xl font-black text-white mt-1">{driverOfDay.flag} {driverOfDay.name}</p>
                  <p className="text-white/60 text-sm mt-1">+{overtakeCount[driverOfDayId] || 0} positions · P{dotdQualiPos} → P{dotdResult?.position ?? "—"}</p>
                </div>
              );
            })()}
  <div className="rounded-lg border overflow-hidden" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
  <div className="px-4 py-2.5 border-b" style={{ borderColor: PANEL_BORDER }}><span className="text-xs font-black tracking-widest" style={{ color: F1_RED }}>RACE REPORT</span></div>
  <div className="p-4" style={{ background: "#0e0e22" }}>
    {reportLoading ? (
      <div className="animate-pulse space-y-2">{[1, 0.9, 0.8, 1, 0.75].map((w, i) => <div key={i} className="h-3 rounded bg-white/15" style={{ width: (w * 100) + "%" }} />)}</div>
    ) : reportContent ? (
      <RaceReportBody text={reportContent} />
                ) : (
                  <button type="button" onClick={onGenerateReport} className="px-4 py-2 rounded text-sm font-bold border transition-colors" style={{ borderColor: F1_RED, background: F1_RED + "22", color: "#fff" }}>
                    Generate report
                  </button>
                )}
              </div>
            </div>
            {!radioLoading && (radioWinner || radioFocus) && (
              <div className="space-y-3">
                {radioWinner && (() => { const wd = winner ? getDriver(drivers, winner.driverId) : null; const wt = winner ? getTeam(TEAMS, winner.teamId) : null; return <RadioCard driver={wd} team={wt} text={radioWinner} label="WINNER RADIO" />; })()}
                {radioFocus && (!winner || winner.driverId !== focusDriverId) && (() => { const fd = getDriver(drivers, focusDriverId); const ft = getTeam(TEAMS, fd?.teamId); return <RadioCard driver={fd} team={ft} text={radioFocus} label="DRIVER RADIO" />; })()}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CHAMPIONSHIP GAP CHART ───────────────────────────────────────────────
function ChampionshipGapChart({ cumulativePoints, driverStandings, drivers, seasonResults }) {
  const top5 = driverStandings.slice(0, 5);
  const leaderId = driverStandings[0]?.driverId;
  const n = seasonResults.length;
  if (!leaderId || n === 0) return null;

  const width = 700, height = 200;
  const pad = { top: 16, right: 80, bottom: 28, left: 44 };
  const cw = width - pad.left - pad.right;
  const ch = height - pad.top - pad.bottom;

  const gaps = top5.map((s) => ({
    driverId: s.driverId,
    color: getTeam(TEAMS, s.teamId)?.color ?? "#888",
    points: (cumulativePoints[s.driverId] || []).map((pts, i) => {
      const leaderPts = (cumulativePoints[leaderId] || [])[i] ?? 0;
      return leaderPts - pts;
    }),
  }));

  const maxGap = Math.max(...gaps.flatMap((g) => g.points), 10);
  const gridStep = maxGap <= 50 ? 10 : maxGap <= 150 ? 25 : maxGap <= 300 ? 50 : 100;
  const gridLines = [];
  for (let v = 0; v <= maxGap; v += gridStep) gridLines.push(v);

  return (
    <svg width="100%" height={height} viewBox={"0 0 " + width + " " + height} className="overflow-visible">
      {gridLines.map((v) => {
        const y = pad.top + (v / maxGap) * ch;
        return (
          <g key={v}>
            <line x1={pad.left} y1={y} x2={pad.left + cw} y2={y} stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
            <text x={pad.left - 6} y={y + 4} fill="rgba(255,255,255,0.4)" fontSize="9" textAnchor="end">{v}</text>
          </g>
        );
      })}
      {gaps.map(({ driverId, color, points }) => {
        if (points.length < 2) return null;
        const d = getDriver(drivers, driverId);
        const isLeader = driverId === leaderId;
        const pts = points.map((gap, i) => {
          const x = pad.left + (i / Math.max(n - 1, 1)) * cw;
          const y = pad.top + (Math.min(gap, maxGap) / maxGap) * ch;
          return [x, y];
        });
        const path = "M " + pts.map((p) => p[0] + "," + p[1]).join(" L ");
        const last = pts[pts.length - 1];
        return (
          <g key={driverId}>
            <path d={path} fill="none" stroke={color} strokeWidth={isLeader ? 2.5 : 1.5} strokeOpacity={isLeader ? 1 : 0.8} />
            {last && <text x={last[0] + 6} y={last[1] + 4} fill={color} fontSize="10" fontWeight="bold">{d?.short ?? d?.name?.split(" ").pop()}</text>}
          </g>
        );
      })}
      {[0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => (
        <text key={i} x={pad.left + (i / Math.max(n - 1, 1)) * cw} y={height - 6} fill="rgba(255,255,255,0.35)" fontSize="9" textAnchor="middle">R{i + 1}</text>
      ))}
    </svg>
  );
}

// ─── DRIVER POINTS BAR ────────────────────────────────────────────────────
function DriverPointsBar({ seasonResults, driverId, teamColor, drivers }) {
  const [tooltip, setTooltip] = useState(null);
  return (
    <div className="relative">
      <p className="text-xs text-white/40 uppercase mb-2">Points per race</p>
      <div className="flex gap-1 items-end" style={{ height: "60px" }}>
        {seasonResults.map((race, i) => {
          const r = race.results?.find((x) => x.driverId === driverId);
          const pts = r?.points ?? 0;
          const isDnf = r?.dnf;
          const qualiPos = (race.qualifyingOrder || []).indexOf(driverId) + 1;
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end gap-0.5 cursor-pointer"
              onMouseEnter={() => setTooltip({ i, pts, isDnf, pos: r?.position, qualiPos, name: race.race?.name ?? "R" + (i + 1) })}
              onMouseLeave={() => setTooltip(null)}>
              <div className="w-full rounded-sm min-h-[3px] transition-opacity hover:opacity-80"
                style={{ height: Math.max(3, (pts / 25) * 48) + "px", background: isDnf ? "#e11" : pts > 0 ? (teamColor ?? F1_RED) : "rgba(255,255,255,0.1)" }} />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1 mt-1">
        {seasonResults.map((_, i) => <div key={i} className="flex-1 text-center text-white/20" style={{ fontSize: "8px" }}>{i + 1}</div>)}
      </div>
      {tooltip && (
        <div className="absolute bottom-full mb-2 z-10 pointer-events-none px-3 py-2 rounded text-xs text-white shadow-lg"
          style={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.15)", left: Math.min(Math.max(0, (tooltip.i / seasonResults.length) * 100 - 10), 70) + "%" }}>
          <p className="font-bold">{tooltip.name}</p>
          {tooltip.isDnf ? <p className="text-red-400">DNF</p> : <><p>Pos: P{tooltip.pos ?? "—"} · Quali: P{tooltip.qualiPos || "—"}</p><p style={{ color: teamColor ?? F1_RED }}>{tooltip.pts} pts</p></>}
        </div>
      )}
    </div>
  );
}
function RaceActionBar({ round, totalRounds, onNextRace, onSimulateToEnd, onFinishSeason }) {
  const isLast = round >= totalRounds;
  return (
    <div className="sticky top-0 z-40 border-b" style={{ background: BG_DARK + "f5", borderColor: PANEL_BORDER, backdropFilter: "blur(8px)" }}>
      <div className="max-w-5xl mx-auto px-4 py-2 flex items-center gap-3">
        {isLast ? (
          <button type="button" onClick={onFinishSeason}
            className="flex-1 py-2.5 font-black uppercase tracking-wider text-white rounded text-sm hover:opacity-90 transition-all"
            style={{ background: F1_RED }}>
            View Championship Finale →
          </button>
        ) : (
          <>
            <button type="button" onClick={onNextRace}
              className="flex-1 py-2.5 font-black uppercase tracking-wider text-white rounded text-sm hover:opacity-90 transition-all"
              style={{ background: F1_RED }}>
              {"Next Race: R" + (round + 1) + " →"}
            </button>
            <button type="button" onClick={onSimulateToEnd}
              className="py-2.5 px-5 font-black uppercase tracking-wider rounded text-sm hover:opacity-90 transition-all border-2 whitespace-nowrap"
              style={{ background: "transparent", borderColor: "rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.6)" }}>
              Simulate to End
            </button>
            <span className="text-white/25 text-xs whitespace-nowrap shrink-0">
              {(totalRounds - round) + " left"}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
// ─── RACE REVEAL SCREEN ───────────────────────────────────────────────────
function RaceRevealScreen({ raceResult, round, race, driverStandings, constructorStandings, previousRaceWinner, focusDriverId, seasonResults, onNextRace, onFinishSeason, onSimulateToEnd, onRestartSeason}) {
  const drivers = getActiveDrivers(DRIVERS);
  const [activeTab, setActiveTab] = useState("qualifying");
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [radioWinner, setRadioWinner] = useState(null);
  const [radioFocus, setRadioFocus] = useState(null);
  const [radioLoading, setRadioLoading] = useState(true);
  const trackTempRef = useRef(null);
  if (trackTempRef.current === null) trackTempRef.current = getTrackTemp(race, raceResult?.weather);
  const trackTemp = trackTempRef.current;

  useEffect(() => {
    setActiveTab("qualifying");
    trackTempRef.current = getTrackTemp(race, raceResult?.weather);
    if (!raceResult) return;
    setReport(null);
    setReportLoading(true);
    setRadioLoading(true);
    setRadioWinner(null);
    setRadioFocus(null);

    fetch("/api/race-report", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raceResult, qualifyingOrder: raceResult.qualifyingOrder || [], season: SEASON, round, totalRounds: TOTAL_ROUNDS, driverStandings, constructorStandings, previousRaceWinner, focusDriverId, drivers, teams: TEAMS, mode: "single" }),
    }).then((r) => r.json()).then((d) => setReport(d.commentary || "")).catch(() => setReport("Race report unavailable.")).finally(() => setReportLoading(false));

    const winner = raceResult.results?.[0];
    const focusResult = focusDriverId ? raceResult.results?.find((r) => r.driverId === focusDriverId) : null;
    const winnerDriver = winner ? getDriver(drivers, winner.driverId) : null;
    const focusDriver = focusDriverId ? getDriver(drivers, focusDriverId) : null;
    const promises = [];
    if (winnerDriver) {
      const wt = getTeam(TEAMS, winner.teamId);
      promises.push(fetch("/api/team-radio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ driverName: winnerDriver.name, teamName: wt?.name, position: 1, raceName: race?.name ?? "Grand Prix", isWin: true, isDNF: false, season: SEASON }) }).then((r) => r.json()).then((d) => setRadioWinner(d.radio)));
    }
    if (focusDriverId && focusDriver && (!winnerDriver || winnerDriver.id !== focusDriverId)) {
      const ft = getTeam(TEAMS, focusDriver.teamId);
      promises.push(fetch("/api/team-radio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ driverName: focusDriver.name, teamName: ft?.name, position: focusResult?.position, raceName: race?.name ?? "Grand Prix", isWin: false, isDNF: focusResult?.dnf ?? false, isFocusDriver: true, season: SEASON }) }).then((r) => r.json()).then((d) => setRadioFocus(d.radio)));
    }
    Promise.all(promises).finally(() => setRadioLoading(false));
  }, [raceResult?.results, round]);

  if (!raceResult) return null;

  const leader = driverStandings[0];
  const leaderName = leader ? getDriver(drivers, leader.driverId)?.name : "—";
  const TABS = [{ id: "qualifying", label: "QUALIFYING" }, { id: "race", label: "RACE" }, { id: "analysis", label: "ANALYSIS" }];
  const qualiData = buildQualifyingData(raceResult.qualifyingOrder || [], drivers, TEAMS, raceResult.weather, round * 100);

  return (
    <div className="min-h-screen text-white" style={{ background: BG_DARK, fontFamily: "var(--font-titillium)" }}>
      {/* Sticky header */}
      <div className="sticky top-0 z-30 border-b" style={{ background: BG_DARK + "f0", borderColor: PANEL_BORDER, backdropFilter: "blur(8px)" }}>
        <div className="max-w-5xl mx-auto px-4 pt-2 pb-1 flex items-center justify-between">
          <button type="button" onClick={onRestartSeason}
     className="text-white/40 text-xs hover:text-white/70 transition-colors">
     ↺ Restart Season
   </button>
          <Link href="/simulator" className="text-xs font-bold px-3 py-1 rounded border transition-all hover:bg-white/10" style={{ borderColor: "rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.6)" }}>Franchise Mode →</Link>
        </div>
        <div className="max-w-5xl mx-auto px-4 py-2 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-white/40 text-xs uppercase tracking-wider shrink-0">R{round}/{TOTAL_ROUNDS}</span>
            <span className="text-white font-black text-sm uppercase tracking-wide truncate">{race?.flag} {race?.name ?? "Grand Prix"}</span>
          </div>
          <div className="flex items-center gap-3 ml-auto flex-wrap">
            <span className="text-xs font-bold px-2 py-0.5 rounded uppercase"
              style={{ background: raceResult.weather === "wet" ? "rgba(0,100,255,0.25)" : raceResult.weather === "mixed" ? "rgba(255,150,0,0.25)" : "rgba(255,255,255,0.1)", color: raceResult.weather === "wet" ? "#88aaff" : raceResult.weather === "mixed" ? "#ffaa44" : "rgba(255,255,255,0.7)" }}>
              {raceResult.weather ?? "DRY"}
            </span>
            <span className="text-xs text-white/50">🌡 {trackTemp}°C</span>
            {raceResult.safetyCarDeployed && <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: "rgba(255,200,0,0.2)", color: "#ffcc00" }}>SC</span>}
            <span className="text-xs text-white/50 hidden sm:block">P1: <span className="text-white font-medium">{leaderName}</span> · {leader?.points ?? 0} pts</span>
          </div>
        </div>
        <div className="max-w-5xl mx-auto px-4 pb-1">
          <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div className="h-full rounded-full transition-all duration-500" style={{ width: ((round / TOTAL_ROUNDS) * 100) + "%", background: F1_RED }} />
          </div>
        </div>
        <div className="max-w-5xl mx-auto px-4 flex gap-0 border-t" style={{ borderColor: PANEL_BORDER }}>
          {TABS.map((t) => (
            <button key={t.id} type="button" onClick={() => setActiveTab(t.id)}
              className="px-6 py-3 text-xs font-black tracking-widest uppercase transition-all relative"
              style={{ color: activeTab === t.id ? "#fff" : "rgba(255,255,255,0.4)" }}>
              {t.label}
              {activeTab === t.id && <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t" style={{ background: F1_RED }} />}
            </button>
          ))}
        </div>
      </div>

      <div className="sticky z-20 border-b" style={{ top: "var(--header-h, 130px)", background: BG_DARK + "f5", borderColor: PANEL_BORDER, backdropFilter: "blur(8px)" }}>
        <div className="max-w-5xl mx-auto px-4 py-2 flex items-center gap-3">
          {round >= TOTAL_ROUNDS ? (
            <button type="button" onClick={onFinishSeason}
              className="flex-1 py-2.5 font-black uppercase tracking-wider text-white rounded text-sm hover:opacity-90 transition-all"
              style={{ background: F1_RED }}>
              View Championship Finale →
            </button>
          ) : (
            <>
              <button type="button" onClick={onNextRace}
                className="flex-1 py-2.5 font-black uppercase tracking-wider text-white rounded text-sm hover:opacity-90 transition-all"
                style={{ background: F1_RED }}>
                {"Next Race: R" + (round + 1) + " →"}
              </button>
              <button type="button" onClick={onSimulateToEnd}
                className="py-2.5 px-5 font-black uppercase tracking-wider rounded text-sm hover:opacity-90 transition-all border-2 whitespace-nowrap"
                style={{ background: "transparent", borderColor: "rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.6)" }}>
                Simulate to End
              </button>
              <span className="text-white/25 text-xs whitespace-nowrap shrink-0">
                {(TOTAL_ROUNDS - round) + " left"}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        {/* ── QUALIFYING TAB ── */}
        {activeTab === "qualifying" && (
          <div className="space-y-4">
            <div className="rounded-lg px-5 py-4 flex flex-wrap gap-6 border" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
              {[
                { label: "Circuit", value: race?.location ?? race?.name ?? "—" },
                { label: "Conditions", value: raceResult.weather ?? "Dry", colored: true },
                { label: "Track Temp", value: trackTemp + "°C" },
                { label: "Air Temp", value: Math.round(trackTemp * 0.72) + "°C" },
                { label: "Date", value: race?.date ?? "—" },
              ].map(({ label, value, colored }) => (
                <div key={label}>
                  <p className="text-xs text-white/40 uppercase tracking-wider">{label}</p>
                  <p className="font-bold mt-0.5 capitalize" style={{ color: colored && raceResult.weather === "wet" ? "#88aaff" : colored && raceResult.weather === "mixed" ? "#ffaa44" : "rgba(255,255,255,0.9)" }}>{value}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <QualiSessionPanel label="Q1" rows={qualiData.q1} drivers={drivers} teams={TEAMS} focusDriverId={focusDriverId} />
              <QualiSessionPanel label="Q2" rows={qualiData.q2} drivers={drivers} teams={TEAMS} focusDriverId={focusDriverId} />
              <QualiSessionPanel label="Q3" rows={qualiData.q3} drivers={drivers} teams={TEAMS} focusDriverId={focusDriverId} isQ3 />
            </div>
          </div>
        )}

        {/* ── RACE TAB ── */}
        {activeTab === "race" && (
          <div className="grid grid-cols-5 gap-4">
            {/* LEFT — winner card + full results */}
            <div className="col-span-2 space-y-3">
              {(() => {
                const w = raceResult.results?.[0];
                const wd = w ? getDriver(drivers, w.driverId) : null;
                const wt = w ? getTeam(TEAMS, w.teamId) : null;
                return w && (
                  <div className="rounded-lg px-4 py-3 border" style={{ background: wt?.color ? wt.color + "18" : PANEL_BG, borderColor: wt?.color ? wt.color + "44" : PANEL_BORDER }}>
                    <p className="text-xs text-white/40 uppercase">Winner</p>
                    <p className="text-white font-black text-xl mt-0.5">{wd?.flag} {wd?.name}</p>
                    <p className="text-xs mt-0.5" style={{ color: wt?.color }}>{wt?.name}</p>
                    {raceResult.safetyCarDeployed && <span className="mt-2 inline-block text-xs font-bold px-2 py-0.5 rounded" style={{ background: "rgba(255,200,0,0.15)", color: "#ffcc00" }}>SC deployed</span>}
                  </div>
                );
              })()}
              <div className="rounded-lg border overflow-hidden" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
                <div className="px-3 py-2 border-b" style={{ borderColor: PANEL_BORDER }}><span className="text-xs font-black tracking-widest" style={{ color: F1_RED }}>RACE RESULT</span></div>
                <RaceResultsTable results={raceResult.results} drivers={drivers} teams={TEAMS} focusDriverId={focusDriverId} />
              </div>
            </div>

            {/* RIGHT — lap chart, tyres, standings */}
            <div className="col-span-3 space-y-3">
              <div className="rounded-lg border overflow-hidden" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
                <div className="px-3 py-2 border-b" style={{ borderColor: PANEL_BORDER }}><span className="text-xs font-black tracking-widest" style={{ color: F1_RED }}>LAP CHART</span></div>
                <InteractiveLapChart positionCheckpoints={raceResult.positionCheckpoints || {}} qualifyingOrder={raceResult.qualifyingOrder || []} results={raceResult.results || []} drivers={drivers} teams={TEAMS} focusDriverId={focusDriverId} numCheckpoints={20} />
              </div>
              <div className="rounded-lg border overflow-hidden" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
                <div className="px-3 py-2 border-b" style={{ borderColor: PANEL_BORDER }}><span className="text-xs font-black tracking-widest" style={{ color: F1_RED }}>TYRE STRATEGY</span></div>
                <TyreStrategy tyreStints={raceResult.tyreStints || {}} results={raceResult.results} drivers={drivers} teams={TEAMS} focusDriverId={focusDriverId} />
              </div>
              {/* Championship standings — two cols */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border overflow-hidden" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
                  <div className="px-3 py-2 border-b" style={{ borderColor: PANEL_BORDER }}><span className="text-xs font-black tracking-widest" style={{ color: F1_RED }}>DRIVERS</span></div>
                  <div className="py-1">
                    {driverStandings.map((row, i) => {
                      const d = getDriver(drivers, row.driverId);
                      const t = getTeam(TEAMS, row.teamId);
                      const isFocus = row.driverId === focusDriverId;
                      const prevStandings = seasonResults.length > 1 ? buildDriverStandings(seasonResults.slice(0, -1), drivers) : [];
                      const prevIdx = prevStandings.findIndex((p) => p.driverId === row.driverId);
                      const moved = prevIdx >= 0 && i < prevIdx;
                      const dropped = prevIdx >= 0 && i > prevIdx;
                      return (
                        <div key={row.driverId} className="flex items-center gap-1.5 px-3 py-1"
                          style={{ background: isFocus ? "rgba(225,6,0,0.1)" : undefined }}>
                          <span className="text-xs font-mono w-5 text-white/40">{i + 1}</span>
                          {t && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: t.color }} />}
                          <span className="flex-1 text-xs truncate" style={{ color: isFocus ? "#fff" : "rgba(255,255,255,0.75)" }}>{d?.name?.split(" ").pop()}</span>
                          {moved && <span className="text-green-400 text-xs">▲</span>}
                          {dropped && <span className="text-red-400 text-xs">▼</span>}
                          <span className="text-xs font-bold text-white">{row.points}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="rounded-lg border overflow-hidden" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
                  <div className="px-3 py-2 border-b" style={{ borderColor: PANEL_BORDER }}><span className="text-xs font-black tracking-widest" style={{ color: F1_RED }}>CONSTRUCTORS</span></div>
                  <div className="py-1">
                    {constructorStandings.map((row, i) => {
                      const t = getTeam(TEAMS, row.teamId);
                      return (
                        <div key={row.teamId} className="flex items-center gap-1.5 px-3 py-1">
                          <span className="text-xs font-mono w-5 text-white/40">{i + 1}</span>
                          {t && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: t.color }} />}
                          <span className="flex-1 text-xs truncate text-white/75">{t?.name ?? row.teamId}</span>
                          <span className="text-xs font-bold text-white">{row.points}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── ANALYSIS TAB ── */}
        {activeTab === "analysis" && (
          <div className="space-y-4">
            {raceResult.driverOfDay && (() => {
              const d = getDriver(drivers, raceResult.driverOfDay);
              const t = getTeam(TEAMS, d?.teamId);
              const dotdResult = raceResult.results?.find((r) => r.driverId === raceResult.driverOfDay);
              const qp = (raceResult.qualifyingOrder || []).indexOf(raceResult.driverOfDay) + 1;
              return (
                <div className="rounded-lg p-5 border-l-4 border" style={{ background: PANEL_BG, borderLeftColor: t?.color ?? F1_RED, borderColor: PANEL_BORDER }}>
                  <p className="text-xs text-white/40 uppercase">Driver of the Day</p>
                  <p className="text-2xl font-black text-white mt-1">{d?.flag} {d?.name}</p>
                  <p className="text-sm mt-0.5" style={{ color: t?.color }}>{t?.name}</p>
                  <p className="text-white/60 text-sm mt-2">+{raceResult.overtakeCount?.[raceResult.driverOfDay] || 0} positions · P{qp} → P{dotdResult?.position ?? "—"}</p>
                </div>
              );
            })()}
            <div className="rounded-lg border overflow-hidden" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
              <div className="px-4 py-2.5 border-b" style={{ borderColor: PANEL_BORDER }}><span className="text-xs font-black tracking-widest" style={{ color: F1_RED }}>
              RACE REPORT</span></div>
              <div className="p-5" style={{ background: "#0e0e22" }}>
  {reportLoading
                  ? <div className="animate-pulse space-y-2">{[1, 0.9, 0.8, 1, 0.75].map((w, i) => <div key={i} className="h-3 rounded bg-white/15" style={{ width: (w * 100) + "%" }} />)}</div>
                  : <RaceReportBody text={report} />
                }
              </div>
            </div>
            {!radioLoading && (radioWinner || radioFocus) && (
              <div className="space-y-3">
                {radioWinner && (() => { const w = raceResult.results?.[0]; const wd = w ? getDriver(drivers, w.driverId) : null; const wt = w ? getTeam(TEAMS, w.teamId) : null; return <RadioCard driver={wd} team={wt} text={radioWinner} label="WINNER RADIO" />; })()}
                {radioFocus && (!raceResult.results?.[0] || raceResult.results[0].driverId !== focusDriverId) && (() => { const fd = getDriver(drivers, focusDriverId); const ft = getTeam(TEAMS, fd?.teamId); return <RadioCard driver={fd} team={ft} text={radioFocus} label="DRIVER RADIO" />; })()}
              </div>
            )}
          </div>
        )}

      </div>

    </div>
  );
}


// ─── FINALE SCREEN ────────────────────────────────────────────────────────
function FinaleScreen({ seasonResults, driverStandings, constructorStandings, focusDriverId, onPlayAgain }) {
  const drivers = getActiveDrivers(DRIVERS);
  const [tab, setTab] = useState("champion");
  const [expandedRace, setExpandedRace] = useState(null);
  const [expandedDriverId, setExpandedDriverId] = useState(null);
  const [raceReports, setRaceReports] = useState({});
  const [loadingReport, setLoadingReport] = useState(null);

  const wins = useMemo(() => { const w = {}; seasonResults.forEach((r) => { const id = r.results?.[0]?.driverId; if (id) w[id] = (w[id] || 0) + 1; }); return w; }, [seasonResults]);
  const podiums = useMemo(() => { const p = {}; seasonResults.forEach((r) => (r.results || []).slice(0, 3).forEach((x) => { if (!x.dnf) p[x.driverId] = (p[x.driverId] || 0) + 1; })); return p; }, [seasonResults]);
  const dnfs = useMemo(() => { const d = {}; seasonResults.forEach((r) => (r.results || []).filter((x) => x.dnf).forEach((x) => { d[x.driverId] = (d[x.driverId] || 0) + 1; })); return d; }, [seasonResults]);
  const poles = useMemo(() => { const p = {}; seasonResults.forEach((r) => { const id = r.qualifyingOrder?.[0]; if (id) p[id] = (p[id] || 0) + 1; }); return p; }, [seasonResults]);
  const bestFinish = useMemo(() => { const b = {}; seasonResults.forEach((r) => (r.results || []).forEach((x) => { if (!x.dnf) b[x.driverId] = Math.min(b[x.driverId] ?? 99, x.position ?? 99); })); return b; }, [seasonResults]);

  const cumulativePoints = useMemo(() => {
    const pts = {}; drivers.forEach((d) => (pts[d.id] = []));
    let running = {}; drivers.forEach((d) => (running[d.id] = 0));
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
  const focusPos = driverStandings.findIndex((s) => s.driverId === focusDriverId) + 1;

  const handleGenerateReport = async (race, round) => {
    const key = "race-" + round;
    if (raceReports[key] || loadingReport === key) return;
    setLoadingReport(key);
    try {
      const res = await fetch("/api/race-report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ raceResult: race, qualifyingOrder: race.qualifyingOrder ?? [], season: SEASON, round, totalRounds: TOTAL_ROUNDS, driverStandings, constructorStandings, focusDriverId, drivers, teams: TEAMS, mode: "single" }) });
      const data = await res.json();
      setRaceReports((p) => ({ ...p, [key]: data.commentary ?? "" }));
    } catch { setRaceReports((p) => ({ ...p, [key]: "Unable to generate report." })); }
    finally { setLoadingReport(null); }
  };

  const TABS = [{ id: "champion", label: "CHAMPION" }, { id: "drivers", label: "DRIVERS" }, { id: "races", label: "RACES" }, { id: "teams", label: "TEAMS" }];

  return (
    <div className="min-h-screen text-white" style={{ background: BG_DARK, fontFamily: "var(--font-titillium)" }}>
      <div className="border-b" style={{ borderColor: PANEL_BORDER }}>
        <div className="max-w-5xl mx-auto px-4 pt-10 pb-4 text-center">
          <p className="text-xs uppercase tracking-widest text-white/40 mb-1">2026 Season Complete</p>
          <h1 className="text-4xl md:text-5xl font-black" style={{ color: champTeam?.color ?? F1_RED }}>{champDriver?.name ?? "—"}</h1>
          <p className="text-white/60 mt-1">{champTeam?.name} · {champ?.points ?? 0} pts · {wins[champ?.driverId] || 0} wins</p>
        </div>
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
            <div className="rounded-lg p-6 border-l-4 border" style={{ background: PANEL_BG, borderColor: PANEL_BORDER, borderLeftColor: champTeam?.color ?? F1_RED }}>
              <p className="text-xs text-white/40 uppercase tracking-wider">World Champion</p>
              <p className="text-4xl font-black text-white mt-1">{champDriver?.flag} {champDriver?.name ?? "—"}</p>
              <p className="mt-1 font-bold" style={{ color: champTeam?.color ?? F1_RED }}>{champTeam?.name}</p>
              <div className="mt-4 grid grid-cols-4 gap-3">
                {[{ label: "Points", value: champ?.points ?? 0 }, { label: "Wins", value: wins[champ?.driverId] || 0 }, { label: "Podiums", value: podiums[champ?.driverId] || 0 }, { label: "Poles", value: poles[champ?.driverId] || 0 }].map(({ label, value }) => (
                  <div key={label} className="rounded p-3 text-center" style={{ background: "rgba(255,255,255,0.05)" }}>
                    <p className="text-2xl font-black text-white">{value}</p>
                    <p className="text-xs text-white/50 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
            </div>
            {focusDriver && focusDriverId !== champ?.driverId && (
              <div className="rounded-lg p-5 border-l-4 border" style={{ background: PANEL_BG, borderColor: PANEL_BORDER, borderLeftColor: focusTeam?.color ?? F1_RED }}>
                <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Your Driver</p>
                <p className="text-2xl font-black text-white">{focusDriver.flag} {focusDriver.name}</p>
                <p className="text-sm mt-0.5" style={{ color: focusTeam?.color }}>{focusTeam?.name}</p>
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {[{ label: "P" + focusPos, sub: "Championship" }, { label: driverStandings.find((s) => s.driverId === focusDriverId)?.points ?? 0, sub: "Points" }, { label: wins[focusDriverId] || 0, sub: "Wins" }, { label: podiums[focusDriverId] || 0, sub: "Podiums" }].map(({ label, sub }) => (
                    <div key={sub} className="rounded p-2 text-center" style={{ background: "rgba(255,255,255,0.05)" }}>
                      <p className="text-xl font-black text-white">{label}</p>
                      <p className="text-xs text-white/40 mt-0.5">{sub}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4">
                  <DriverPointsBar seasonResults={seasonResults} driverId={focusDriverId} teamColor={focusTeam?.color} drivers={drivers} />
                </div>
              </div>
            )}
            <div className="rounded-lg p-5 border-l-4 border" style={{ background: PANEL_BG, borderColor: PANEL_BORDER, borderLeftColor: conChampTeam?.color ?? F1_RED }}>
              <p className="text-xs text-white/40 uppercase tracking-wider">Constructors Champion</p>
              <p className="text-2xl font-black text-white mt-1">{conChampTeam?.name ?? "—"}</p>
              <p className="text-white/60">{conChamp?.points ?? 0} pts</p>
            </div>
            <div className="rounded-lg p-5 border" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
              <p className="text-xs text-white/40 uppercase tracking-wider mb-3">Season in numbers</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[{ label: "Races", value: seasonResults.length }, { label: "DNFs", value: Object.values(dnfs).reduce((a, b) => a + b, 0) }, { label: "Safety Cars", value: seasonResults.filter((r) => r.safetyCarDeployed).length }, { label: "Different Winners", value: Object.keys(wins).length }].map(({ label, value }) => (
                  <div key={label} className="rounded p-3 text-center" style={{ background: "rgba(255,255,255,0.04)" }}>
                    <p className="text-2xl font-black text-white">{value}</p>
                    <p className="text-xs text-white/40 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="pt-2 pb-8">
              <button type="button" onClick={onPlayAgain} className="w-full py-4 font-black uppercase tracking-wider rounded text-white hover:opacity-90" style={{ background: F1_RED }}>Play again</button>
            </div>
          </div>
        )}

        {/* ── DRIVERS TAB ── */}
        {tab === "drivers" && (
          <div className="space-y-5">
            <div className="rounded-lg border overflow-hidden" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
              <div className="px-4 py-2.5 border-b" style={{ borderColor: PANEL_BORDER }}><span className="text-xs font-black tracking-widest" style={{ color: F1_RED }}>DRIVER STANDINGS</span></div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider border-b" style={{ borderColor: PANEL_BORDER, color: "rgba(255,255,255,0.4)" }}>
                    <th className="pl-4 py-2 w-10">Pos</th><th className="py-2 w-4" /><th className="py-2">Driver</th><th className="py-2">Team</th><th className="py-2 text-right">Pts</th><th className="py-2 text-right">W</th><th className="py-2 text-right">Pod</th><th className="py-2 text-right">DNF</th><th className="pr-4 py-2 text-right">Best</th>
                  </tr>
                </thead>
                <tbody>
                  {driverStandings.map((row, i) => {
                    const d = getDriver(drivers, row.driverId);
                    const t = getTeam(TEAMS, row.teamId);
                    const medal = i === 0 ? GOLD : i === 1 ? SILVER : i === 2 ? BRONZE : undefined;
                    const isFocus = row.driverId === focusDriverId;
                    const isExpanded = expandedDriverId === row.driverId;
                    return (
                      <>
                        <tr key={row.driverId}
                          className="border-b cursor-pointer hover:bg-white/5 transition-colors"
                          style={{ borderColor: PANEL_BORDER, background: isFocus ? "rgba(225,6,0,0.1)" : isExpanded ? "rgba(255,255,255,0.04)" : undefined }}
                          onClick={() => setExpandedDriverId(isExpanded ? null : row.driverId)}>
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
                        {isExpanded && (
                          <tr key={row.driverId + "-exp"} style={{ borderColor: PANEL_BORDER }}>
                            <td colSpan={9} className="p-0">
                              <div className="px-4 py-4 border-b space-y-4" style={{ background: "rgba(255,255,255,0.03)", borderColor: t?.color ? t.color + "44" : PANEL_BORDER, borderLeft: "3px solid " + (t?.color ?? F1_RED) }}>
                                <div className="grid grid-cols-5 gap-2">
                                  {[{ label: "Points", value: row.points }, { label: "Wins", value: wins[row.driverId] || 0 }, { label: "Podiums", value: podiums[row.driverId] || 0 }, { label: "Poles", value: poles[row.driverId] || 0 }, { label: "DNFs", value: dnfs[row.driverId] || 0 }].map(({ label, value }) => (
                                    <div key={label} className="rounded p-2 text-center" style={{ background: "rgba(255,255,255,0.05)" }}>
                                      <p className="text-lg font-black text-white">{value}</p>
                                      <p className="text-xs text-white/40">{label}</p>
                                    </div>
                                  ))}
                                </div>
                                <DriverPointsBar seasonResults={seasonResults} driverId={row.driverId} teamColor={t?.color} drivers={drivers} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="rounded-lg border overflow-hidden" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
              <div className="px-4 py-2.5 border-b" style={{ borderColor: PANEL_BORDER }}><span className="text-xs font-black tracking-widest" style={{ color: F1_RED }}>CHAMPIONSHIP GAP — TOP 5 TO LEADER</span></div>
              <div className="p-4">
                <ChampionshipGapChart cumulativePoints={cumulativePoints} driverStandings={driverStandings} drivers={drivers} seasonResults={seasonResults} />
              </div>
            </div>
          </div>
        )}

        {/* ── RACES TAB ── */}
        {tab === "races" && (
          <div className="space-y-2">
            <p className="text-xs text-white/40 uppercase tracking-wider mb-3">Click a race to see full dashboard</p>
            {seasonResults.map((race, i) => {
              const rnd = race.round ?? i + 1;
              const raceName = race.race?.name ?? race.raceName ?? "Round " + rnd;
              const raceFlag = race.race?.flag ?? "🏁";
              const winner = race.results?.[0];
              const winnerDriver = winner ? getDriver(drivers, winner.driverId) : null;
              const winnerTeam = winner ? getTeam(TEAMS, winner.teamId) : null;
              const isExpanded = expandedRace === rnd;
              const reportKey = "race-" + rnd;
              return (
                <div key={rnd} className="rounded-lg border overflow-hidden transition-all" style={{ borderColor: isExpanded ? (winnerTeam?.color ?? F1_RED) : PANEL_BORDER }}>
                  <button type="button" onClick={() => setExpandedRace(isExpanded ? null : rnd)}
                    className="w-full text-left px-4 py-3 flex items-center gap-3 transition-colors hover:bg-white/5"
                    style={{ background: PANEL_BG }}>
                    <span className="text-white/40 text-xs font-mono w-8 shrink-0">R{rnd}</span>
                    <span className="text-lg shrink-0">{raceFlag}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-bold text-sm truncate">{raceName}</p>
                      <p className="text-xs mt-0.5" style={{ color: winnerTeam?.color ?? "rgba(255,255,255,0.5)" }}>{winnerDriver?.flag} {winnerDriver?.name ?? "—"}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {race.safetyCarDeployed && <span className="text-xs px-1.5 py-0.5 rounded font-bold" style={{ background: "rgba(255,200,0,0.15)", color: "#ffcc00" }}>SC</span>}
                      <span className="text-xs px-1.5 py-0.5 rounded capitalize"
                        style={{ background: race.weather === "wet" ? "rgba(0,100,255,0.2)" : race.weather === "mixed" ? "rgba(255,150,0,0.2)" : "rgba(255,255,255,0.08)", color: race.weather === "wet" ? "#88aaff" : race.weather === "mixed" ? "#ffaa44" : "rgba(255,255,255,0.5)" }}>
                        {race.weather ?? "dry"}
                      </span>
                      <span className="text-white/30 text-sm">{isExpanded ? "▲" : "▼"}</span>
                    </div>
                  </button>
                  {isExpanded && (
                    <div style={{ background: "#0a0a18" }}>
                      <RaceDashboard raceResult={race} round={rnd} race={race.race ?? GP_RACES[i]} drivers={drivers} focusDriverId={focusDriverId} reportContent={raceReports[reportKey]} reportLoading={loadingReport === reportKey} radioWinner={null} radioFocus={null} radioLoading={false} onGenerateReport={() => handleGenerateReport(race, rnd)} />
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
            <div className="rounded-lg border overflow-hidden" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
              <div className="px-4 py-2.5 border-b" style={{ borderColor: PANEL_BORDER }}><span className="text-xs font-black tracking-widest" style={{ color: F1_RED }}>CONSTRUCTOR STANDINGS</span></div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider border-b" style={{ borderColor: PANEL_BORDER, color: "rgba(255,255,255,0.4)" }}>
                    <th className="pl-4 py-2 w-10">Pos</th><th className="py-2">Team</th><th className="py-2 text-right">Pts</th><th className="pr-4 py-2 text-right">Wins</th>
                  </tr>
                </thead>
                <tbody>
                  {constructorStandings.map((row, i) => {
                    const t = getTeam(TEAMS, row.teamId);
                    const tw = seasonResults.reduce((s, r) => s + (r.results?.[0]?.teamId === row.teamId ? 1 : 0), 0);
                    const medal = i === 0 ? GOLD : i === 1 ? SILVER : i === 2 ? BRONZE : undefined;
                    return (
                      <tr key={row.teamId} className="border-b" style={{ borderColor: PANEL_BORDER }}>
                        <td className="pl-4 py-2.5 font-black" style={{ color: medal ?? "rgba(255,255,255,0.6)" }}>{i + 1}</td>
                        <td className="py-2.5"><div className="flex items-center gap-2">{t && <span className="w-3 h-3 rounded-full shrink-0" style={{ background: t.color }} />}<span className="text-white font-medium">{t?.name ?? row.teamId}</span></div></td>
                        <td className="py-2.5 text-right font-bold text-white">{row.points}</td>
                        <td className="pr-4 py-2.5 text-right text-white/60">{tw}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="rounded-lg border overflow-hidden" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
              <div className="px-4 py-2.5 border-b" style={{ borderColor: PANEL_BORDER }}><span className="text-xs font-black tracking-widest" style={{ color: F1_RED }}>TEAMMATE HEAD-TO-HEAD</span></div>
              <div className="divide-y" style={{ borderColor: PANEL_BORDER }}>
                {TEAMS.map((team) => {
                  const tds = driverStandings.filter((s) => s.teamId === team.id);
                  if (tds.length < 2) return null;
                  const [d1s, d2s] = tds;
                  const d1 = getDriver(drivers, d1s.driverId);
                  const d2 = getDriver(drivers, d2s.driverId);
                  const total = (d1s.points || 0) + (d2s.points || 0) || 1;
                  const d1pct = Math.round((d1s.points / total) * 100);
                  const isFocusTeam = d1s.driverId === focusDriverId || d2s.driverId === focusDriverId;
                  return (
                    <div key={team.id} className="px-4 py-4" style={{ background: isFocusTeam ? "rgba(225,6,0,0.06)" : undefined }}>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: team.color }} />
                        <span className="text-white font-bold text-sm">{team.name}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs mb-1">
                        <span className="w-24 text-right text-white/80 truncate">{d1?.name?.split(" ").pop()}</span>
                        <div className="flex-1 flex h-5 rounded overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                          <div className="h-full flex items-center justify-end pr-1 text-xs font-bold text-white/80" style={{ width: d1pct + "%", background: team.color + "cc", minWidth: "24px" }}>{d1s.points}</div>
                          <div className="h-full flex items-center pl-1 text-xs font-bold text-white/50" style={{ width: (100 - d1pct) + "%", minWidth: "24px" }}>{d2s.points}</div>
                        </div>
                        <span className="w-24 text-white/80 truncate">{d2?.name?.split(" ").pop()}</span>
                      </div>
                      <div className="text-xs text-white/40 pl-28">
                        {wins[d1s.driverId] || 0}W {podiums[d1s.driverId] || 0}P <span className="mx-1 text-white/20">vs</span> {wins[d2s.driverId] || 0}W {podiums[d2s.driverId] || 0}P
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

// ─── MAIN PAGE ────────────────────────────────────────────────────────────
export default function SingleSeasonPage() {
  const [screen, setScreen] = useState("setup");
  const [simulationMode, setSimulationMode] = useState(SIMULATION_MODES.realistic);
  const [focusDriverId, setFocusDriverId] = useState("norris");
  const [seasonResults, setSeasonResults] = useState([]);
  const [currentRound, setCurrentRound] = useState(0);
  const [currentRaceResult, setCurrentRaceResult] = useState(null);
  const [loadingNext, setLoadingNext] = useState(false);
  // "race" = single next race (2s), "full" = full season from setup (5s),
  // "toend" = simulate-to-end from mid-season (5s)
  const [loadingMode, setLoadingMode] = useState("race");
  const [advancedConfig, setAdvancedConfig] = useState({
    chaosLevel: SIMULATION_MODES.realistic.chaosLevel ?? 5,
    safetyCarFrequency: SIMULATION_MODES.realistic.safetyCarFrequency ?? 5,
    upgradesEnabled: true,
    wetWeatherBoost: 5,
    dnfRate: 5,
  });
  const [gridDrivers, setGridDrivers] = useState(() => getActiveDrivers(DRIVERS));

  const drivers = useMemo(() => gridDrivers, [gridDrivers]);
  const driverStandings = useMemo(() => buildDriverStandings(seasonResults, drivers), [seasonResults, drivers]);
  const constructorStandings = useMemo(() => buildConstructorStandings(seasonResults, TEAMS), [seasonResults]);
  const currentRace = currentRound >= 1 && currentRound <= TOTAL_ROUNDS ? GP_RACES[currentRound - 1] : null;
  const previousRaceWinner = seasonResults.length >= 2
    ? getDriver(drivers, seasonResults[seasonResults.length - 2]?.results?.[0]?.driverId)?.name
    : null;

  const simulateRound = useCallback((round) => {
    const race = GP_RACES[round - 1];
    if (!race) return null;
    const result = simulateSingleRace(race, round, gridDrivers, TEAMS, {
      chaosLevel: advancedConfig.chaosLevel,
      safetyCarFrequency: advancedConfig.safetyCarFrequency,
      upgradesEnabled: advancedConfig.upgradesEnabled,
      focusDriverId,
    });
    result.race = race;
    return result;
  }, [gridDrivers, advancedConfig.chaosLevel, advancedConfig.safetyCarFrequency, advancedConfig.upgradesEnabled, focusDriverId]);

  // Full season from setup screen — 5 second animation
  const handleBeginSeason = useCallback((mode) => {
    if (mode === "full") {
      setLoadingMode("full");
      setLoadingNext(true);
      setTimeout(() => {
        const allResults = [];
        for (let r = 1; r <= TOTAL_ROUNDS; r++) {
          const result = simulateRound(r);
          if (result) allResults.push(result);
        }
        setSeasonResults(allResults);
        setCurrentRound(TOTAL_ROUNDS);
        setCurrentRaceResult(allResults[allResults.length - 1]);
        setLoadingNext(false);
        setScreen("finale");
      }, 5000);
    } else {
      // Race by race — first race, 2 second animation
      setLoadingMode("race");
      setLoadingNext(true);
      setTimeout(() => {
        const result = simulateRound(1);
        setCurrentRaceResult(result);
        setSeasonResults([result]);
        setCurrentRound(1);
        setLoadingNext(false);
        setScreen("race");
      }, 2000);
    }
  }, [simulateRound]);

  // Next Race button — 2 second animation showing the upcoming race
  const handleNextRace = useCallback(() => {
    if (currentRound >= TOTAL_ROUNDS) return;
    const nextRound = currentRound + 1;
    setLoadingMode("race");
    setLoadingNext(true);
    setTimeout(() => {
      const result = simulateRound(nextRound);
      setCurrentRaceResult(result);
      setSeasonResults((prev) => [...prev, result]);
      setCurrentRound(nextRound);
      setLoadingNext(false);
    }, 2000);
  }, [currentRound, simulateRound]);

  // Simulate to End button — 5 second animation
  const handleSimulateToEnd = useCallback(() => {
    if (currentRound >= TOTAL_ROUNDS) { setScreen("finale"); return; }
    setLoadingMode("toend");
    setLoadingNext(true);
    setTimeout(() => {
      const remaining = [];
      for (let r = currentRound + 1; r <= TOTAL_ROUNDS; r++) {
        const result = simulateRound(r);
        if (result) remaining.push(result);
      }
      setSeasonResults((prev) => [...prev, ...remaining]);
      setCurrentRound(TOTAL_ROUNDS);
      setCurrentRaceResult(remaining[remaining.length - 1]);
      setLoadingNext(false);
      setScreen("finale");
    }, 5000);
  }, [currentRound, simulateRound]);

// ── Render guards — loadingNext must come FIRST so it overrides setup/race ──
  if (loadingNext) {
    const upcomingRound = currentRound + 1;
    const upcomingRace = GP_RACES[upcomingRound - 1] ?? null;
    const remainingCount = TOTAL_ROUNDS - currentRound;
    return (
      <RaceLoadingScreen
        race={upcomingRace}
        round={upcomingRound}
        totalRounds={TOTAL_ROUNDS}
        mode={loadingMode}
        remainingCount={remainingCount}
      />
    );
  }

  if (screen === "setup") {
    return (
      <SetupScreen
        onBegin={handleBeginSeason}
        simulationMode={simulationMode}
        setSimulationMode={setSimulationMode}
        focusDriverId={focusDriverId}
        setFocusDriverId={setFocusDriverId}
        advancedConfig={advancedConfig}
        setAdvancedConfig={setAdvancedConfig}
        gridDrivers={gridDrivers}
        onSwapConfirm={setGridDrivers}
      />
    );
  }

  if (screen === "finale") {
    return (
      <FinaleScreen
        seasonResults={seasonResults}
        driverStandings={driverStandings}
        constructorStandings={constructorStandings}
        focusDriverId={focusDriverId}
        onPlayAgain={() => {
          setScreen("setup");
          setSeasonResults([]);
          setCurrentRound(0);
          setCurrentRaceResult(null);
        }}
      />
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
  onSimulateToEnd={handleSimulateToEnd}
  onRestartSeason={() => { setScreen("setup"); setSeasonResults([]); setCurrentRound(0); setCurrentRaceResult(null); }}
/>
  );

  // ── Loading / tension screen ──────────────────────────────────────────
  if (loadingNext) {
    // For "race" mode: show the race that's about to be simulated.
    // currentRound is still the *previous* round at this point, so the
    // upcoming race is at index currentRound (0-based).
    const upcomingRound = loadingMode === "race" ? currentRound + 1 : currentRound + 1;
    const upcomingRace = GP_RACES[upcomingRound - 1] ?? null;
    const remainingCount = TOTAL_ROUNDS - currentRound;

    return (
      <RaceLoadingScreen
        race={upcomingRace}
        round={upcomingRound}
        totalRounds={TOTAL_ROUNDS}
        mode={loadingMode}           // "race" | "full" | "toend"
        remainingCount={remainingCount}
      />
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
      onSimulateToEnd={handleSimulateToEnd}
    />
  );
}
