"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
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
const PANEL_BORDER = "rgba(255,255,255,0.08)";
const GOLD = "#FFD700";

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
function getDriver(drivers, id) { return drivers?.find((d) => d.id === id); }
function getTeam(teams, id) { return teams?.find((t) => t.id === id); }
function getActiveDrivers(drivers) { return drivers.filter((d) => d.status === "active" && d.teamId); }

function buildInitialFranchiseState(opts = {}) {
  const mode = opts.simulationMode ?? SIMULATION_MODES.realistic;
  const totalSeasons = opts.totalSeasons ?? 10;
  const teams = TEAMS.map((t) => ({ ...deepClone(t), budget: TEAM_BUDGETS[t.id] ?? 100 }));
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

function computeWinsFromRaces(races) {
  const wins = {};
  for (const race of races || []) {
    const winner = race.results?.[0]?.driverId;
    if (winner) wins[winner] = (wins[winner] || 0) + 1;
  }
  return wins;
}

// ─── TOP NAV ───────────────────────────────────────────────────────────────
function TopNav({ onNewFranchise, showNew }) {
  return (
    <div
      className="sticky top-0 z-40 flex items-center justify-between px-6 py-3 border-b"
      style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}
    >
      <Link href="/" className="text-white/50 text-sm hover:text-white transition-colors">
        ← Jake's Tools
      </Link>
      <span className="text-white font-black text-sm uppercase tracking-widest">Franchise Mode</span>
      <div className="flex items-center gap-3">
        <Link
          href="/single-season"
          className="px-4 py-1.5 rounded border text-sm font-bold uppercase tracking-wider transition-all hover:bg-white/10"
          style={{ borderColor: "rgba(255,255,255,0.25)", color: "rgba(255,255,255,0.7)" }}
        >
          Single Season →
        </Link>
        {showNew && (
          <button
            type="button"
            onClick={onNewFranchise}
            className="px-4 py-1.5 rounded border text-sm font-bold uppercase tracking-wider transition-all hover:bg-white/10"
            style={{ borderColor: "rgba(255,255,255,0.25)", color: "rgba(255,255,255,0.7)" }}
          >
            New Franchise
          </button>
        )}
      </div>
    </div>
  );
}

