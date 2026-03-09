"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  TEAMS,
  DRIVERS,
  RACES,
  RESERVE_DRIVERS,
  FUTURE_ROOKIES,
  SIMULATION_MODES,
  TEAM_BUDGETS,
} from "@/lib/f1Data";
import { simulateSeason } from "@/lib/simulationEngine";
import { resolveOffSeason, checkMidSeasonFirings } from "@/lib/franchiseEngine";

const F1_RED = "#E10600";
const BG_DARK = "#080812";
const PANEL_BG = "#0d0d1a";
const GOLD = "#FFD700";

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

function getDriver(drivers, id) {
  return drivers?.find((d) => d.id === id);
}

function getTeam(teams, id) {
  return teams?.find((t) => t.id === id);
}

function buildInitialFranchiseState(opts = {}) {
  const mode = opts.simulationMode ?? SIMULATION_MODES.realistic;
  const totalSeasons = opts.totalSeasons ?? 10;
  const teams = TEAMS.map((t) => ({
    ...deepClone(t),
    budget: TEAM_BUDGETS[t.id] ?? 100,
  }));
  const drivers = opts.drivers ? deepClone(opts.drivers) : [
    ...DRIVERS.map(deepClone),
    ...RESERVE_DRIVERS.map(deepClone),
    ...FUTURE_ROOKIES.map(deepClone),
  ];
  return {
    currentSeason: 2026,
    totalSeasons,
    startYear: 2026,
    simulationMode: mode,
    teams,
    drivers,
    seasonHistory: [],
    transfers: [],
    allOffSeasonNews: [],
  };
}

function getActiveDrivers(drivers) {
  return drivers.filter((d) => d.status === "active" && d.teamId);
}

function computeWinsFromRaces(races) {
  const wins = {};
  for (const race of races || []) {
    const winner = race.results?.[0]?.driverId;
    if (winner) wins[winner] = (wins[winner] || 0) + 1;
  }
  return wins;
}

