"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { TEAMS, DRIVERS, RACES, SIMULATION_MODES } from "@/lib/f1Data";
import { simulateSingleRace } from "@/lib/simulationEngine";

const F1_RED = "#E10600";
const BG_DARK = "#080812";
const PANEL_BG = "#0d0d1a";
const GOLD = "#FFD700";
const SILVER = "#C0C0C0";
const BRONZE = "#CD7F32";
const TOTAL_ROUNDS = 24;
const SEASON = 2026;

function getDriver(drivers, id) {
  return drivers?.find((d) => d.id === id);
}
function getTeam(teams, id) {
  return teams?.find((t) => t.id === id);
}
function getActiveDrivers(drivers) {
  return drivers.filter((d) => d.status === "active" && d.teamId);
}

// Races as GP only (no sprint) for single-season
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

// ─── SCREEN A: SETUP ─────────────────────────────────────────────────────
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
              <button
                type="button"
                onClick={() => setSimulationMode(realistic)}
                className="text-left p-5 rounded-lg border-2 transition-all"
                style={{
                  background: PANEL_BG,
                  borderColor: isRealistic ? "#fff" : "rgba(255,255,255,0.15)",
                }}
              >
                <p className="font-bold text-white">Realistic</p>
                <p className="text-sm text-white/70 mt-1">{realistic.description}</p>
              </button>
              <button
                type="button"
                onClick={() => setSimulationMode(wildcard)}
                className="text-left p-5 rounded-lg border-2 transition-all"
                style={{
                  background: PANEL_BG,
                  borderColor: !isRealistic ? F1_RED : "rgba(255,255,255,0.15)",
                }}
              >
                <p className="font-bold text-white">Wildcard</p>
                <p className="text-sm text-white/70 mt-1">{wildcard.description}</p>
              </button>
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