// ─── RACE DETAIL BLOCK ─────────────────────────────────────────────────────
function RaceDetailBlock({ race, drivers, teams }) {
  const results = race.results || [];
  const raceName = race.name ?? race.raceName ?? `Round ${race.round}`;
  const raceFlag = race.flag ?? (RACES.find((r) => r.round === race.round)?.flag) ?? "🏁";
  const weatherLabel = (race.weather || "dry").charAt(0).toUpperCase() + (race.weather || "dry").slice(1);
  const isSprint = race.isSprint ?? (RACES.find((r) => r.round === race.round)?.isSprint) ?? false;

  return (
    <div className="rounded-lg border overflow-hidden" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
      <div className="p-4 border-b" style={{ borderColor: PANEL_BORDER }}>
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
          {race.safetyCarDeployed && <span className="text-white">Safety car deployed</span>}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[32rem] text-white">
          <thead>
            <tr className="text-left text-white/60 border-b" style={{ borderColor: PANEL_BORDER }}>
              <th className="p-2 w-12">Pos</th>
              <th className="p-2 w-8" />
              <th className="p-2">Driver</th>
              <th className="p-2">Team</th>
              <th className="p-2 w-20">Gap</th>
              <th className="p-2 w-14">Pts</th>
              <th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => {
              const driver = getDriver(drivers, r.driverId);
              const team = getTeam(teams, r.teamId);
              const medal = r.position === 1 ? GOLD : r.position === 2 ? "#C0C0C0" : r.position === 3 ? "#CD7F32" : undefined;
              const status = r.dnf ? (r.dnfReason ? `DNF (${r.dnfReason})` : "DNF") : (r.fastestLap ? "Fastest lap" : "");
              return (
                <tr key={r.driverId + "-" + r.position} className="border-b" style={{ borderColor: PANEL_BORDER }}>
                  <td className="p-2 font-bold" style={{ color: medal ?? "rgba(255,255,255,0.8)" }}>{r.position}</td>
                  <td className="p-2">{driver?.flag ?? ""}</td>
                  <td className="p-2 text-white">{driver?.name ?? r.driverId}</td>
                  <td className="p-2">
                    <div className="flex items-center gap-1.5">
                      {team && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: team.color }} />}
                      <span className="text-white/80">{team?.name ?? r.teamId}</span>
                    </div>
                  </td>
                  <td className="p-2 text-white/60 font-mono text-xs">{r.gap ?? (r.dnf ? "DNF" : "—")}</td>
                  <td className="p-2 text-white/80">{r.points ?? 0}</td>
                  <td className="p-2 text-white/60 text-xs">{status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── FRANCHISE SETUP ───────────────────────────────────────────────────────
function GridSeatChange({ currentDriverId, allActiveDrivers, teams, onSwap }) {
  const [open, setOpen] = useState(false);
  const others = allActiveDrivers.filter((d) => d.id !== currentDriverId);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs px-2 py-0.5 rounded border border-white/30 text-white/70 hover:bg-white/10 transition-colors"
      >
        Change
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 top-full mt-1 z-20 min-w-[12rem] max-h-48 overflow-auto rounded border border-white/20 shadow-xl py-1" style={{ background: PANEL_BG }}>
            {others.map((d) => {
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
                  {t && <span className="text-white/40 text-xs">({t.name})</span>}
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
  const isRealistic = simulationMode === realistic;

  const [draftDrivers, setDraftDrivers] = useState(() => [
    ...DRIVERS.map(deepClone),
    ...RESERVE_DRIVERS.map(deepClone),
    ...FUTURE_ROOKIES.map(deepClone),
  ]);
  const activeDraftDrivers = useMemo(() => draftDrivers.filter((d) => d.status === "active" && d.teamId), [draftDrivers]);

  const swapDrivers = useCallback((idA, idB) => {
    if (idA === idB) return;
    setDraftDrivers((prev) => {
      const next = prev.map((d) => ({ ...d }));
      const a = next.find((d) => d.id === idA);
      const b = next.find((d) => d.id === idB);
      if (!a || !b) return prev;
      [a.teamId, b.teamId] = [b.teamId, a.teamId];
      return next;
    });
  }, []);

  return (
    <div className="min-h-screen" style={{ background: BG_DARK }}>
      <div className="px-6 pt-12 pb-6 text-center">
        <h1 className="text-4xl md:text-5xl font-black uppercase tracking-wider text-white" style={{ fontFamily: "var(--font-titillium)" }}>
          F1 Franchise Mode
        </h1>
        <p className="mt-2 text-lg text-white/70">Simulate a decade of Formula 1</p>
        <div className="mt-4 h-px w-24 mx-auto" style={{ background: F1_RED }} />
      </div>

      <div className="max-w-6xl mx-auto px-6 pb-8 grid grid-cols-1 lg:grid-cols-2 gap-10">
        {/* Simulation mode */}
        <div className="space-y-8">
          <div>
            <p className="text-sm text-white/60 uppercase tracking-wider mb-3">Simulation mode</p>
            <div className="grid grid-cols-2 gap-4">
              {[
                { mode: realistic, label: "Realistic", active: isRealistic, info: "Chaos 4/10 · Transfers 4/10" },
                { mode: wildcard, label: "Wildcard", active: !isRealistic, info: "Chaos 8/10 · Transfers 9/10" },
              ].map(({ mode, label, active, info }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setSimulationMode(mode)}
                  className="text-left p-5 rounded-lg border-2 transition-all"
                  style={{
                    background: PANEL_BG,
                    borderColor: active ? (label === "Wildcard" ? F1_RED : "#fff") : "rgba(255,255,255,0.15)",
                    boxShadow: active ? (label === "Wildcard" ? "0 0 20px rgba(225,6,0,0.2)" : "0 0 20px rgba(255,255,255,0.1)") : "none",
                  }}
                >
                  <p className="font-bold text-white">{label}</p>
                  <p className="text-sm text-white/70 mt-1">{mode.description}</p>
                  <p className="text-xs text-white/40 mt-2">{info}</p>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Seasons */}
        <div className="space-y-6">
          <div>
            <p className="text-sm text-white/60 uppercase tracking-wider mb-2">Seasons to simulate</p>
            <div className="flex items-center gap-4">
              <button type="button" onClick={() => setTotalSeasons((s) => Math.max(1, s - 1))}
                className="w-12 h-12 rounded border border-white/30 text-white text-xl font-bold hover:bg-white/10 transition-colors">−</button>
              <span className="text-4xl font-black text-white tabular-nums w-16 text-center" style={{ fontFamily: "var(--font-titillium)" }}>{totalSeasons}</span>
              <button type="button" onClick={() => setTotalSeasons((s) => Math.min(10, s + 1))}
                className="w-12 h-12 rounded border border-white/30 text-white text-xl font-bold hover:bg-white/10 transition-colors">+</button>
            </div>
          </div>
          <div>
            <p className="text-sm text-white/60 uppercase tracking-wider mb-1">Starting year</p>
            <p className="text-2xl font-bold text-white/80">2026</p>
          </div>
        </div>
      </div>

      {/* Grid overview */}
      <div className="max-w-6xl mx-auto px-6 pb-8">
        <p className="text-sm text-white/60 uppercase tracking-wider mb-1">Grid overview</p>
        <p className="text-white/40 text-xs mb-3">Click Change to swap a driver with another on the grid.</p>
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: PANEL_BORDER }}>
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
                      return (
                        <div key={slot} className="flex items-center justify-between gap-2">
                          <span className="text-white/80 text-sm truncate">
                            {driver ? driver.flag + " " + driver.name : "—"}
                          </span>
                          {driver && (
                            <GridSeatChange
                              currentDriverId={driver.id}
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

      <div className="max-w-2xl mx-auto px-6 pb-12">
        <button
          type="button"
          onClick={() => onBegin(draftDrivers)}
          className="w-full py-4 font-black uppercase tracking-wider text-white rounded transition-all hover:opacity-90"
          style={{ background: F1_RED, boxShadow: "0 0 24px rgba(225,6,0,0.3)" }}
        >
          Begin Franchise
        </button>
      </div>
    </div>
  );
}

// ─── SIMULATING SCREEN ─────────────────────────────────────────────────────
function SimulatingScreen({ seasonIndex, totalSeasons, year, progress, statusText }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6" style={{ background: BG_DARK }}>
      <h2 className="text-3xl md:text-4xl font-black text-white uppercase tracking-wider" style={{ fontFamily: "var(--font-titillium)" }}>
        Season {seasonIndex} of {totalSeasons}
      </h2>
      <p className="mt-2 text-xl text-white/70">{year}</p>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 w-full"
          style={{
            background: "repeating-linear-gradient(90deg, " + F1_RED + " 0px, " + F1_RED + " 20px, transparent 20px, transparent 40px)",
            animation: "racing-line 1.5s linear infinite",
          }}
        />
      </div>
      <div className="relative z-10 w-full max-w-md mt-12">
        <div className="h-3 w-full rounded-sm overflow-hidden border border-white/20" style={{ background: PANEL_BG }}>
          <div className="h-full rounded-sm transition-all duration-300" style={{ width: progress + "%", background: F1_RED }} />
        </div>
        <p className="mt-4 text-center text-white/70 text-sm min-h-[1.5rem]">{statusText}</p>
      </div>
    </div>
  );
}

// ─── FRANCHISE RESULTS TABS ────────────────────────────────────────────────
function computeDecadeStats(seasonHistory, drivers) {
  const championships = {}, wins = {}, constructorTitles = {}, totalPoints = {};
  for (const entry of seasonHistory || []) {
    const ds = entry.driverStandings || [];
    const cs = entry.constructorStandings || [];
    const raceWins = computeWinsFromRaces(entry.races);
    if (ds[0]) championships[ds[0].driverId] = (championships[ds[0].driverId] || 0) + 1;
    for (const [id, n] of Object.entries(raceWins)) wins[id] = (wins[id] || 0) + n;
    if (cs[0]) constructorTitles[cs[0].teamId] = (constructorTitles[cs[0].teamId] || 0) + 1;
    for (const row of ds) totalPoints[row.driverId] = (totalPoints[row.driverId] || 0) + (row.points || 0);
  }
  let lowestRatedWinner = null;
  for (const entry of seasonHistory || []) {
    const raceWins = computeWinsFromRaces(entry.races);
    for (const [driverId] of Object.entries(raceWins)) {
      const driver = getDriver(drivers, driverId);
      if (driver && (!lowestRatedWinner || (driver.reputation || 99) < (lowestRatedWinner.reputation || 99))) {
        lowestRatedWinner = { ...driver, season: entry.season };
      }
    }
  }
  return {
    mostChampionships: Object.entries(championships).sort((a, b) => b[1] - a[1])[0] ? { driverId: Object.entries(championships).sort((a, b) => b[1] - a[1])[0][0], count: Object.entries(championships).sort((a, b) => b[1] - a[1])[0][1] } : null,
    mostWins: Object.entries(wins).sort((a, b) => b[1] - a[1])[0] ? { driverId: Object.entries(wins).sort((a, b) => b[1] - a[1])[0][0], count: Object.entries(wins).sort((a, b) => b[1] - a[1])[0][1] } : null,
    mostDominantTeam: Object.entries(constructorTitles).sort((a, b) => b[1] - a[1])[0] ? { teamId: Object.entries(constructorTitles).sort((a, b) => b[1] - a[1])[0][0], count: Object.entries(constructorTitles).sort((a, b) => b[1] - a[1])[0][1] } : null,
    biggestUpset: lowestRatedWinner,
    greatestDriverId: Object.entries(totalPoints).sort((a, b) => b[1] - a[1])[0]?.[0],
    totalPoints, wins, championships, constructorTitles,
  };
}

function DecadeTab({ franchiseState, decadeStats }) {
  const { seasonHistory, drivers, teams } = franchiseState;
  const { mostChampionships, mostWins, mostDominantTeam, biggestUpset, greatestDriverId, wins, totalPoints, championships } = decadeStats;
  const name = (id) => getDriver(drivers, id)?.name ?? id;
  const teamName = (id) => getTeam(teams, id)?.name ?? id;
  const greatestDriver = getDriver(drivers, greatestDriverId);

  const arcs = [];
  const firstTitleSeen = {};
  for (const entry of seasonHistory || []) {
    const champ = entry.driverStandings?.[0];
    if (champ && !firstTitleSeen[champ.driverId]) {
      firstTitleSeen[champ.driverId] = true;
      arcs.push({ type: "first_title", driverId: champ.driverId, year: entry.season });
    }
  }
  for (const d of (drivers?.filter((d) => d.status === "retired") || [])) {
    const appearances = (seasonHistory || []).filter((e) => e.driverStandings?.some((s) => s.driverId === d.id));
    const last = appearances[appearances.length - 1];
    if (last) arcs.push({ type: "retirement", driverId: d.id, year: (last.season ?? last.year) + 1 });
  }

  return (
    <div className="space-y-10">
      <section>
        <h3 className="text-lg font-black text-white uppercase tracking-wider mb-4">Hall of Champions</h3>
        <div className="flex flex-wrap gap-4 pb-4">
          {(seasonHistory || []).map((entry) => {
            const champ = entry.driverStandings?.[0];
            const con = entry.constructorStandings?.[0];
            const team = champ ? getTeam(teams, champ.teamId) : null;
            return (
              <div key={entry.season} className="w-48 p-4 rounded-lg border-l-4" style={{ background: PANEL_BG, borderColor: team?.color ?? F1_RED }}>
                <p className="text-white/50 text-sm">{entry.season}</p>
                <p className="text-white font-bold mt-1">{champ ? name(champ.driverId) : "—"}</p>
                <p className="text-white/60 text-sm">{team?.name ?? "—"}</p>
                <p className="text-white/40 text-xs mt-1">{champ?.points ?? 0} pts · {con ? teamName(con.teamId) : "—"}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="text-lg font-black text-white uppercase tracking-wider mb-4">Decade stats</h3>
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: "Most championships", value: mostChampionships ? name(mostChampionships.driverId) : "—", sub: mostChampionships?.count ?? 0 },
            { label: "Most wins", value: mostWins ? name(mostWins.driverId) : "—", sub: mostWins?.count ?? 0 },
            { label: "Most dominant team", value: mostDominantTeam ? teamName(mostDominantTeam.teamId) : "—", sub: (mostDominantTeam?.count ?? 0) + " titles" },
            { label: "Biggest upset", value: biggestUpset?.name ?? "—", sub: biggestUpset ? "Won in " + biggestUpset.season : "—" },
          ].map(({ label, value, sub }) => (
            <div key={label} className="p-4 rounded-lg border" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
              <p className="text-white/50 text-xs uppercase tracking-wider">{label}</p>
              <p className="text-white font-bold mt-1">{value}</p>
              <p className="text-white/60 text-sm">{sub}</p>
            </div>
          ))}
        </div>
      </section>

      {greatestDriver && (
        <section>
          <h3 className="text-lg font-black text-white uppercase tracking-wider mb-4">Greatest driver</h3>
          <div className="p-6 rounded-lg border-l-4" style={{ background: PANEL_BG, borderColor: getTeam(teams, greatestDriver.teamId)?.color ?? F1_RED }}>
            <p className="text-2xl font-black text-white" style={{ fontFamily: "var(--font-titillium)" }}>{greatestDriver.name}</p>
            <p className="text-white/60 mt-2">
              {seasonHistory?.length ?? 0} seasons · {wins[greatestDriver.id] ?? 0} wins · {championships[greatestDriver.id] ?? 0} titles · {totalPoints[greatestDriver.id] ?? 0} pts
            </p>
          </div>
        </section>
      )}

      <section>
        <h3 className="text-lg font-black text-white uppercase tracking-wider mb-4">Career arcs</h3>
        <div className="space-y-3">
          {arcs.slice(0, 5).map((arc, i) => (
            <div key={i} className="p-4 rounded-lg border-l-4" style={{ background: PANEL_BG, borderColor: F1_RED }}>
              {arc.type === "first_title" && <p className="text-white">{name(arc.driverId)} won their first title in {arc.year}</p>}
              {arc.type === "retirement" && <p className="text-white">{name(arc.driverId)} retired after {arc.year - (franchiseState.startYear || 2026)} seasons</p>}
            </div>
          ))}
          {arcs.length === 0 && <p className="text-white/40">No arcs detected.</p>}
        </div>
      </section>
    </div>
  );
}

function SeasonsTab({ franchiseState, selectedSeasonYear, setSelectedSeasonYear, selectedRaceIndex, setSelectedRaceIndex }) {
  const { seasonHistory, drivers, teams } = franchiseState;
  const years = (seasonHistory || []).map((e) => e.season ?? e.year).filter(Boolean);
  const current = seasonHistory?.find((e) => (e.season ?? e.year) === selectedSeasonYear);
  const [reportsCache, setReportsCache] = useState({});
  const [loadingReportKey, setLoadingReportKey] = useState(null);

  const selectedRace = current?.races?.[selectedRaceIndex];
  const reportKey = selectedRace ? selectedSeasonYear + "-" + selectedRace.round + "-" + (selectedRace.session ?? "gp") : null;

  const handleGenerateReport = useCallback(async () => {
    if (!reportKey || !current || !selectedRace) return;
    setLoadingReportKey(reportKey);
    try {
      const prevWinnerId = selectedRaceIndex > 0 ? current.races[selectedRaceIndex - 1]?.results?.[0]?.driverId : null;
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
          previousRaceWinner: prevWinnerId ? getDriver(drivers, prevWinnerId)?.name ?? null : null,
          focusDriverId: null,
          drivers, teams, mode: "franchise",
        }),
      });
      const data = await res.json();
      setReportsCache((prev) => ({ ...prev, [reportKey]: data?.commentary ?? "" }));
    } catch {
      setReportsCache((prev) => ({ ...prev, [reportKey]: "Unable to generate report." }));
    } finally {
      setLoadingReportKey(null);
    }
  }, [reportKey, current, selectedRace, selectedRaceIndex, drivers, teams, selectedSeasonYear]);

  return (
    <div className="space-y-6">
      {/* Year selector */}
      <div className="flex flex-wrap gap-2">
        {years.map((y) => (
          <button key={y} type="button" onClick={() => { setSelectedSeasonYear(y); setSelectedRaceIndex(0); }}
            className="px-4 py-2 rounded-full text-sm font-bold border transition-colors"
            style={{ borderColor: selectedSeasonYear === y ? F1_RED : "rgba(255,255,255,0.3)", background: selectedSeasonYear === y ? (F1_RED + "22") : PANEL_BG, color: "#fff" }}>
            {y}
          </button>
        ))}
      </div>

      {current && (
        <>
          {/* Season champion */}
          <div className="p-6 rounded-lg border" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
            <p className="text-white/50 text-sm">Champion</p>
            <p className="text-2xl font-black text-white" style={{ fontFamily: "var(--font-titillium)" }}>
              {getDriver(drivers, current.driverStandings?.[0]?.driverId)?.name ?? "—"}
            </p>
            <p className="text-white/60">{getTeam(teams, current.driverStandings?.[0]?.teamId)?.name} · {current.driverStandings?.[0]?.points ?? 0} pts</p>
          </div>

          {/* Driver standings */}
          <div>
            <h4 className="text-white font-bold mb-2">Driver standings</h4>
            <div className="rounded-lg border overflow-hidden" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
              <table className="w-full text-sm text-white">
                <thead>
                  <tr className="text-left text-white/50 border-b" style={{ borderColor: PANEL_BORDER }}>
                    <th className="p-2 w-10">Pos</th><th className="p-2 w-6" /><th className="p-2">Driver</th><th className="p-2">Team</th><th className="p-2">Pts</th><th className="p-2">Wins</th>
                  </tr>
                </thead>
                <tbody>
                  {(current.driverStandings || []).slice(0, 22).map((row, i) => {
                    const d = getDriver(drivers, row.driverId);
                    const t = getTeam(teams, row.teamId);
                    const medal = i === 0 ? GOLD : i === 1 ? "#C0C0C0" : i === 2 ? "#CD7F32" : undefined;
                    const w = computeWinsFromRaces(current.races)[row.driverId] ?? 0;
                    return (
                      <tr key={row.driverId} className="border-b" style={{ borderColor: PANEL_BORDER }}>
                        <td className="p-2 font-bold" style={{ color: medal ?? "rgba(255,255,255,0.7)" }}>{i + 1}</td>
                        <td className="p-2">{d?.flag}</td>
                        <td className="p-2">{d?.name ?? row.driverId}</td>
                        <td className="p-2">
                          <div className="flex items-center gap-1.5">
                            {t && <span className="w-2 h-2 rounded-full" style={{ background: t.color }} />}
                            <span className="text-white/70">{t?.name ?? row.teamId}</span>
                          </div>
                        </td>
                        <td className="p-2 text-white/70">{row.points ?? 0}</td>
                        <td className="p-2 text-white/70">{w}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Constructor standings */}
          <div>
            <h4 className="text-white font-bold mb-2">Constructor standings</h4>
            <div className="rounded-lg border overflow-hidden" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
              <table className="w-full text-sm text-white">
                <thead>
                  <tr className="text-left text-white/50 border-b" style={{ borderColor: PANEL_BORDER }}>
                    <th className="p-2 w-10">Pos</th><th className="p-2">Team</th><th className="p-2">Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {(current.constructorStandings || []).map((row, i) => {
                    const t = getTeam(teams, row.teamId);
                    return (
                      <tr key={row.teamId} className="border-b" style={{ borderColor: PANEL_BORDER }}>
                        <td className="p-2 font-bold text-white/70">{i + 1}</td>
                        <td className="p-2">
                          <div className="flex items-center gap-1.5">
                            {t && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: t.color }} />}
                            <span>{t?.name ?? row.teamId}</span>
                          </div>
                        </td>
                        <td className="p-2 text-white/70">{row.points ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Race selector */}
          <div>
            <h4 className="text-white font-bold mb-2">Race results</h4>
            <div className="flex flex-wrap gap-2 mb-4">
              {(current.races || []).map((race, idx) => {
                const label = race.session === "sprint" ? "R" + race.round + " Sprint" : "R" + race.round;
                const flag = race.flag ?? (RACES.find((r) => r.round === race.round)?.flag) ?? "🏁";
                return (
                  <button key={race.round + "-" + (race.session ?? "gp") + "-" + idx} type="button" onClick={() => setSelectedRaceIndex(idx)}
                    className="px-4 py-2 rounded border text-sm font-medium transition-colors"
                    style={{ borderColor: selectedRaceIndex === idx ? F1_RED : "rgba(255,255,255,0.2)", background: selectedRaceIndex === idx ? (F1_RED + "22") : PANEL_BG, color: "#fff" }}>
                    {label} {flag}
                  </button>
                );
              })}
            </div>
            {current.races?.[selectedRaceIndex] && (
              <div className="space-y-4">
                <RaceDetailBlock race={current.races[selectedRaceIndex]} drivers={drivers} teams={teams} />
                {/* Race report */}
                <div className="rounded-lg border overflow-hidden" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
                  <div className="px-4 py-3 border-b" style={{ borderColor: PANEL_BORDER }}>
                    <span className="text-xs font-black tracking-widest" style={{ color: F1_RED }}>RACE REPORT</span>
                  </div>
                  <div className="p-4">
                    <button type="button" onClick={handleGenerateReport} disabled={!!loadingReportKey}
                      className="px-4 py-2 rounded text-sm font-bold border transition-colors disabled:opacity-50"
                      style={{ borderColor: F1_RED, background: F1_RED + "22", color: "#fff" }}>
                      {loadingReportKey === reportKey ? "Generating…" : "Generate report"}
                    </button>
                    {loadingReportKey === reportKey && (
                      <div className="mt-3 flex items-center gap-2 text-white/60 text-sm">
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
                        Loading commentary…
                      </div>
                    )}
                    {reportsCache[reportKey] && loadingReportKey !== reportKey && (
                      <div className="mt-4 pl-8 pr-4 py-4 rounded relative" style={{ background: "#0e0e22" }}>
                        <span className="absolute left-3 top-3 text-3xl font-black leading-none" style={{ color: F1_RED }}>"</span>
                        <p className="text-white/90 italic text-sm leading-relaxed">{reportsCache[reportKey]}</p>
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
          <button key={t} type="button" onClick={() => setTransferFilter(t)}
            className="px-4 py-2 rounded text-sm font-bold border transition-colors"
            style={{ borderColor: transferFilter === t ? F1_RED : "rgba(255,255,255,0.3)", background: transferFilter === t ? (F1_RED + "22") : "transparent", color: "#fff" }}>
            {t}s
          </button>
        ))}
      </div>
      <div className="space-y-8">
        {Object.entries(byYear).sort((a, b) => Number(b[0]) - Number(a[0])).map(([year, items]) => (
          <div key={year}>
            <h4 className="text-white/70 font-bold mb-3">{year} OFF-SEASON</h4>
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="p-4 rounded-lg border-l-4 flex items-start gap-3" style={{ background: PANEL_BG, borderColor: item.teamColor ?? F1_RED }}>
                  <span className="text-xs uppercase font-bold px-2 py-0.5 rounded shrink-0" style={{ background: "rgba(255,255,255,0.1)", color: "#fff" }}>{item.type ?? "EVENT"}</span>
                  {(item.driverReputation > 85 || item.type === "retirement") && <span className="shrink-0">⭐</span>}
                  <div className="min-w-0">
                    {(item.out != null || item.in != null) ? (
                      <p className="text-white text-sm">
                        <span className="text-white/50">Out: </span>{item.out ?? "—"}
                        {item.leaveReason && <span className="text-white/40"> ({item.leaveReason})</span>}
                        <span className="text-white/30 mx-2">·</span>
                        <span className="text-white/50">In: </span>{item.in ?? "—"}
                        {item.reason && <><span className="text-white/30 mx-2">·</span><span className="capitalize text-white/50">{item.reason}</span></>}
                      </p>
                    ) : (
                      <>
                        <p className="text-white font-bold">{item.headline}</p>
                        <p className="text-white/60 text-sm mt-0.5">{item.detail}</p>
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

function FranchiseResults({ franchiseState, resultsTab, setResultsTab, selectedSeasonYear, setSelectedSeasonYear, selectedRaceIndex, setSelectedRaceIndex, transferFilter, setTransferFilter }) {
  const { seasonHistory, startYear } = franchiseState;
  const endYear = seasonHistory?.length ? (seasonHistory[seasonHistory.length - 1]?.season ?? startYear + seasonHistory.length - 1) : startYear;
  const decadeStats = useMemo(() => computeDecadeStats(seasonHistory, franchiseState.drivers), [seasonHistory, franchiseState.drivers]);

  return (
    <div className="min-h-screen" style={{ background: BG_DARK }}>
      <div className="sticky top-[57px] z-30 border-b" style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}>
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <span className="text-white/60 text-sm font-bold uppercase tracking-wider">{startYear}–{endYear}</span>
          <div className="flex gap-1">
            {["DECADE", "SEASONS", "TRANSFERS"].map((tab) => (
              <button key={tab} type="button" onClick={() => setResultsTab(tab)}
                className="px-4 py-2 text-sm font-black rounded border transition-colors uppercase tracking-wider"
                style={{ borderColor: resultsTab === tab ? F1_RED : "rgba(255,255,255,0.2)", background: resultsTab === tab ? (F1_RED + "22") : "transparent", color: resultsTab === tab ? "#fff" : "rgba(255,255,255,0.6)" }}>
                {tab}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-6 py-8">
        {resultsTab === "DECADE" && <DecadeTab franchiseState={franchiseState} decadeStats={decadeStats} />}
        {resultsTab === "SEASONS" && <SeasonsTab franchiseState={franchiseState} selectedSeasonYear={selectedSeasonYear} setSelectedSeasonYear={setSelectedSeasonYear} selectedRaceIndex={selectedRaceIndex} setSelectedRaceIndex={setSelectedRaceIndex} />}
        {resultsTab === "TRANSFERS" && <TransfersTab allOffSeasonNews={franchiseState.allOffSeasonNews} transferFilter={transferFilter} setTransferFilter={setTransferFilter} teams={franchiseState.teams} />}
      </div>
    </div>
  );
}

// ─── MAIN PAGE ──────────────────────────────────────────────────────────────
export default function SimulatorPage() {
  const [screen, setScreen] = useState("setup");
  const [franchiseState, setFranchiseState] = useState(null);
  const [simulationMode, setSimulationMode] = useState(SIMULATION_MODES.realistic);
  const [totalSeasons, setTotalSeasons] = useState(10);
  const [simProgress, setSimProgress] = useState(0);
  const [simStatusText, setSimStatusText] = useState("Simulating...");
  const [simSeasonIndex, setSimSeasonIndex] = useState(1);
  const [simYear, setSimYear] = useState(2026);
  const [resultsTab, setResultsTab] = useState("DECADE");
  const [selectedSeasonYear, setSelectedSeasonYear] = useState(2026);
  const [selectedRaceIndex, setSelectedRaceIndex] = useState(0);
  const [transferFilter, setTransferFilter] = useState("ALL");
  const runRef = useRef(false);

  const beginFranchise = useCallback((draftDrivers) => {
    const state = buildInitialFranchiseState({ simulationMode, totalSeasons, drivers: draftDrivers });
    setFranchiseState(state);
    setScreen("simulating");
    setSimProgress(0);
    setSimSeasonIndex(1);
    setSimYear(state.startYear);
    runRef.current = true;
  }, [simulationMode, totalSeasons]);

  useEffect(() => {
    if (screen !== "simulating" || !franchiseState || !runRef.current) return;
    runRef.current = false;

    const total = franchiseState.totalSeasons ?? 10;
    let state = JSON.parse(JSON.stringify(franchiseState));
    let seasonIndex = 1;
    const startYear = state.startYear ?? 2026;

    const runNext = () => {
      if (seasonIndex > total) {
        setFranchiseState(state);
        setScreen("results");
        setSelectedSeasonYear(state.seasonHistory?.[0]?.season ?? startYear);
        return;
      }
      const year = startYear + seasonIndex - 1;
      setSimSeasonIndex(seasonIndex);
      setSimYear(year);
      setSimStatusText("Season " + year + " — Simulating...");

      const result = simulateSeason({
        drivers: getActiveDrivers(state.drivers),
        teams: state.teams,
        races: RACES,
        chaosLevel: state.simulationMode?.chaosLevel ?? 5,
        safetyCarFrequency: state.simulationMode?.safetyCarFrequency ?? 5,
        upgradesEnabled: true,
        seasonLength: 24,
      });

      state.seasonHistory = [...(state.seasonHistory || []), { season: year, races: result.races, driverStandings: result.driverStandings, constructorStandings: result.constructorStandings }];

      setSimStatusText("Resolving off-season...");
      const midSeason = checkMidSeasonFirings(state, result.races, 12, state.simulationMode);
      if (midSeason.news?.length) {
        state.allOffSeasonNews = [...(state.allOffSeasonNews || []), ...midSeason.news.map((n) => ({ ...n, year: year + " mid-season" }))];
      }
      const resolved = resolveOffSeason(state, state.simulationMode);
      state = { ...resolved };
      state.allOffSeasonNews = [...(state.allOffSeasonNews || []), ...(resolved.offSeasonNews || []).map((n) => ({ ...n, year }))];

      setFranchiseState({ ...state });
      seasonIndex++;
      setSimProgress(Math.round(((seasonIndex - 1) / total) * 100));
      setTimeout(runNext, 1500);
    };

    runNext();
  }, [screen, franchiseState]);

  const onNewFranchise = useCallback(() => {
    setScreen("setup");
    setFranchiseState(null);
    setResultsTab("DECADE");
  }, []);

  return (
    <div className="min-h-screen text-white" style={{ background: BG_DARK }}>
      <TopNav onNewFranchise={onNewFranchise} showNew={screen === "results"} />

      {screen === "setup" && (
        <FranchiseSetup
          onBegin={beginFranchise}
          simulationMode={simulationMode}
          setSimulationMode={setSimulationMode}
          totalSeasons={totalSeasons}
          setTotalSeasons={setTotalSeasons}
        />
      )}

      {screen === "simulating" && (
        <SimulatingScreen
          seasonIndex={simSeasonIndex}
          totalSeasons={franchiseState?.totalSeasons ?? 10}
          year={simYear}
          progress={simProgress}
          statusText={simStatusText}
        />
      )}

      {screen === "results" && franchiseState && (
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
        />
      )}
    </div>
  );
}