// Full race-by-race breakdown: full grid, gaps, DNF reasons, weather, safety car
function RaceDetailBlock({ race, drivers, teams }) {
  const results = race.results || [];
  const getD = (id) => getDriver(drivers, id);
  const getT = (id) => getTeam(teams, id);
  const raceName = race.name ?? race.raceName ?? `Round ${race.round}`;
  const raceFlag = race.flag ?? (RACES.find((r) => r.round === race.round)?.flag) ?? "🏁";
  const weatherLabel = (race.weather || "dry").charAt(0).toUpperCase() + (race.weather || "dry").slice(1);
  const safetyCar = race.safetyCarDeployed ?? false;
  const isSprint = race.isSprint ?? (RACES.find((r) => r.round === race.round)?.isSprint) ?? false;

  return (
    <div className="rounded-lg border border-white/10 overflow-hidden" style={{ background: PANEL_BG }}>
      <div className="p-4 border-b border-white/10">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-2xl">{raceFlag}</span>
          <div>
            <p className="text-white font-bold text-lg">{raceName}</p>
            <p className="text-white/60 text-sm">
              Round {race.round}
              {isSprint && <span className="ml-2 px-2 py-0.5 rounded text-xs font-bold" style={{ background: F1_RED }}>SPRINT</span>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-4 mt-2 text-sm text-white/70">
          <span>Weather: {weatherLabel}</span>
          {safetyCar && <span className="text-white">Safety car deployed</span>}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[32rem] text-white">
          <thead>
            <tr className="text-left text-white/60 border-b border-white/10">
              <th className="p-2 w-12">Pos</th>
              <th className="p-2 w-8"></th>
              <th className="p-2">Driver</th>
              <th className="p-2">Team</th>
              <th className="p-2 w-20">Gap</th>
              <th className="p-2 w-14">Pts</th>
              <th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => {
              const driver = getD(r.driverId);
              const team = getT(r.teamId);
              const medal = r.position === 1 ? GOLD : r.position === 2 ? "#C0C0C0" : r.position === 3 ? "#CD7F32" : undefined;
              const status = r.dnf ? (r.dnfReason ? `DNF (${r.dnfReason})` : "DNF") : (r.fastestLap ? "Fastest lap" : "");
              return (
                <tr
                  key={`${r.driverId}-${r.position}`}
                  className="border-b border-white/5"
                >
                  <td className="p-2 font-bold text-white" style={medal ? { color: medal } : undefined}>{r.position}</td>
                  <td className="p-2">{driver ? driver.flag : ""}</td>
                  <td className="p-2 text-white">{driver ? driver.name : r.driverId}</td>
                  <td className="p-2 flex items-center gap-1.5">
                    {team ? <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: team.color }} /> : null}
                    <span className="text-white/90">{team ? team.name : r.teamId}</span>
                  </td>
                  <td className="p-2 text-white/70 font-mono text-xs">{r.gap ?? (r.dnf ? "DNF" : "—")}</td>
                  <td className="p-2 text-white/90">{r.points ?? 0}</td>
                  <td className="p-2 text-white/70 text-xs">{status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── SIMULATION STATUS MESSAGES ─────────────────────────────────────────────
const RACE_MSG = (n, name) => `Race ${n}: ${name} underway...`;
const STATUS_CYCLE = [
  "Simulating qualifying...",
  (r, races) => (r && races[r - 1] ? RACE_MSG(r, races[r - 1].name) : "Racing..."),
  "Checking mid-season form...",
  "Applying team upgrades...",
  "Calculating championship...",
  "Resolving off-season transfers...",
  "Contracts expiring...",
  "Transfer window open...",
];

// ─── MODE MENU (Franchise vs Single Season) ─────────────────────────────────
function ModeMenu({ appMode, setAppMode, onSwitch }) {
  return (
    <div className="flex items-center justify-center gap-2 py-3 border-b border-white/10 text-white" style={{ background: PANEL_BG }}>
      <button
        type="button"
        onClick={() => onSwitch("franchise")}
        className="px-5 py-2 rounded font-bold text-sm uppercase tracking-wider transition-all"
        style={{
          background: appMode === "franchise" ? F1_RED : "transparent",
          border: `2px solid ${appMode === "franchise" ? F1_RED : "rgba(255,255,255,0.25)"}`,
          color: "#fff",
        }}
      >
        Franchise Mode
      </button>
      <button
        type="button"
        onClick={() => onSwitch("normal")}
        className="px-5 py-2 rounded font-bold text-sm uppercase tracking-wider transition-all"
        style={{
          background: appMode === "normal" ? F1_RED : "transparent",
          border: `2px solid ${appMode === "normal" ? F1_RED : "rgba(255,255,255,0.25)"}`,
          color: "#fff",
        }}
      >
        Single Season
      </button>
    </div>
  );
}

// ─── SCREEN 1: FRANCHISE SETUP ─────────────────────────────────────────────
function GridSeatChange({ currentDriverId, teamId, teamName, allActiveDrivers, teams, onSwap }) {
  const [open, setOpen] = useState(false);
  const otherDrivers = allActiveDrivers.filter((d) => d.id !== currentDriverId);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs px-2 py-0.5 rounded border border-white/30 text-white/80 hover:bg-white/10"
      >
        Change
      </button>
      {open && (
    <>
      <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
      <div className="absolute right-0 top-full mt-1 z-20 min-w-[12rem] max-h-48 overflow-auto rounded border border-white/20 shadow-lg py-1" style={{ background: PANEL_BG }}>
        {otherDrivers.map((d) => {
          const t = getTeam(teams, d.teamId);
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => { onSwap(currentDriverId, d.id); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-sm text-white/90 hover:bg-white/10 flex items-center gap-2"
            >
              <span>{d.flag}</span>
              <span className="truncate">{d.name}</span>
              {t && <span className="text-white/50 text-xs truncate">({t.name})</span>}
            </button>
          );
        })}
      </div>
    </>
      )}
    </div>
  );
}

function FranchiseSetup({ onBegin, simulationMode, setSimulationMode, totalSeasons, setTotalSeasons }) {
  const realistic = SIMULATION_MODES.realistic;
  const wildcard = SIMULATION_MODES.wildcard;
  const [draftDrivers, setDraftDrivers] = useState(() => [
    ...DRIVERS.map(deepClone),
    ...RESERVE_DRIVERS.map(deepClone),
    ...FUTURE_ROOKIES.map(deepClone),
  ]);
  const activeDraftDrivers = useMemo(() => draftDrivers.filter((d) => d.status === "active" && d.teamId), [draftDrivers]);
  const swapDrivers = useCallback((driverIdA, driverIdB) => {
    if (driverIdA === driverIdB) return;
    setDraftDrivers((prev) => {
      const next = prev.map((d) => ({ ...d }));
      const a = next.find((d) => d.id === driverIdA);
      const b = next.find((d) => d.id === driverIdB);
      if (!a || !b) return prev;
      const teamA = a.teamId;
      const teamB = b.teamId;
      a.teamId = teamB;
      b.teamId = teamA;
      return next;
    });
  }, []);
  const isRealistic = simulationMode === realistic;

  return (
    <div className="min-h-screen" style={{ background: BG_DARK }}>
      {/* Hero */}
      <div className="px-6 pt-12 pb-6 text-center">
        <h1 className="text-4xl md:text-5xl font-black uppercase tracking-wider text-white" style={{ fontFamily: "var(--font-titillium)" }}>
          F1 Franchise Mode
        </h1>
        <p className="mt-2 text-lg text-white/70">Simulate a decade of Formula 1</p>
        <div className="mt-4 h-px w-24 mx-auto" style={{ background: F1_RED }} />
      </div>

      {/* Two columns */}
      <div className="max-w-6xl mx-auto px-6 pb-8 grid grid-cols-1 lg:grid-cols-2 gap-10">
        {/* LEFT: Mode + Focus Driver */}
        <div className="space-y-8">
          <div>
            <p className="text-sm text-white/60 uppercase tracking-wider mb-3">Simulation mode</p>
            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setSimulationMode(realistic)}
                className="text-left p-5 rounded-lg border-2 transition-all"
                style={{
                  background: PANEL_BG,
                  borderColor: isRealistic ? "#fff" : "rgba(255,255,255,0.15)",
                  boxShadow: isRealistic ? "0 0 20px rgba(255,255,255,0.2)" : "none",
                }}
              >
                <p className="font-bold text-white">Realistic</p>
                <p className="text-sm text-white/70 mt-1">{realistic.description}</p>
                <p className="text-xs text-white/50 mt-2">Chaos 4/10 · Transfers 4/10</p>
              </button>
              <button
                type="button"
                onClick={() => setSimulationMode(wildcard)}
                className="text-left p-5 rounded-lg border-2 transition-all"
                style={{
                  background: PANEL_BG,
                  borderColor: !isRealistic ? F1_RED : "rgba(255,255,255,0.15)",
                  boxShadow: !isRealistic ? `0 0 20px ${F1_RED}40` : "none",
                }}
              >
                <p className="font-bold text-white">Wildcard</p>
                <p className="text-sm text-white/70 mt-1">{wildcard.description}</p>
                <p className="text-xs text-white/50 mt-2">Chaos 8/10 · Transfers 9/10</p>
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT: Season settings + Grid overview */}
        <div className="space-y-6">
          <div>
            <p className="text-sm text-white/60 uppercase tracking-wider mb-2">Seasons to simulate</p>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setTotalSeasons((s) => Math.max(1, s - 1))}
                className="w-12 h-12 rounded border border-white/30 text-white text-xl font-bold hover:bg-white/10"
              >
                −
              </button>
              <span className="text-4xl font-black text-white tabular-nums" style={{ fontFamily: "var(--font-titillium)", minWidth: "4rem", textAlign: "center" }}>
                {totalSeasons}
              </span>
              <button
                type="button"
                onClick={() => setTotalSeasons((s) => Math.min(10, s + 1))}
                className="w-12 h-12 rounded border border-white/30 text-white text-xl font-bold hover:bg-white/10"
              >
                +
              </button>
            </div>
          </div>

          <div>
            <p className="text-sm text-white/60 uppercase tracking-wider mb-2">Starting year</p>
            <p className="text-2xl font-bold text-white/80">2026</p>
          </div>
        </div>
      </div>

      {/* Grid overview — full width */}
      <div className="max-w-6xl mx-auto px-6 pb-8">
        <p className="text-sm text-white/60 uppercase tracking-wider mb-3">Grid overview</p>
        <p className="text-white/50 text-xs mb-2">Click Change to swap a driver with another on the grid.</p>
        <div className="rounded-lg border border-white/10 overflow-hidden" style={{ background: PANEL_BG }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-px bg-white/5">
            {TEAMS.map((t) => {
              const teamDrivers = activeDraftDrivers.filter((d) => d.teamId === t.id);
              return (
                <div key={t.id} className="p-3" style={{ background: PANEL_BG }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: t.color }} />
                    <span className="text-white font-semibold text-sm">{t.name}</span>
                  </div>
                  <div className="space-y-1.5 pl-5">
                    {[0, 1].map((slot) => {
                      const driver = teamDrivers[slot];
                      const driverLabel = driver ? `${driver.flag} ${driver.name} (${t.name})` : "—";
                      return (
                        <div key={slot} className="flex items-center justify-between gap-2">
                          <span className="text-white/90 text-sm truncate">{driverLabel}</span>
                          {driver && (
                            <GridSeatChange
                              currentDriverId={driver.id}
                              teamId={t.id}
                              teamName={t.name}
                              allActiveDrivers={activeDraftDrivers}
                              teams={TEAMS}
                              onSwap={swapDrivers}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Begin button */}
      <div className="max-w-2xl mx-auto px-6 pb-12">
        <button
          type="button"
          onClick={() => onBegin(draftDrivers)}
          className="w-full py-4 font-black uppercase tracking-wider text-white rounded transition-all hover:opacity-95"
          style={{
            background: F1_RED,
            boxShadow: "0 0 20px rgba(225, 6, 0, 0.3)",
            animation: "simulate-pulse 2s ease-in-out infinite",
          }}
        >
          Begin Franchise
        </button>
      </div>
    </div>
  );
}

// ─── NORMAL (SINGLE SEASON) SETUP ──────────────────────────────────────────
function NormalSetup({ onSimulate, chaosLevel, setChaosLevel, safetyCarFrequency, setSafetyCarFrequency, seasonLength, setSeasonLength, upgradesEnabled, setUpgradesEnabled }) {
  return (
    <div className="min-h-screen" style={{ background: BG_DARK }}>
      <div className="px-6 pt-10 pb-6 text-center">
        <h1 className="text-3xl md:text-4xl font-black uppercase tracking-wider text-white" style={{ fontFamily: "var(--font-titillium)" }}>
          Single Season Simulator
        </h1>
        <p className="mt-2 text-white/70">Run one 2026 season</p>
        <div className="mt-4 h-px w-24 mx-auto" style={{ background: F1_RED }} />
      </div>
      <div className="max-w-2xl mx-auto px-6 pb-10 space-y-6">
        <div className="p-5 rounded-lg border border-white/10" style={{ background: PANEL_BG }}>
          <p className="text-white/60 text-sm uppercase tracking-wider mb-2">Chaos level</p>
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => setChaosLevel((c) => Math.max(1, c - 1))} className="w-10 h-10 rounded border border-white/30 text-white font-bold">−</button>
            <span className="text-xl font-bold text-white w-12 text-center">{chaosLevel}</span>
            <button type="button" onClick={() => setChaosLevel((c) => Math.min(10, c + 1))} className="w-10 h-10 rounded border border-white/30 text-white font-bold">+</button>
          </div>
        </div>
        <div className="p-5 rounded-lg border border-white/10" style={{ background: PANEL_BG }}>
          <p className="text-white/60 text-sm uppercase tracking-wider mb-2">Safety car frequency</p>
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => setSafetyCarFrequency((s) => Math.max(1, s - 1))} className="w-10 h-10 rounded border border-white/30 text-white font-bold">−</button>
            <span className="text-xl font-bold text-white w-12 text-center">{safetyCarFrequency}</span>
            <button type="button" onClick={() => setSafetyCarFrequency((s) => Math.min(10, s + 1))} className="w-10 h-10 rounded border border-white/30 text-white font-bold">+</button>
          </div>
        </div>
        <div className="p-5 rounded-lg border border-white/10" style={{ background: PANEL_BG }}>
          <p className="text-white/60 text-sm uppercase tracking-wider mb-2">Season length</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setSeasonLength(24)} className={`flex-1 py-2 rounded font-bold ${seasonLength === 24 ? "bg-red-600 text-white" : "border border-white/30 text-white/80"}`}>Full (24)</button>
            <button type="button" onClick={() => setSeasonLength(12)} className={`flex-1 py-2 rounded font-bold ${seasonLength === 12 ? "bg-red-600 text-white" : "border border-white/30 text-white/80"}`}>Half (12)</button>
          </div>
        </div>
        <div className="p-5 rounded-lg border border-white/10" style={{ background: PANEL_BG }}>
          <p className="text-white/60 text-sm uppercase tracking-wider mb-2">Upgrades</p>
          <button type="button" onClick={() => setUpgradesEnabled(!upgradesEnabled)} className={`px-4 py-2 rounded font-bold ${upgradesEnabled ? "bg-red-600 text-white" : "border border-white/30 text-white/80"}`}>{upgradesEnabled ? "On" : "Off"}</button>
        </div>
        <button type="button" onClick={onSimulate} className="w-full py-4 font-black uppercase tracking-wider text-white rounded" style={{ background: F1_RED }}>
          Simulate Season
        </button>
      </div>
    </div>
  );
}

// ─── NORMAL RESULTS (single season) ─────────────────────────────────────────
function NormalResults({ result, onBack }) {
  const { races = [], driverStandings = [], constructorStandings = [], seasonStorylines = [] } = result;
  const [tab, setTab] = useState("champion");
  const [selectedRaceIndex, setSelectedRaceIndex] = useState(0);
  const champ = driverStandings[0];
  const champDriver = champ ? getDriver(DRIVERS, champ.driverId) : null;
  const champTeam = champ ? getTeam(TEAMS, champ.teamId) : null;

  return (
    <div className="min-h-screen" style={{ background: BG_DARK }}>
      <nav className="sticky top-0 z-40 flex items-center justify-between px-6 py-3 border-b" style={{ background: PANEL_BG, borderColor: F1_RED }}>
        <span className="text-white font-bold text-sm">2026 SEASON RESULTS</span>
        <div className="flex gap-2">
          {["champion", "standings", "races"].map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className="px-4 py-2 text-sm font-bold rounded border"
              style={{ borderColor: tab === t ? F1_RED : "rgba(255,255,255,0.3)", background: tab === t ? `${F1_RED}22` : "transparent", color: "#fff" }}>
              {t === "champion" ? "Champion" : t === "standings" ? "Standings" : "Races"}
            </button>
          ))}
        </div>
        <button type="button" onClick={onBack} className="px-4 py-2 text-sm font-bold rounded border border-white/50 text-white/90">New simulation</button>
      </nav>
      <div className="max-w-5xl mx-auto px-6 py-8">
        {tab === "champion" && (
          <div className="space-y-4">
            <div className="p-8 rounded-lg border-l-4" style={{ background: PANEL_BG, borderColor: champTeam ? champTeam.color : F1_RED }}>
              <p className="text-white/60 text-sm">World Champion</p>
              <p className="text-3xl font-black text-white" style={{ fontFamily: "var(--font-titillium)" }}>{champDriver ? champDriver.name : champ?.driverId}</p>
              <p className="text-white/80 mt-1">{champTeam ? champTeam.name : ""} · {champ?.points ?? 0} pts</p>
            </div>
            {seasonStorylines.length > 0 && (
              <div className="space-y-2">
                <p className="text-white/60 text-sm uppercase">Storylines</p>
                {seasonStorylines.map((s, i) => <p key={i} className="text-white/90">{s}</p>)}
              </div>
            )}
          </div>
        )}
        {tab === "standings" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-white font-bold mb-2">Driver standings</h4>
              <div className="rounded-lg border border-white/10 overflow-hidden" style={{ background: PANEL_BG }}>
                <table className="w-full text-sm text-white">
                  <thead><tr className="text-left text-white/60 border-b border-white/10"><th className="p-2">Pos</th><th className="p-2">Driver</th><th className="p-2">Team</th><th className="p-2">Pts</th></tr></thead>
                  <tbody>
                    {driverStandings.slice(0, 22).map((row, i) => {
                      const d = getDriver(DRIVERS, row.driverId);
                      const t = getTeam(TEAMS, row.teamId);
                      const medal = i === 0 ? GOLD : i === 1 ? "#C0C0C0" : i === 2 ? "#CD7F32" : undefined;
                      return (
                        <tr key={row.driverId} className="border-b border-white/5">
                          <td className="p-2 font-bold text-white" style={medal ? { color: medal } : undefined}>{i + 1}</td>
                          <td className="p-2 text-white">{d ? d.flag : ""} {d ? d.name : row.driverId}</td>
                          <td className="p-2 text-white/80">{t ? t.name : row.teamId}</td>
                          <td className="p-2 text-white/80">{row.points ?? 0}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h4 className="text-white font-bold mb-2">Constructor standings</h4>
              <div className="rounded-lg border border-white/10 overflow-hidden" style={{ background: PANEL_BG }}>
<table className="w-full text-sm text-white">
                <thead><tr className="text-left text-white/60 border-b border-white/10"><th className="p-2">Pos</th><th className="p-2">Team</th><th className="p-2">Pts</th></tr></thead>
                  <tbody>
                    {constructorStandings.map((row, i) => {
                      const t = getTeam(TEAMS, row.teamId);
                      return (
                        <tr key={row.teamId} className="border-b border-white/5">
                          <td className="p-2 font-bold text-white">{i + 1}</td>
                          <td className="p-2 text-white/80">{t ? t.name : row.teamId}</td>
                          <td className="p-2 text-white/80">{row.points ?? 0}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        {tab === "races" && (
          <div className="space-y-4">
            <p className="text-white/70 text-sm">Select a race for full classification. Sprint and Grand Prix are separate.</p>
            <div className="flex flex-wrap gap-2">
              {races.map((race, idx) => {
                const label = race.session === "sprint" ? `R${race.round} Sprint` : `R${race.round}`;
                const raceFlag = race.flag ?? (RACES.find((r) => r.round === race.round)?.flag) ?? "🏁";
                return (
                  <button key={`${race.round}-${race.session ?? "gp"}-${idx}`} type="button" onClick={() => setSelectedRaceIndex(idx)}
                    className={`px-4 py-2 rounded text-sm font-bold border ${selectedRaceIndex === idx ? "border-red-500 bg-red-500/20 text-white" : "border-white/20 text-white/80"}`}>
                    {label} {raceFlag}
                  </button>
                );
              })}
            </div>
            {races[selectedRaceIndex] && (
              <RaceDetailBlock
                race={races[selectedRaceIndex]}
                drivers={DRIVERS}
                teams={TEAMS}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SCREEN 2: SIMULATING ──────────────────────────────────────────────────
function SimulatingScreen({ seasonIndex, totalSeasons, year, progress, statusText, raceRound }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6" style={{ background: BG_DARK }}>
      <h2 className="text-3xl md:text-4xl font-black text-white uppercase tracking-wider" style={{ fontFamily: "var(--font-titillium)" }}>
        Season {seasonIndex} of {totalSeasons}
      </h2>
      <p className="mt-2 text-xl text-white/70">{year}</p>

      {/* Racing line */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 w-full"
          style={{
            background: `repeating-linear-gradient(90deg, ${F1_RED} 0px, ${F1_RED} 20px, transparent 20px, transparent 40px)`,
            animation: "racing-line 1.5s linear infinite",
          }}
        />
      </div>

      <div className="relative z-10 w-full max-w-md mt-12">
        <div className="h-3 w-full rounded-sm overflow-hidden border border-white/20" style={{ background: PANEL_BG }}>
          <div
            className="h-full rounded-sm transition-all duration-300"
            style={{ width: `${progress}%`, background: F1_RED }}
          />
        </div>
        <p className="mt-4 text-center text-white/80 text-sm min-h-[1.5rem]">{statusText}</p>
      </div>
    </div>
  );
}

// ─── SCREEN 3: RESULTS (helpers + tabs) ─────────────────────────────────────
function computeDecadeStats(seasonHistory, drivers) {
  const championships = {};
  const wins = {};
  const constructorTitles = {};
  const totalPoints = {};

  for (const entry of seasonHistory || []) {
    const ds = entry.driverStandings || [];
    const cs = entry.constructorStandings || [];
    const raceWins = computeWinsFromRaces(entry.races);
    const year = entry.season ?? entry.year;

    if (ds[0]) {
      championships[ds[0].driverId] = (championships[ds[0].driverId] || 0) + 1;
    }
    for (const [driverId, count] of Object.entries(raceWins)) {
      wins[driverId] = (wins[driverId] || 0) + count;
    }
    if (cs[0]) constructorTitles[cs[0].teamId] = (constructorTitles[cs[0].teamId] || 0) + 1;
    for (let i = 0; i < ds.length; i++) {
      totalPoints[ds[i].driverId] = (totalPoints[ds[i].driverId] || 0) + (ds[i].points || 0);
    }
  }

  let lowestRatedWinner = null;
  for (const entry of seasonHistory || []) {
    const raceWins = computeWinsFromRaces(entry.races);
    const year = entry.season ?? entry.year;
    for (const [driverId, count] of Object.entries(raceWins)) {
      if (count === 0) continue;
      const driver = getDriver(drivers, driverId);
      if (driver && (!lowestRatedWinner || (driver.reputation || 99) < (lowestRatedWinner.reputation || 99))) {
        lowestRatedWinner = { ...driver, season: year };
      }
    }
  }

  const mostChamps = Object.entries(championships).sort((a, b) => b[1] - a[1])[0];
  const mostWins = Object.entries(wins).sort((a, b) => b[1] - a[1])[0];
  const mostTeam = Object.entries(constructorTitles).sort((a, b) => b[1] - a[1])[0];
  const greatestDriverId = Object.entries(totalPoints).sort((a, b) => b[1] - a[1])[0]?.[0];

  return {
    mostChampionships: mostChamps ? { driverId: mostChamps[0], count: mostChamps[1] } : null,
    mostWins: mostWins ? { driverId: mostWins[0], count: mostWins[1] } : null,
    mostDominantTeam: mostTeam ? { teamId: mostTeam[0], count: mostTeam[1] } : null,
    biggestUpset: lowestRatedWinner,
    greatestDriverId,
    totalPoints,
    wins,
    championships,
    constructorTitles,
  };
}

function FranchiseResults({
  franchiseState,
  resultsTab,
  setResultsTab,
  selectedSeasonYear,
  setSelectedSeasonYear,
  selectedRaceIndex,
  setSelectedRaceIndex,
  transferFilter,
  setTransferFilter,
  onNewFranchise,
}) {
  const { seasonHistory, drivers, teams, allOffSeasonNews, startYear } = franchiseState;
  const endYear = seasonHistory?.length ? (seasonHistory[seasonHistory.length - 1]?.season ?? startYear + seasonHistory.length - 1) : startYear;
  const decadeStats = useMemo(() => computeDecadeStats(seasonHistory, drivers), [seasonHistory, drivers]);

  const champDriverName = (id) => getDriver(drivers, id)?.name ?? id;
  const champTeamName = (id) => getTeam(teams, id)?.name ?? id;

  // Tab content
  return (
    <div className="min-h-screen" style={{ background: BG_DARK }}>
      {/* Sticky nav */}
      <nav className="sticky top-0 z-40 flex items-center justify-between px-6 py-4 border-b" style={{ background: PANEL_BG, borderColor: F1_RED }}>
        <span className="text-white font-bold text-sm">F1 FRANCHISE — {startYear} to {endYear}</span>
        <div className="flex gap-2">
          {["DECADE", "SEASONS", "TRANSFERS"].map((tab) => (
              <button
              key={tab}
              type="button"
              onClick={() => setResultsTab(tab)}
              className="px-4 py-2 text-sm font-bold rounded border transition-colors"
              style={{
                borderColor: resultsTab === tab ? F1_RED : "rgba(255,255,255,0.3)",
                background: resultsTab === tab ? `${F1_RED}22` : "transparent",
                color: resultsTab === tab ? "#fff" : "rgba(255,255,255,0.8)",
              }}
            >
              {tab}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onNewFranchise}
          className="px-4 py-2 text-sm font-bold rounded border border-white/50 text-white/90 hover:bg-white/10"
        >
          New Franchise
        </button>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {resultsTab === "DECADE" && (
          <DecadeTab franchiseState={franchiseState} decadeStats={decadeStats} champDriverName={champDriverName} champTeamName={champTeamName} />
        )}
        {resultsTab === "SEASONS" && (
          <SeasonsTab
            franchiseState={franchiseState}
            selectedSeasonYear={selectedSeasonYear}
            setSelectedSeasonYear={setSelectedSeasonYear}
            selectedRaceIndex={selectedRaceIndex}
            setSelectedRaceIndex={setSelectedRaceIndex}
          />
        )}
        {resultsTab === "TRANSFERS" && (
          <TransfersTab allOffSeasonNews={allOffSeasonNews} transferFilter={transferFilter} setTransferFilter={setTransferFilter} teams={teams} />
        )}
      </div>
    </div>
  );
}

function DecadeTab({ franchiseState, decadeStats, champDriverName, champTeamName }) {
  const { seasonHistory, drivers, teams } = franchiseState;
  const { mostChampionships, mostWins, mostDominantTeam, biggestUpset, greatestDriverId, wins, totalPoints, championships } = decadeStats;
  const greatestDriver = getDriver(drivers, greatestDriverId);
  const getTeam = (id) => teams?.find((t) => t.id === id);

  const arcs = [];
  const firstTitleSeen = {};
  for (const entry of seasonHistory || []) {
    const champ = entry.driverStandings?.[0];
    if (champ && !firstTitleSeen[champ.driverId]) {
      firstTitleSeen[champ.driverId] = true;
      arcs.push({ type: "first_title", driverId: champ.driverId, year: entry.season });
    }
  }
  const retired = drivers?.filter((d) => d.status === "retired") || [];
  for (const d of retired) {
    const appearances = (seasonHistory || []).filter((e) => e.driverStandings?.some((s) => s.driverId === d.id));
    const lastSeen = appearances[appearances.length - 1];
    if (lastSeen) arcs.push({ type: "retirement", driverId: d.id, year: (lastSeen.season ?? lastSeen.year) + 1 });
  }

  return (
    <div className="space-y-10">
      <section>
        <h3 className="text-lg font-black text-white uppercase tracking-wider mb-4" style={{ fontFamily: "var(--font-titillium)" }}>Hall of Champions</h3>
        <div className="flex flex-wrap gap-4 pb-4">
          {(seasonHistory || []).map((entry) => {
            const champ = entry.driverStandings?.[0];
            const con = entry.constructorStandings?.[0];
            const team = champ ? getTeam(champ.teamId) : null;
            return (
              <div
                key={entry.season}
                className="w-48 p-4 rounded-lg border-l-4"
                style={{ background: PANEL_BG, borderColor: (team && team.color) ? team.color : F1_RED }}
              >
                <p className="text-white/60 text-sm">{entry.season}</p>
                <p className="text-white font-bold mt-1">{champ ? champDriverName(champ.driverId) : "—"}</p>
                <p className="text-white/70 text-sm">{team?.name ?? "—"}</p>
                <p className="text-white/50 text-xs mt-1">{champ?.points ?? 0} pts · Constructors: {con ? champTeamName(con.teamId) : "—"}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="text-lg font-black text-white uppercase tracking-wider mb-4">Decade stats</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 rounded-lg border border-white/10" style={{ background: PANEL_BG }}>
            <p className="text-white/60 text-xs uppercase">Most championships</p>
            <p className="text-white font-bold">{mostChampionships ? champDriverName(mostChampionships.driverId) : "—"}</p>
            <p className="text-white/70 text-sm">{mostChampionships?.count ?? 0}</p>
          </div>
          <div className="p-4 rounded-lg border border-white/10" style={{ background: PANEL_BG }}>
            <p className="text-white/60 text-xs uppercase">Most wins</p>
            <p className="text-white font-bold">{mostWins ? champDriverName(mostWins.driverId) : "—"}</p>
            <p className="text-white/70 text-sm">{mostWins?.count ?? 0}</p>
          </div>
          <div className="p-4 rounded-lg border border-white/10" style={{ background: PANEL_BG }}>
            <p className="text-white/60 text-xs uppercase">Most dominant team</p>
            <p className="text-white font-bold">{mostDominantTeam ? champTeamName(mostDominantTeam.teamId) : "—"}</p>
            <p className="text-white/70 text-sm">{mostDominantTeam?.count ?? 0} constructor titles</p>
          </div>
          <div className="p-4 rounded-lg border border-white/10" style={{ background: PANEL_BG }}>
            <p className="text-white/60 text-xs uppercase">Biggest upset</p>
            <p className="text-white font-bold">{biggestUpset ? biggestUpset.name : "—"}</p>
            <p className="text-white/70 text-sm">{biggestUpset ? `Won race in ${biggestUpset.season} (rep ${biggestUpset.reputation ?? "?"})` : "—"}</p>
          </div>
        </div>
      </section>

      {greatestDriver && (
        <section>
          <h3 className="text-lg font-black text-white uppercase tracking-wider mb-4">Greatest driver</h3>
          <div className="p-6 rounded-lg border-l-4" style={{ background: PANEL_BG, borderColor: (() => { const t = getTeam(greatestDriver.teamId); return t ? t.color : F1_RED; })() }}>
            <p className="text-2xl font-black text-white" style={{ fontFamily: "var(--font-titillium)" }}>{greatestDriver.name}</p>
            <p className="text-white/70 mt-2">Career: {seasonHistory?.length ?? 0} seasons · {wins[greatestDriver.id] ?? 0} wins · {championships[greatestDriver.id] ?? 0} titles · {totalPoints[greatestDriver.id] ?? 0} pts</p>
          </div>
        </section>
      )}

      <section>
        <h3 className="text-lg font-black text-white uppercase tracking-wider mb-4">Career arcs</h3>
        <div className="space-y-3">
          {arcs.slice(0, 5).map((arc, i) => (
            <div key={i} className="p-4 rounded-lg border-l-4" style={{ background: PANEL_BG, borderColor: F1_RED }}>
              {arc.type === "first_title" && <p className="text-white">{champDriverName(arc.driverId)} won their first title in {arc.year}</p>}
              {arc.type === "retirement" && <p className="text-white">{champDriverName(arc.driverId)} retired after {arc.year - (franchiseState.startYear || 2026)} seasons</p>}
            </div>
          ))}
          {arcs.length === 0 && <p className="text-white/60">No arcs detected.</p>}
        </div>
      </section>
    </div>
  );
}

function SeasonsTab({ franchiseState, selectedSeasonYear, setSelectedSeasonYear, selectedRaceIndex, setSelectedRaceIndex }) {
  const { seasonHistory, drivers, teams } = franchiseState;
  const years = (seasonHistory || []).map((e) => e.season ?? e.year).filter(Boolean);
  const current = seasonHistory?.find((e) => (e.season ?? e.year) === selectedSeasonYear);
  const getTeam = (id) => teams?.find((t) => t.id === id);
  const [reportsCache, setReportsCache] = useState({});
  const [loadingReportKey, setLoadingReportKey] = useState(null);

  const selectedRace = current?.races?.[selectedRaceIndex];
  const reportCacheKey = selectedRace ? `${selectedSeasonYear}-${selectedRace.round}-${selectedRace.session ?? "gp"}` : null;
  const cachedReport = reportCacheKey ? reportsCache[reportCacheKey] : null;
  const isLoadingReport = reportCacheKey && loadingReportKey === reportCacheKey;

  const handleGenerateReport = useCallback(async () => {
    if (!reportCacheKey || !current || !selectedRace) return;
    setLoadingReportKey(reportCacheKey);
    try {
      const prevRace = selectedRaceIndex > 0 ? current.races[selectedRaceIndex - 1] : null;
      const prevWinnerId = prevRace?.results?.[0]?.driverId;
      const previousRaceWinner = prevWinnerId ? getDriver(drivers, prevWinnerId)?.name ?? null : null;
      const res = await fetch("/api/race-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raceResult: selectedRace,
          qualifyingOrder: selectedRace.qualifyingOrder ?? [],
          season: selectedSeasonYear,
          round: selectedRace.round,
          totalRounds: (current.races ?? []).length,
          driverStandings: current.driverStandings,
          constructorStandings: current.constructorStandings ?? [],
          previousRaceWinner,
          focusDriverId: null,
          drivers,
          teams,
          mode: "franchise",
        }),
      });
      const data = await res.json();
      const commentary = data?.commentary ?? "";
      setReportsCache((prev) => ({ ...prev, [reportCacheKey]: commentary }));
    } catch {
      setReportsCache((prev) => ({ ...prev, [reportCacheKey]: "Unable to generate report. Try again." }));
    } finally {
      setLoadingReportKey(null);
    }
  }, [reportCacheKey, current, selectedRace, selectedRaceIndex, drivers, teams, selectedSeasonYear]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {years.map((y) => (
          <button
            key={y}
            type="button"
            onClick={() => { setSelectedSeasonYear(y); setSelectedRaceIndex(0); }}
            className="px-4 py-2 rounded-full text-sm font-bold border transition-colors"
            style={{
              borderColor: selectedSeasonYear === y ? F1_RED : "rgba(255,255,255,0.3)",
              background: selectedSeasonYear === y ? `${F1_RED}22` : PANEL_BG,
              color: "#fff",
            }}
          >
            {y}
          </button>
        ))}
      </div>

      {current && (
        <>
          <div className="p-6 rounded-lg border border-white/10" style={{ background: PANEL_BG }}>
            <p className="text-white/60 text-sm">Champion</p>
            <p className="text-2xl font-black text-white" style={{ fontFamily: "var(--font-titillium)" }}>
              {getDriver(drivers, current.driverStandings?.[0]?.driverId)?.name ?? "—"}
            </p>
            <p className="text-white/70">{getTeam(current.driverStandings?.[0]?.teamId)?.name} · {current.driverStandings?.[0]?.points ?? 0} pts</p>
          </div>

          <div>
            <h4 className="text-white font-bold mb-2">Driver standings</h4>
            <div className="rounded-lg border border-white/10 overflow-hidden" style={{ background: PANEL_BG }}>
<table className="w-full text-sm text-white">
              <thead>
                <tr className="text-left text-white/60 border-b border-white/10">
                  <th className="p-2">Pos</th>
                  <th className="p-2"></th>
                  <th className="p-2">Name</th>
                  <th className="p-2">Team</th>
                  <th className="p-2">Pts</th>
                  <th className="p-2">Wins</th>
                </tr>
              </thead>
                <tbody>
                  {(current.driverStandings || []).slice(0, 22).map((row, i) => {
                    const driver = getDriver(drivers, row.driverId);
                    const team = getTeam(row.teamId);
                    const teamBg = team ? team.color : undefined;
                    const teamName = team ? team.name : "—";
                    const wins = computeWinsFromRaces(current.races)[row.driverId] ?? 0;
                    const medal = i === 0 ? GOLD : i === 1 ? "#C0C0C0" : i === 2 ? "#CD7F32" : "transparent";
                    return (
                      <tr key={row.driverId} className="border-b border-white/5">
                        <td className="p-2 font-bold text-white" style={{ color: medal !== "transparent" ? medal : undefined }}>{i + 1}</td>
                        <td className="p-2">{driver ? driver.flag : null}</td>
                        <td className="p-2 text-white">{driver ? driver.name : row.driverId}</td>
                        <td className="p-2 flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={Object.assign({}, teamBg ? { background: teamBg } : null)}></span><span>{teamName}</span></td>
                        <td className="p-2 text-white/80">{row.points ?? 0}</td>
                        <td className="p-2 text-white/80">{wins}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h4 className="text-white font-bold mb-2">Constructor standings</h4>
            <div className="rounded-lg border border-white/10 overflow-hidden" style={{ background: PANEL_BG }}>
              <table className="w-full text-sm text-white">
                <thead>
                  <tr className="text-left text-white/60 border-b border-white/10">
                    <th className="p-2">Pos</th>
                    <th className="p-2">Team</th>
                    <th className="p-2">Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {(current.constructorStandings || []).map((row, i) => {
                    const team = getTeam(row.teamId);
                    const teamBg = team ? team.color : undefined;
                    const teamName = team ? team.name : row.teamId;
                    return (
                      <tr key={row.teamId} className="border-b border-white/5">
                        <td className="p-2 font-bold text-white">{i + 1}</td>
                        <td className="p-2 flex items-center gap-1"><span className="w-2 h-2 rounded-full shrink-0" style={Object.assign({}, teamBg ? { background: teamBg } : null)}></span><span>{teamName}</span></td>
                        <td className="p-2 text-white/80">{row.points ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h4 className="text-white font-bold mb-2">Race results</h4>
            <p className="text-white/60 text-sm mb-3">Select a race for full classification. Sprint and Grand Prix are separate.</p>
            <div className="flex flex-wrap gap-2 pb-4">
              {(current.races || []).map((race, idx) => {
                const label = race.session === "sprint" ? `R${race.round} Sprint` : `R${race.round}`;
                const raceFlag = race.flag ?? (RACES.find((r) => r.round === race.round)?.flag) ?? "🏁";
                return (
                  <button
                    key={`${race.round}-${race.session ?? "gp"}-${idx}`}
                    type="button"
                    onClick={() => setSelectedRaceIndex(idx)}
                    className="px-4 py-2 rounded border text-sm"
                    style={{
                      borderColor: selectedRaceIndex === idx ? F1_RED : "rgba(255,255,255,0.2)",
                      background: selectedRaceIndex === idx ? `${F1_RED}22` : PANEL_BG,
                      color: "#fff",
                    }}
                  >
                    {label} {raceFlag}
                  </button>
                );
              })}
            </div>
            {current.races && current.races[selectedRaceIndex] && (
              <div className="mt-4 space-y-4">
                <RaceDetailBlock
                  race={current.races[selectedRaceIndex]}
                  drivers={drivers}
                  teams={teams}
                />
                <div className="rounded-lg border border-white/10 overflow-hidden" style={{ background: PANEL_BG }}>
                  <h4 className="text-white font-bold mb-2 px-4 pt-4">Race report</h4>
                  <div className="px-4 pb-4">
                    <button
                      type="button"
                      onClick={handleGenerateReport}
                      disabled={!!isLoadingReport}
                      className="px-4 py-2 rounded text-sm font-bold border transition-colors disabled:opacity-60"
                      style={{ borderColor: F1_RED, background: `${F1_RED}22`, color: "#fff" }}
                    >
                      {isLoadingReport ? "Generating…" : "Generate report"}
                    </button>
                    {isLoadingReport && (
                      <div className="mt-3 flex items-center gap-2 text-white/70 text-sm">
                        <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Loading commentary…
                      </div>
                    )}
                    {cachedReport && !isLoadingReport && (
                      <div
                        className="mt-4 pl-6 pr-4 py-3 rounded relative text-white/90 italic text-[1rem] leading-relaxed"
                        style={{
                          background: "#12122a",
                          fontFamily: "var(--font-titillium)",
                        }}
                      >
                        <span className="absolute left-3 top-3 text-2xl font-serif not-italic" style={{ color: F1_RED }}>"</span>
                        <div className="pl-2">{cachedReport}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TransfersTab({ allOffSeasonNews, transferFilter, setTransferFilter, teams }) {
  const types = ["ALL", "SIGNING", "RETIREMENT", "PROMOTION", "FIRING"];
  const filtered = transferFilter === "ALL"
    ? (allOffSeasonNews || [])
    : (allOffSeasonNews || []).filter((e) => e.type?.toUpperCase() === transferFilter);
  const byYear = {};
  for (const item of filtered) {
    const y = item.year ?? "Unknown";
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(item);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {types.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTransferFilter(t)}
            className="px-4 py-2 rounded text-sm font-bold border"
            style={{
              borderColor: transferFilter === t ? F1_RED : "rgba(255,255,255,0.3)",
              background: transferFilter === t ? `${F1_RED}22` : "transparent",
              color: "#fff",
            }}
          >
            {t}s
          </button>
        ))}
      </div>
      <div className="space-y-8">
        {Object.entries(byYear).sort((a, b) => Number(b[0]) - Number(a[0])).map(([year, items]) => (
          <div key={year}>
            <h4 className="text-white/80 font-bold mb-3">{year} OFF-SEASON</h4>
            <div className="space-y-2">
              {items.map((item, i) => (
                <div
                  key={i}
                  className="p-4 rounded-lg border-l-4 flex items-start gap-3"
                  style={{ background: PANEL_BG, borderColor: item.teamColor ?? F1_RED }}
                >
                  <span className="text-xs uppercase font-bold px-2 py-0.5 rounded shrink-0" style={{ background: "rgba(255,255,255,0.15)", color: "#fff" }}>{item.type ?? "EVENT"}</span>
                  {(item.driverReputation > 85 || item.type === "retirement") && <span className="text-white shrink-0">⭐</span>}
                  <div className="min-w-0">
                    {item.out != null || item.in != null || item.reason != null ? (
                      <p className="text-white font-medium text-sm">
                        <span className="text-white/60">Out: </span>{item.out ?? "—"}
                        {item.leaveReason ? <span className="text-white/50"> ({item.leaveReason})</span> : null}
                        <span className="text-white/40 mx-2">·</span>
                        <span className="text-white/60">In: </span>{item.in ?? "—"}
                        <span className="text-white/40 mx-2">·</span>
                        <span className="text-white/60">Reason: </span><span className="capitalize">{item.reason ?? "—"}</span>
                      </p>
                    ) : (
                      <>
                        <p className="text-white font-bold">{item.headline}</p>
                        <p className="text-white/70 text-sm mt-0.5">{item.detail}</p>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MAIN PAGE ──────────────────────────────────────────────────────────────
export default function SimulatorPage() {
  const [appMode, setAppMode] = useState("franchise");
  const [screen, setScreen] = useState("setup");
  const [franchiseState, setFranchiseState] = useState(null);
  const [oneSeasonResult, setOneSeasonResult] = useState(null);
  const [simulationMode, setSimulationMode] = useState(SIMULATION_MODES.realistic);
  const [totalSeasons, setTotalSeasons] = useState(10);
  const [chaosLevel, setChaosLevel] = useState(5);
  const [safetyCarFrequency, setSafetyCarFrequency] = useState(5);
  const [seasonLength, setSeasonLength] = useState(24);
  const [upgradesEnabled, setUpgradesEnabled] = useState(true);
  const [simProgress, setSimProgress] = useState(0);
  const [simStatusText, setSimStatusText] = useState(STATUS_CYCLE[0]);
  const [simSeasonIndex, setSimSeasonIndex] = useState(1);
  const [simYear, setSimYear] = useState(2026);
  const [simRaceRound, setSimRaceRound] = useState(1);

  const [resultsTab, setResultsTab] = useState("DECADE");
  const [selectedSeasonYear, setSelectedSeasonYear] = useState(2026);
  const [selectedRaceRound, setSelectedRaceRound] = useState(1);
  const [selectedRaceIndex, setSelectedRaceIndex] = useState(0);
  const [transferFilter, setTransferFilter] = useState("ALL");

  const runRef = useRef(false);
  const normalRunRef = useRef(false);

  const handleModeSwitch = useCallback((mode) => {
    setAppMode(mode);
    setScreen("setup");
    setFranchiseState(null);
    setOneSeasonResult(null);
    setResultsTab("DECADE");
  }, []);

  const beginFranchise = useCallback((draftDrivers) => {
    const state = buildInitialFranchiseState({
      simulationMode,
      totalSeasons,
      drivers: draftDrivers ?? undefined,
    });
    setFranchiseState(state);
    setScreen("simulating");
    setSimProgress(0);
    setSimStatusText(STATUS_CYCLE[0]);
    setSimSeasonIndex(1);
    setSimYear(state.startYear);
    setSimRaceRound(1);
    runRef.current = true;
  }, [simulationMode, totalSeasons]);

  useEffect(() => {
    if (screen !== "simulating" || !franchiseState || !runRef.current) return;
    runRef.current = false;

    const total = franchiseState.totalSeasons ?? 10;
    let state = JSON.parse(JSON.stringify(franchiseState));
    let seasonIndex = 1;
    const startYear = state.startYear ?? 2026;
    const races = RACES;

    const runNext = () => {
      if (seasonIndex > total) {
        setFranchiseState(state);
        setScreen("results");
        setSelectedSeasonYear(state.seasonHistory?.[0]?.season ?? startYear);
        runRef.current = false;
        return;
      }

      const year = startYear + seasonIndex - 1;
      setSimSeasonIndex(seasonIndex);
      setSimYear(year);
      setSimStatusText(`Season ${year} — Simulating...`);

      const activeDrivers = getActiveDrivers(state.drivers);
      const result = simulateSeason({
        drivers: activeDrivers,
        teams: state.teams,
        races,
        chaosLevel: state.simulationMode?.chaosLevel ?? 5,
        safetyCarFrequency: state.simulationMode?.safetyCarFrequency ?? 5,
        upgradesEnabled: true,
        seasonLength: 24,
      });

      const seasonEntry = {
        season: year,
        races: result.races,
        driverStandings: result.driverStandings,
        constructorStandings: result.constructorStandings,
      };
      state.seasonHistory = [...(state.seasonHistory || []), seasonEntry];

      setSimStatusText("Checking mid-season form...");
      const midSeason = checkMidSeasonFirings(state, result.races, 12, state.simulationMode);
      if (midSeason.news?.length) {
        state.allOffSeasonNews = [...(state.allOffSeasonNews || []), ...midSeason.news.map((n) => ({ ...n, year: `${year} mid-season` }))];
      }

      setSimStatusText("Resolving off-season...");
      const resolved = resolveOffSeason(state, state.simulationMode);
      state = { ...resolved };
      state.allOffSeasonNews = [...(state.allOffSeasonNews || []), ...(resolved.offSeasonNews || []).map((n) => ({ ...n, year }))];

      setFranchiseState(state);
      seasonIndex++;
      setSimProgress(Math.round((seasonIndex - 1) / total * 100));

      if (seasonIndex <= total) {
        setTimeout(runNext, 1500);
      } else {
        setScreen("results");
        setSelectedSeasonYear(state.seasonHistory?.[0]?.season ?? startYear);
        runRef.current = false;
      }
    };

    runNext();
  }, [screen, franchiseState]);

  const onNewFranchise = useCallback(() => {
    setScreen("setup");
    setFranchiseState(null);
    setResultsTab("DECADE");
  }, []);

  const beginNormalSimulate = useCallback(() => {
    setScreen("simulating");
    setOneSeasonResult(null);
    setSimProgress(0);
    setSimStatusText("Simulating 2026 season...");
    normalRunRef.current = true;
  }, []);

  useEffect(() => {
    if (screen !== "simulating" || appMode !== "normal" || !normalRunRef.current) return;
    normalRunRef.current = false;
    const result = simulateSeason({
      drivers: DRIVERS,
      teams: TEAMS,
      races: RACES,
      chaosLevel,
      safetyCarFrequency,
      upgradesEnabled,
      seasonLength,
    });
    setSimProgress(100);
    setSimStatusText("Season complete!");
    const t = setTimeout(() => {
      setOneSeasonResult(result);
      setScreen("results");
    }, 600);
    return () => clearTimeout(t);
  }, [screen, appMode, chaosLevel, safetyCarFrequency, upgradesEnabled, seasonLength]);

  if (screen === "setup") {
    return (
      <div className="min-h-screen text-white" style={{ background: BG_DARK }}>
        <ModeMenu appMode={appMode} setAppMode={setAppMode} onSwitch={handleModeSwitch} />
        {appMode === "franchise" && (
          <FranchiseSetup
            onBegin={beginFranchise}
            simulationMode={simulationMode}
            setSimulationMode={setSimulationMode}
            totalSeasons={totalSeasons}
            setTotalSeasons={setTotalSeasons}
          />
        )}
        {appMode === "normal" && (
          <NormalSetup
            onSimulate={beginNormalSimulate}
            chaosLevel={chaosLevel}
            setChaosLevel={setChaosLevel}
            safetyCarFrequency={safetyCarFrequency}
            setSafetyCarFrequency={setSafetyCarFrequency}
            seasonLength={seasonLength}
            setSeasonLength={setSeasonLength}
            upgradesEnabled={upgradesEnabled}
            setUpgradesEnabled={setUpgradesEnabled}
          />
        )}
      </div>
    );
  }

  if (screen === "simulating") {
    return (
      <div className="min-h-screen text-white" style={{ background: BG_DARK }}>
        <ModeMenu appMode={appMode} setAppMode={setAppMode} onSwitch={handleModeSwitch} />
        <SimulatingScreen
          seasonIndex={appMode === "normal" ? 1 : simSeasonIndex}
          totalSeasons={appMode === "normal" ? 1 : (franchiseState?.totalSeasons ?? 10)}
          year={simYear}
          progress={appMode === "normal" ? simProgress : simProgress}
          statusText={simStatusText}
          raceRound={simRaceRound}
        />
      </div>
    );
  }

  if (screen === "results" && appMode === "franchise" && franchiseState) {
    return (
      <div className="min-h-screen text-white" style={{ background: BG_DARK }}>
        <ModeMenu appMode={appMode} setAppMode={setAppMode} onSwitch={handleModeSwitch} />
        <FranchiseResults
        franchiseState={franchiseState}
        resultsTab={resultsTab}
        setResultsTab={setResultsTab}
        selectedSeasonYear={selectedSeasonYear}
        setSelectedSeasonYear={setSelectedSeasonYear}
        selectedRaceIndex={selectedRaceIndex}
        setSelectedRaceIndex={setSelectedRaceIndex}
        transferFilter={transferFilter}
          setTransferFilter={setTransferFilter}
          onNewFranchise={onNewFranchise}
        />
      </div>
    );
  }

  if (screen === "results" && appMode === "normal" && oneSeasonResult) {
    return (
      <div className="min-h-screen text-white" style={{ background: BG_DARK }}>
        <ModeMenu appMode={appMode} setAppMode={setAppMode} onSwitch={handleModeSwitch} />
        <NormalResults result={oneSeasonResult} onBack={() => { setScreen("setup"); setOneSeasonResult(null); }} />
      </div>
    );
  }

  return null;
}