// ─── SCREEN B: RACE REVEAL ─────────────────────────────────────────────────
function RaceRevealScreen({
  raceResult,
  round,
  race,
  driverStandings,
  constructorStandings,
  previousRaceWinner,
  focusDriverId,
  seasonResults,
  onNextRace,
  onFinishSeason,
}) {
  const drivers = getActiveDrivers(DRIVERS);
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [radioWinner, setRadioWinner] = useState(null);
  const [radioFocus, setRadioFocus] = useState(null);
  const [radioLoading, setRadioLoading] = useState(true);

  const leader = driverStandings[0];
  const leaderName = leader ? getDriver(drivers, leader.driverId)?.name : "—";
  const leaderPts = leader?.points ?? 0;

  const prevStandings = useMemo(() => {
    if (seasonResults.length <= 1) return [];
    return buildDriverStandings(seasonResults.slice(0, -1), drivers);
  }, [seasonResults, drivers]);

  useEffect(() => {
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
        raceResult,
        qualifyingOrder: raceResult.qualifyingOrder || [],
        season: SEASON,
        round,
        totalRounds: TOTAL_ROUNDS,
        driverStandings,
        constructorStandings,
        previousRaceWinner,
        focusDriverId,
        drivers,
        teams: TEAMS,
        mode: "single",
      }),
    })
      .then((res) => res.json())
      .then((data) => { setReport(data.commentary || ""); })
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
            driverName: winnerDriver.name,
            teamName: winnerTeam.name,
            position: 1,
            raceName: race?.name ?? "Grand Prix",
            isWin: true,
            isDNF: false,
            season: SEASON,
          }),
        })
          .then((res) => res.json())
          .then((data) => setRadioWinner(data.radio))
      );
    }
    if (focusDriverId && focusDriver && focusTeam && (!winnerDriver || winnerDriver.id !== focusDriverId)) {
      promises.push(
        fetch("/api/team-radio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            driverName: focusDriver.name,
            teamName: focusTeam.name,
            position: focusResult?.position,
            raceName: race?.name ?? "Grand Prix",
            isWin: false,
            isDNF: focusResult?.dnf ?? false,
            isFocusDriver: true,
            season: SEASON,
          }),
        })
          .then((res) => res.json())
          .then((data) => setRadioFocus(data.radio))
      );
    }
    Promise.all(promises).finally(() => setRadioLoading(false));
  }, [raceResult, round, focusDriverId, driverStandings, constructorStandings, previousRaceWinner, seasonResults, race?.name]);

  if (!raceResult) return null;

  const winner = raceResult.results?.[0];
  const winnerTeam = winner ? getTeam(TEAMS, winner.teamId) : null;
  const qualifyingOrder = raceResult.qualifyingOrder || [];
  const positionCheckpoints = raceResult.positionCheckpoints || {};
  const tyreStints = raceResult.tyreStints || {};
  const overtakeCount = raceResult.overtakeCount || {};
  const driverOfDayId = raceResult.driverOfDay;
  const driverOfDay = driverOfDayId ? getDriver(drivers, driverOfDayId) : null;
  const driverOfDayGain = driverOfDayId ? (overtakeCount[driverOfDayId] || 0) : 0;
  const driverOfDayResult = driverOfDayId ? raceResult.results?.find((r) => r.driverId === driverOfDayId) : null;
  const driverOfDayQualiPos = driverOfDayId ? qualifyingOrder.indexOf(driverOfDayId) + 1 : null;

  const top10Results = (raceResult.results || []).slice(0, 10);
  const displayTyreDrivers = new Set(top10Results.map((r) => r.driverId));
  if (focusDriverId) displayTyreDrivers.add(focusDriverId);

  const checkpointLabels = ["Start", "Lap 5", "Lap 10", "Lap 15", "Lap 20", "Lap 25", "Lap 30", "Lap 35", "Lap 40", "Lap 45", "Lap 50", "Lap 55", "Finish"];
  const numCheckpoints = 20;
  const labelStep = Math.floor(numCheckpoints / (checkpointLabels.length - 1));

  return (
    <div className="min-h-screen text-white" style={{ background: BG_DARK }}>
      {/* Top bar */}
      <div className="sticky top-0 z-20 px-4 py-3 flex items-center justify-between border-b border-white/10" style={{ background: BG_DARK }}>
        <div className="text-sm">
          Round {round}/{TOTAL_ROUNDS} — {race?.name ?? "GP"} {race?.flag ?? ""}
        </div>
        <div className="text-sm text-white/80">
          {seasonResults.length > 0 ? `${leaderName} · ${leaderPts} pts` : "Season not started"}
        </div>
        <div className="w-32 h-2 rounded-full overflow-hidden border border-white/20" style={{ background: PANEL_BG }}>
          <div
            className="h-full transition-all duration-300"
            style={{ width: `${(round / TOTAL_ROUNDS) * 100}%`, background: F1_RED }}
          />
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* 1. Race header card */}
        <div
          className="rounded-lg p-6 border border-white/10"
          style={{
            background: winnerTeam?.color ? `linear-gradient(135deg, ${winnerTeam.color}22 0%, ${PANEL_BG} 60%)` : PANEL_BG,
          }}
        >
          <p className="text-white/60 text-xs uppercase tracking-wider">ROUND {round}</p>
          <h2 className="text-2xl md:text-3xl font-black mt-1" style={{ fontFamily: "var(--font-titillium)" }}>
            {race?.name ?? raceResult.raceName ?? "Grand Prix"}
          </h2>
          <p className="text-white/70 text-sm mt-1">{race?.location ?? ""} · {race?.date ?? ""}</p>
          <div className="flex gap-2 mt-3">
            <span className="px-2 py-0.5 rounded text-xs font-bold" style={{ background: "rgba(255,255,255,0.15)" }}>
              {(raceResult.weather || "dry").toUpperCase()}
            </span>
            {raceResult.safetyCarDeployed && (
              <span className="px-2 py-0.5 rounded text-xs font-bold" style={{ background: F1_RED }}>SAFETY CAR</span>
            )}
          </div>
        </div>

        {/* 2. Qualifying grid */}
        <div className="rounded-lg border border-white/10 overflow-hidden" style={{ background: PANEL_BG }}>
          <h3 className="p-3 border-b border-white/10 text-white font-bold">Qualifying grid</h3>
          <div className="grid grid-cols-2 gap-px bg-white/5 p-2">
            {[0, 1].map((col) => (
              <div key={col} className="space-y-0">
                {qualifyingOrder.slice(col * 11, col * 11 + 11).map((driverId, i) => {
                  const pos = col * 11 + i + 1;
                  const d = getDriver(drivers, driverId);
                  const t = d ? getTeam(TEAMS, d.teamId) : null;
                  const isFocus = driverId === focusDriverId;
                  return (
                    <div
                      key={driverId}
                      className="flex items-center gap-2 py-1.5 px-2 text-sm"
                      style={{ background: isFocus ? "rgba(225,6,0,0.2)" : PANEL_BG }}
                    >
                      <span className="text-white/60 w-6">{pos}</span>
                      {t && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: t.color }} />}
                      <span className="text-white truncate">{d?.name ?? driverId}</span>
                      <span className="text-white/50 text-xs truncate">{t?.name ?? ""}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* 3. Lap chart - SVG */}
        <div className="rounded-lg border border-white/10 overflow-hidden" style={{ background: PANEL_BG }}>
          <h3 className="p-3 border-b border-white/10 text-white font-bold">Lap chart</h3>
          <div className="p-4" style={{ height: "300px" }}>
            <LapChartSVG
              positionCheckpoints={positionCheckpoints}
              qualifyingOrder={qualifyingOrder}
              results={raceResult.results || []}
              drivers={drivers}
              teams={TEAMS}
              focusDriverId={focusDriverId}
              numCheckpoints={numCheckpoints}
            />
          </div>
          <div className="px-4 pb-3 flex flex-wrap gap-2 text-xs text-white/60">
            {focusDriverId && (
              <span className="text-white font-medium">{getDriver(drivers, focusDriverId)?.name ?? focusDriverId} (focus)</span>
            )}
            {qualifyingOrder.slice(0, 5).map((id) => (
              <span key={id}>{getDriver(drivers, id)?.short ?? id}</span>
            ))}
          </div>
        </div>

        {/* 4. Tyre strategy */}
        <div className="rounded-lg border border-white/10 overflow-hidden" style={{ background: PANEL_BG }}>
          <h3 className="p-3 border-b border-white/10 text-white font-bold">Tyre strategy</h3>
          <div className="p-3 space-y-2">
            {[...displayTyreDrivers].slice(0, 12).map((driverId) => {
              const stints = tyreStints[driverId] || [];
              const d = getDriver(drivers, driverId);
              const t = d ? getTeam(TEAMS, d.teamId) : null;
              const totalLaps = stints.reduce((s, x) => s + x.laps, 0);
              const isFocus = driverId === focusDriverId;
              return (
                <div key={driverId} className="flex items-center gap-3">
                  <span className={`text-sm w-32 truncate ${isFocus ? "text-white font-medium" : "text-white/80"}`}>{d?.name ?? driverId}</span>
                  <div className="flex-1 flex h-6 rounded overflow-hidden" style={{ maxWidth: "400px" }}>
                    {stints.map((st, i) => {
                      const w = totalLaps > 0 ? (st.laps / totalLaps) * 100 : 0;
                      const color = st.compound === "soft" ? "#E10600" : st.compound === "medium" ? "#FFD700" : st.compound === "hard" ? "#888" : st.compound === "intermediate" ? "#0a0" : "#06f";
                      const letter = st.compound.charAt(0).toUpperCase();
                      return (
                        <div
                          key={i}
                          className="flex items-center justify-center text-xs font-bold text-black"
                          style={{ width: `${w}%`, minWidth: w > 15 ? "auto" : "24px", background: color }}
                          title={`${st.compound} ${st.laps} laps`}
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
        </div>

        {/* 5. Race result top 10 */}
        <div className="rounded-lg border border-white/10 overflow-hidden" style={{ background: PANEL_BG }}>
          <h3 className="p-3 border-b border-white/10 text-white font-bold">Race result</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-white/60 border-b border-white/10">
                <th className="p-2 w-10">Pos</th>
                <th className="p-2">Driver</th>
                <th className="p-2 w-20">Gap</th>
                <th className="p-2 w-12">Pts</th>
              </tr>
            </thead>
            <tbody>
              {top10Results.map((r) => {
                const d = getDriver(drivers, r.driverId);
                const t = getTeam(TEAMS, r.teamId);
                const medal = r.position === 1 ? GOLD : r.position === 2 ? SILVER : r.position === 3 ? BRONZE : undefined;
                const isFocus = r.driverId === focusDriverId;
                return (
                  <tr key={r.driverId} className="border-b border-white/5" style={{ background: isFocus ? "rgba(225,6,0,0.15)" : undefined }}>
                    <td className="p-2 font-bold" style={{ color: medal }}>{r.position}</td>
                    <td className="p-2 flex items-center gap-2">
                      <span>{d?.flag}</span>
                      <span>{d?.name ?? r.driverId}</span>
                      {t && <span className="w-2 h-2 rounded-full" style={{ background: t.color }} />}
                    </td>
                    <td className="p-2 text-white/80">{r.gap ?? ""}</td>
                    <td className="p-2 text-white/80">{r.points ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(raceResult.results || []).filter((r) => r.dnf).length > 0 && (
            <div className="p-3 border-t border-white/10">
              <p className="text-xs text-white/50 uppercase mb-1">DNFs</p>
              {(raceResult.results || []).filter((r) => r.dnf).map((r) => (
                <p key={r.driverId} className="text-red-400 text-sm">{getDriver(drivers, r.driverId)?.name ?? r.driverId} — {r.dnfReason ?? "DNF"}</p>
              ))}
            </div>
          )}
        </div>

        {/* 6. Driver of the day */}
        {driverOfDay && (
          <div
            className="rounded-lg p-4 border-l-4"
            style={{ background: PANEL_BG, borderColor: getTeam(TEAMS, driverOfDay.teamId)?.color ?? F1_RED }}
          >
            <p className="text-white/60 text-xs uppercase">Driver of the day</p>
            <p className="text-xl font-black text-white mt-1" style={{ fontFamily: "var(--font-titillium)" }}>{driverOfDay.name}</p>
            <p className="text-white/80 text-sm mt-1">+{driverOfDayGain} positions gained</p>
            <p className="text-white/50 text-xs">Started P{driverOfDayQualiPos}, Finished P{driverOfDayResult?.position ?? "—"}</p>
          </div>
        )}

        {/* 7. Race report */}
        <div className="rounded-lg border border-white/10 overflow-hidden" style={{ background: PANEL_BG }}>
          <h3 className="p-3 border-b border-white/10 text-white font-bold">Race report</h3>
          <div className="p-4 pl-8 relative" style={{ background: "#12122a" }}>
            <span className="absolute left-4 top-4 text-2xl" style={{ color: F1_RED }}>"</span>
            {reportLoading ? (
              <div className="animate-pulse space-y-2">
                <div className="h-3 rounded bg-white/20 w-full" />
                <div className="h-3 rounded bg-white/20 w-5/6" />
                <div className="h-3 rounded bg-white/20 w-4/5" />
              </div>
            ) : (
              <p className="text-white/90 italic text-sm leading-relaxed" style={{ fontFamily: "var(--font-titillium)" }}>{report}</p>
            )}
          </div>
        </div>

        {/* 8. Team radio */}
        {(radioWinner || radioFocus) && !radioLoading && (
          <div className="space-y-3">
            {radioWinner && (
              <div className="rounded-lg border border-white/10 p-4" style={{ background: PANEL_BG }}>
                <span className="text-xs font-bold px-2 py-0.5 rounded text-green-400 bg-green-400/20">RADIO</span>
                <p className="text-white font-medium mt-2">{winner ? getDriver(drivers, winner.driverId)?.name : ""}</p>
                <p className="text-white/90 text-sm mt-1 font-mono">{radioWinner}</p>
              </div>
            )}
            {radioFocus && (!winner || winner.driverId !== focusDriverId) && (
              <div className="rounded-lg border border-white/10 p-4" style={{ background: PANEL_BG, borderLeftColor: getTeam(TEAMS, getDriver(drivers, focusDriverId)?.teamId)?.color, borderLeftWidth: "4px" }}>
                <span className="text-xs font-bold px-2 py-0.5 rounded text-green-400 bg-green-400/20">RADIO</span>
                <p className="text-white font-medium mt-2">{getDriver(drivers, focusDriverId)?.name}</p>
                <p className="text-white/90 text-sm mt-1 font-mono">{radioFocus}</p>
              </div>
            )}
          </div>
        )}

        {/* 9. Championship standings shift */}
        {prevStandings.length > 0 && (
          <div className="rounded-lg border border-white/10 overflow-hidden" style={{ background: PANEL_BG }}>
            <h3 className="p-3 border-b border-white/10 text-white font-bold">Championship after round {round}</h3>
            <div className="p-3 space-y-1">
              {driverStandings.slice(0, 5).map((row, i) => {
                const prevIdx = prevStandings.findIndex((p) => p.driverId === row.driverId);
                const prevPos = prevIdx >= 0 ? prevIdx + 1 : null;
                const currPos = i + 1;
                const move = prevPos != null && currPos !== prevPos ? (currPos < prevPos ? "▲" : "▼") : "";
                const d = getDriver(drivers, row.driverId);
                return (
                  <div key={row.driverId} className="flex items-center justify-between text-sm">
                    <span className="text-white/80">{currPos}. {d?.name ?? row.driverId}</span>
                    <span className={move === "▲" ? "text-green-400" : move === "▼" ? "text-red-400" : "text-white/50"}>{move} {row.points} pts</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Bottom: Next or Finale */}
        <div className="pt-6 pb-12">
          {round < TOTAL_ROUNDS ? (
            <button
              type="button"
              onClick={onNextRace}
              className="w-full py-4 font-black uppercase tracking-wider text-white rounded transition-all hover:opacity-95"
              style={{ background: F1_RED }}
            >
              SIMULATE NEXT RACE →
            </button>
          ) : (
            <button
              type="button"
              onClick={onFinishSeason}
              className="w-full py-4 font-black uppercase tracking-wider text-white rounded transition-all hover:opacity-95"
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

function LapChartSVG({ positionCheckpoints, qualifyingOrder, results, drivers, teams, focusDriverId, numCheckpoints }) {
  const width = 800;
  const height = 260;
  const padding = { top: 20, right: 20, bottom: 30, left: 35 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxPos = 22;

  const getTeamColor = (driverId) => getTeam(teams, getDriver(drivers, driverId)?.teamId)?.color ?? "#666";
  const dnfSet = new Set(results.filter((r) => r.dnf).map((r) => r.driverId));

  const lines = qualifyingOrder.map((driverId) => {
    const checkpoints = positionCheckpoints[driverId] || [];
    const points = checkpoints.map((pos, i) => {
      const x = padding.left + (i / (numCheckpoints - 1)) * chartWidth;
      const y = padding.top + (Math.min(pos, maxPos) / maxPos) * chartHeight;
      return `${x},${y}`;
    });
    const dnfResult = results.find((r) => r.driverId === driverId);
    const dnfCheckpoint = dnfResult?.dnf && checkpoints.length ? checkpoints.length - 1 : null;
    return { driverId, points, dnfCheckpoint, color: getTeamColor(driverId), isFocus: driverId === focusDriverId };
  });

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      {/* Y axis labels */}
      {[1, 5, 10, 15, 20].map((p) => (
        <text key={p} x={padding.left - 8} y={padding.top + (p / maxPos) * chartHeight} fill="rgba(255,255,255,0.5)" fontSize="10" textAnchor="end">{p}</text>
      ))}
      {/* X axis labels */}
      {[0, 5, 10, 15, 19].map((i) => (
        <text key={i} x={padding.left + (i / (numCheckpoints - 1)) * chartWidth} y={height - 8} fill="rgba(255,255,255,0.5)" fontSize="9" textAnchor="middle">
          {i === 0 ? "Start" : i === 19 ? "Finish" : `L${Math.round((i / 19) * 57)}`}
        </text>
      ))}
      {/* Grid lines */}
      {[1, 5, 10, 15, 20].map((p) => (
        <line key={p} x1={padding.left} y1={padding.top + (p / maxPos) * chartHeight} x2={padding.left + chartWidth} y2={padding.top + (p / maxPos) * chartHeight} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
      ))}
      {/* Driver lines */}
      {lines.map(({ driverId, points, dnfCheckpoint, color, isFocus }) => {
        if (points.length < 2) return null;
        const pathD = `M ${points.join(" L ")}`;
        return (
          <g key={driverId}>
            <path
              d={pathD}
              fill="none"
              stroke={color}
              strokeWidth={isFocus ? 3 : 1}
              strokeOpacity={isFocus ? 1 : 0.7}
            />
            {dnfCheckpoint != null && points[dnfCheckpoint] && (() => {
              const [cx, cy] = points[dnfCheckpoint].split(",").map(Number);
              return <circle cx={cx} cy={cy} r="4" fill="none" stroke="#e11" strokeWidth="2" />;
            })()}
          </g>
        );
      })}
    </svg>
  );
}

// ─── SCREEN C: CHAMPIONSHIP FINALE ─────────────────────────────────────────
function FinaleScreen({ seasonResults, driverStandings, constructorStandings, onPlayAgain, onShare }) {
  const drivers = getActiveDrivers(DRIVERS);
  const champ = driverStandings[0];
  const champDriver = champ ? getDriver(drivers, champ.driverId) : null;
  const champTeam = champ ? getTeam(TEAMS, champ.teamId) : null;
  const conChamp = constructorStandings[0];
  const conChampTeam = conChamp ? getTeam(TEAMS, conChamp.teamId) : null;

  const wins = {};
  seasonResults.forEach((race) => {
    const winner = race.results?.[0]?.driverId;
    if (winner) wins[winner] = (wins[winner] || 0) + 1;
  });
  const champWins = champ ? (wins[champ.driverId] || 0) : 0;
  const podiums = {};
  seasonResults.forEach((race) => {
    (race.results || []).slice(0, 3).forEach((r) => {
      if (!r.dnf) podiums[r.driverId] = (podiums[r.driverId] || 0) + 1;
    });
  });
  const champPodiums = champ ? (podiums[champ.driverId] || 0) : 0;

  const totalDnfs = seasonResults.reduce((sum, r) => sum + (r.results?.filter((x) => x.dnf).length || 0), 0);
  const safetyCars = seasonResults.filter((r) => r.safetyCarDeployed).length;
  const mostWinsDriverId = Object.entries(wins).sort((a, b) => b[1] - a[1])[0]?.[0];
  const poles = {};
  seasonResults.forEach((race) => {
    const pole = race.qualifyingOrder?.[0];
    if (pole) poles[pole] = (poles[pole] || 0) + 1;
  });
  const bestQualiId = Object.entries(poles).sort((a, b) => b[1] - a[1])[0]?.[0];
  const overtakeTotals = {};
  seasonResults.forEach((race) => {
    Object.entries(race.overtakeCount || {}).forEach(([id, n]) => {
      overtakeTotals[id] = (overtakeTotals[id] || 0) + n;
    });
  });
  const bestMoverId = Object.entries(overtakeTotals).sort((a, b) => b[1] - a[1])[0]?.[0];
  const countries = new Set(seasonResults.map((r) => r.race?.country ?? r.raceName).filter(Boolean));

  const shareText = `I just simulated the ${SEASON} F1 season!\nChampion: ${champDriver?.name ?? "—"} (${champ?.points ?? 0}pts, ${champWins} wins)\nConstructors: ${conChampTeam?.name ?? "—"}\nBest race: ${seasonResults[0]?.race?.name ?? "—"} won by ${seasonResults[0]?.results?.[0] ? getDriver(drivers, seasonResults[0].results[0].driverId)?.name : "—"}\n#F1Simulator`;

  return (
    <div className="min-h-screen text-white" style={{ background: BG_DARK }}>
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <h2 className="text-2xl uppercase tracking-widest text-white/60">World Champion</h2>
        <h1 className="text-5xl md:text-7xl font-black mt-4" style={{ fontFamily: "var(--font-titillium)" }}>
          {champDriver?.name ?? "—"}
        </h1>
        <p className="text-xl mt-2" style={{ color: champTeam?.color ?? F1_RED }}>{champTeam?.name ?? ""}</p>
        <p className="text-white/80 mt-4">{champ?.points ?? 0} pts · {champWins} wins · {champPodiums} podiums</p>
        <p className="text-white/50 text-sm mt-2">After 24 races across {countries.size} countries</p>

        <div className="mt-12 p-6 rounded-lg border border-white/10 text-left" style={{ background: PANEL_BG }}>
          <h3 className="text-white font-bold mb-4">Season in numbers</h3>
          <ul className="space-y-2 text-white/80 text-sm">
            <li>Total races: 24 · DNFs: {totalDnfs} · Safety cars: {safetyCars}</li>
            <li>Most wins: {mostWinsDriverId ? getDriver(drivers, mostWinsDriverId)?.name : "—"} ({(wins[mostWinsDriverId] || 0)})</li>
            <li>Best qualifying record: {bestQualiId ? getDriver(drivers, bestQualiId)?.name : "—"} ({(poles[bestQualiId] || 0)} poles)</li>
            <li>Most positions gained (season): {bestMoverId ? getDriver(drivers, bestMoverId)?.name : "—"}</li>
          </ul>
        </div>

        <div className="mt-8 p-6 rounded-lg border border-white/10 text-left" style={{ background: PANEL_BG }}>
          <h3 className="text-white font-bold mb-4">Race winners</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {seasonResults.map((race, i) => {
              const winner = race.results?.[0];
              const d = winner ? getDriver(drivers, winner.driverId) : null;
              const t = winner ? getTeam(TEAMS, winner.teamId) : null;
              return (
                <div key={i} className="text-sm flex items-center gap-1">
                  <span className="text-white/50 shrink-0">R{race.round ?? i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-white truncate">{race.raceName ?? race.race?.name ?? "—"}</p>
                    <p className="text-white/80 truncate">{d?.name ?? "—"}</p>
                  </div>
                  {t && <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: t.color }} />}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-8 p-6 rounded-lg border-l-4" style={{ background: PANEL_BG, borderColor: conChampTeam?.color ?? F1_RED }}>
          <p className="text-white/60 text-sm">Constructors champion</p>
          <p className="text-2xl font-black text-white" style={{ fontFamily: "var(--font-titillium)" }}>{conChampTeam?.name ?? "—"}</p>
          <p className="text-white/70">{conChamp?.points ?? 0} pts</p>
        </div>

        <div className="mt-12 flex flex-col sm:flex-row gap-4">
          <button
            type="button"
            onClick={onPlayAgain}
            className="flex-1 py-4 font-bold uppercase tracking-wider rounded border border-white/30 text-white hover:bg-white/10"
          >
            Play again
          </button>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(shareText);
              onShare?.();
            }}
            className="flex-1 py-4 font-bold uppercase tracking-wider rounded text-white hover:opacity-90"
            style={{ background: F1_RED }}
          >
            Share results
          </button>
        </div>
      </div>
    </div>
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
  const [shared, setShared] = useState(false);

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

  const handleFinishSeason = useCallback(() => {
    setScreen("finale");
  }, []);

  const handlePlayAgain = useCallback(() => {
    setScreen("setup");
    setSeasonResults([]);
    setCurrentRound(0);
    setCurrentRaceResult(null);
  }, []);

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
        onPlayAgain={handlePlayAgain}
        onShare={() => setShared(true)}
      />
    );
  }

  if (screen === "race") {
    if (loadingNext) {
      const nextRound = currentRound;
      const nextRace = GP_RACES[nextRound - 1];
      return (
        <div className="min-h-screen flex items-center justify-center text-white" style={{ background: BG_DARK }}>
          <div className="text-center space-y-4">
            <div className="inline-block w-10 h-10 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            <p className="text-white/80 text-lg">Simulating {nextRace?.name ?? `Round ${nextRound}`}...</p>
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
        onFinishSeason={handleFinishSeason}
      />
    );
  }

  if (loadingNext && !currentRaceResult) {
    const nextRound = currentRound + 1;
    const nextRace = GP_RACES[nextRound - 1];
    return (
      <div className="min-h-screen flex items-center justify-center text-white" style={{ background: BG_DARK }}>
        <div className="text-center">
          <div className="inline-block w-10 h-10 border-2 border-white/30 border-t-white rounded-full animate-spin mb-4" />
          <p>Simulating {nextRace?.name ?? `Round ${nextRound}`}...</p>
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
      onFinishSeason={handleFinishSeason}
    />
  );
}
