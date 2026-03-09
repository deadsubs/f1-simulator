/**
 * Franchise Engine — everything that happens BETWEEN seasons.
 * Exports: resolveOffSeason, checkMidSeasonFirings
 */

import { TEAM_BUDGETS, CONTRACT_LENGTHS } from "./f1Data.js";

// =============================================================================
// HELPERS
// =============================================================================

function randomInt(min, maxInclusive) {
  return Math.floor(min + Math.random() * (maxInclusive - min + 1));
}

function roll(probability) {
  return Math.random() < probability;
}

function clamp(val, minVal, maxVal) {
  return Math.max(minVal, Math.min(maxVal, val));
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function getTeamById(teams, id) {
  return teams.find((t) => t.id === id);
}

/** Get constructor position (1-based) from standings */
function getConstructorPosition(constructorStandings, teamId) {
  const idx = constructorStandings.findIndex((c) => c.teamId === teamId);
  return idx === -1 ? 11 : idx + 1;
}

/** Get driver position (1-based) and points from driver standings */
function getDriverSeasonResult(driverStandings, driverId) {
  const idx = driverStandings.findIndex((d) => d.driverId === driverId);
  if (idx === -1) return { position: 22, points: 0 };
  return { position: idx + 1, points: driverStandings[idx].points || 0 };
}

/** Count wins from races array */
function getWinsFromRaces(races) {
  const wins = {};
  for (const race of races || []) {
    const winner = race.results?.[0]?.driverId;
    if (winner) wins[winner] = (wins[winner] || 0) + 1;
  }
  return wins;
}

// =============================================================================
// STEP 1 — AGING AND DECLINE
// =============================================================================

function applyAgingAndDecline(drivers) {
  for (const d of drivers) {
    d.age = (d.age || 0) + 1;
    if (d.status === "retired") continue;

    const peakAge = d.peakAge ?? 28;
    const isAlonso = d.id === "alonso";
    let effectiveYears = 0;
    if (isAlonso) {
      if (d.age < 45) continue;
      effectiveYears = Math.floor((d.age - 45) / 2);
    } else {
      effectiveYears = d.age - peakAge;
    }
    if (effectiveYears <= 0) continue;

    if (effectiveYears > 6) {
      d.pace = Math.max(50, (d.pace || 70) - 2);
      d.consistency = Math.max(50, (d.consistency || 70) - 2);
    } else if (effectiveYears > 4) {
      d.pace = Math.max(50, (d.pace || 70) - 2);
      d.consistency = Math.max(50, (d.consistency || 70) - 1);
    } else if (effectiveYears > 2) {
      d.pace = Math.max(50, (d.pace || 70) - 1);
    }
  }
}

// =============================================================================
// STEP 2 — JUNIOR DEVELOPMENT
// =============================================================================

function applyJuniorDevelopment(drivers) {
  for (const d of drivers) {
    if (d.status !== "junior" && d.status !== "reserve") continue;
    const age = d.age || 20;
    let gain;
    if (age <= 20) gain = randomInt(3, 6);
    else if (age <= 23) gain = randomInt(1, 4);
    else gain = randomInt(0, 2);
    d.reputation = clamp((d.reputation || 50) + gain, 0, 99);
    d.form = d.reputation;
  }
}

// =============================================================================
// STEP 3 — FORM ADJUSTMENT (based on last season)
// =============================================================================

function applyFormAdjustment(drivers, teams, lastSeason, transfers) {
  if (!lastSeason?.driverStandings?.length) return;

  const driverStandings = lastSeason.driverStandings;
  const races = lastSeason.races || [];
  const driverWins = getWinsFromRaces(races);

  // Build expected position by team (by basePace)
  const teamOrder = [...teams]
    .filter((t) => t.basePace != null)
    .sort((a, b) => (b.basePace || 0) - (a.basePace || 0));
  const teamRank = {};
  teamOrder.forEach((t, i) => (teamRank[t.id] = i + 1));

  for (const d of drivers) {
    if (d.status !== "active") continue;

    const result = getDriverSeasonResult(driverStandings, d.id);
    const position = result.position;
    const points = result.points;
    const wins = driverWins[d.id] || 0;

    const teamRk = teamRank[d.teamId] ?? 11;
    const expectedPosition = (teamRk - 1) * 2 + 1.5; // rough expected
    const diff = expectedPosition - position; // positive = outperformed

    let formDelta = 0;
    let repDelta = 0;

    if (position === 1) repDelta += 3;
    if (wins >= 2) repDelta += 1;
    if (points === 0 && position <= 22) {
      repDelta -= 3;
      formDelta -= 5;
    } else if (diff >= 3) formDelta = randomInt(3, 6);
    else if (diff >= -1) formDelta = randomInt(0, 2);
    else formDelta = -randomInt(2, 5);

    d.form = clamp((d.form || d.reputation) + formDelta, 40, 99);
    d.reputation = clamp((d.reputation || 70) + repDelta, 40, 99);
  }
}

// =============================================================================
// STEP 4 — RETIREMENTS (only drivers over 45; extremely rare)
// =============================================================================

function applyRetirements(drivers, teams, lastSeason, simulationMode, retirements, offSeasonNews) {
  const modeMultiplier = (simulationMode.retirementProbability ?? 0.15) / 0.15;

  for (const d of drivers) {
    if (d.status !== "active") continue;

    const age = d.age || 30;
    if (age <= 45) continue; // Only drivers over 45 can consider retirement

    let prob = 0.02 * modeMultiplier; // Very rare base
    if (age >= 48) prob = 0.05 * modeMultiplier;
    else if (age >= 46) prob = 0.03 * modeMultiplier;

    if (!roll(prob)) continue;

    d.status = "retired";
    const team = getTeamById(teams, d.teamId);
    const seasons = 15;
    retirements.push({ driver: d, teamId: d.teamId });
    offSeasonNews.push({
      type: "retirement",
      out: d.name,
      in: "—",
      reason: "retirement",
      headline: `${d.name} announces retirement`,
      detail: `${d.name} announces retirement after ${seasons} seasons in F1`,
      teamColor: team?.color || "#666",
      driverName: d.name,
    });
    d.teamId = null;
  }
}

// =============================================================================
// STEP 5 — CONTRACT EXPIRY
// =============================================================================

function applyContractExpiry(drivers) {
  const freeAgents = [];
  for (const d of drivers) {
    if (d.status !== "active") continue;
    d.contractExpiry = (d.contractExpiry ?? 1) - 1;
    if (d.contractExpiry <= 0) {
      d.contractExpiry = 0;
      d.previousTeamId = d.teamId;
      freeAgents.push(d);
      d.teamId = null;
    }
  }
  freeAgents.sort((a, b) => (b.reputation || 0) - (a.reputation || 0));
  return freeAgents;
}

// =============================================================================
// STEP 6 — TEAM BUDGET UPDATES
// =============================================================================

function applyBudgetAndPaceUpdates(teams, constructorStandings) {
  if (!constructorStandings?.length) return;

  for (const t of teams) {
    const pos = constructorStandings.findIndex((c) => c.teamId === t.id) + 1 || 11;
    let budget = t.budget ?? TEAM_BUDGETS[t.id] ?? 100;
    if (pos === 1) budget *= 1.1;
    else if (pos <= 3) budget *= 1.05;
    else if (pos >= 10) budget *= 0.9;
    else if (pos >= 7) budget *= 0.95;
    t.budget = clamp(budget, 60, 400);

    if (pos === 1 && t.basePace != null) t.basePace = Math.max(70, t.basePace - 1);
    else if (pos >= 10 && t.basePace != null) t.basePace = Math.min(99, t.basePace + 1);
  }
}

// =============================================================================
// STEP 7 — TRANSFER WINDOW
// =============================================================================

function getContractYears(team, teams) {
  const budget = team.budget ?? TEAM_BUDGETS[team.id] ?? 100;
  if (budget >= 280) return randomInt(CONTRACT_LENGTHS.top.min, CONTRACT_LENGTHS.top.max);
  if (budget >= 150) return randomInt(CONTRACT_LENGTHS.midfield.min, CONTRACT_LENGTHS.midfield.max);
  return randomInt(CONTRACT_LENGTHS.lower.min, CONTRACT_LENGTHS.lower.max);
}

function countActiveDriversInTeam(drivers, teamId) {
  return drivers.filter((d) => d.status === "active" && d.teamId === teamId).length;
}

// Name parts for generated drivers (keep grid at 22 when reserves run out)
const GEN_FIRST = ["Alex", "Marcus", "Luca", "Theo", "Enzo", "Felix", "Yuki", "Oscar", "James", "Rafael", "Liam", "Aiden", "Kai", "Noah", "Ethan", "Leo", "Max", "Finn", "Jonas", "Viktor"];
const GEN_LAST = ["Romano", "van Berg", "Davidson", "Eriksson", "Tanaka", "Mendes", "Morrison", "Costa", "O'Brien", "Schmidt", "Nielsen", "Kowalski", "Rossi", "Moreau", "Silva", "Petrov", "Kim", "Chen", "Sato", "Yamamoto"];

function generateNewDriver(drivers) {
  const usedIds = new Set(drivers.map((d) => d.id));
  let id;
  for (let i = 0; i < 1000; i++) {
    id = `gen_${drivers.length}_${randomInt(0, 99999)}`;
    if (!usedIds.has(id)) break;
  }
  const first = GEN_FIRST[randomInt(0, GEN_FIRST.length - 1)];
  const last = GEN_LAST[randomInt(0, GEN_LAST.length - 1)];
  const name = `${first} ${last}`;
  const short = (last.slice(0, 2) + first.slice(0, 1)).toUpperCase();
  const reputation = randomInt(52, 68);
  const pace = clamp(reputation + randomInt(-3, 5), 55, 78);
  const flags = ["🇬🇧", "🇺🇸", "🇩🇪", "🇫🇷", "🇪🇸", "🇮🇹", "🇧🇷", "🇳🇱", "🇯🇵", "🇦🇺", "🇲🇽", "🇨🇦", "🇸🇪", "🇫🇮", "🇩🇰"];
  const driver = {
    id,
    name,
    short,
    number: null,
    teamId: null,
    flag: flags[randomInt(0, flags.length - 1)],
    pace,
    consistency: clamp(pace + randomInt(-4, 2), 52, 80),
    wetWeather: clamp(pace + randomInt(-3, 3), 55, 78),
    tyreManagement: clamp(pace + randomInt(-2, 2), 55, 78),
    overtaking: clamp(pace + randomInt(-2, 4), 58, 82),
    defending: clamp(pace + randomInt(-3, 2), 54, 78),
    age: randomInt(18, 21),
    contractExpiry: 0,
    reputation,
    form: reputation,
    status: "junior",
    peakAge: randomInt(26, 28),
  };
  drivers.push(driver);
  return driver;
}

function fillOneVacantSeat(drivers, teamId, team, freeAgents, availableReserves, signings, promotions, offSeasonNews, transfers, teams, teamLeavers) {
  const budget = team.budget ?? TEAM_BUDGETS[team.id] ?? 0;
  const costMultiplier = 2.5;

  // Re-sign: same team fills the seat with their own ex-driver — no transfer news, don't consume leaver
  const reSign = freeAgents.find((d) => d.previousTeamId === teamId);
  if (reSign) {
    const years = getContractYears(team, teams);
    reSign.teamId = teamId;
    reSign.contractExpiry = years;
    reSign.status = "active";
    freeAgents.splice(freeAgents.indexOf(reSign), 1);
    signings.push({ driver: reSign, teamId, years });
    transfers.push({ driverId: reSign.id, teamId, season: null, type: "signing" });
    return true;
  }

  let affordable = freeAgents.filter((d) => (d.reputation || 0) * costMultiplier <= budget);
  let pick = affordable[0];
  if (!pick && freeAgents.length > 0) {
    const relaxedMultiplier = costMultiplier * 0.8;
    affordable = freeAgents.filter((d) => (d.reputation || 0) * relaxedMultiplier <= budget);
    pick = affordable[0];
  }
  if (pick) {
    const leaver = teamLeavers[teamId]?.shift();
    const outName = leaver?.name ?? "—";
    const leaveReason = leaver?.leaveReason ?? "—";
    const years = getContractYears(team, teams);
    pick.teamId = teamId;
    pick.contractExpiry = years;
    pick.status = "active";
    freeAgents.splice(freeAgents.indexOf(pick), 1);
    signings.push({ driver: pick, teamId, years });
    transfers.push({ driverId: pick.id, teamId, season: null, type: "signing" });
    offSeasonNews.push({
      type: "signing",
      out: outName,
      in: pick.name,
      reason: "signing",
      leaveReason,
      headline: `${team.name} sign ${pick.name}`,
      detail: `${team.name} sign ${pick.name} on ${years}-year deal`,
      teamColor: team.color || "#666",
      driverName: pick.name,
      driverReputation: pick.reputation,
    });
    return true;
  }

  const promo = availableReserves[0];
  if (promo) {
    const leaver = teamLeavers[teamId]?.shift();
    const outName = leaver?.name ?? "—";
    const leaveReason = leaver?.leaveReason ?? "—";
    promo.teamId = teamId;
    promo.contractExpiry = 1;
    promo.status = "active";
    availableReserves.splice(0, 1);
    promotions.push({ driver: promo, teamId });
    offSeasonNews.push({
      type: "promotion",
      out: outName,
      in: promo.name,
      reason: "promotion",
      leaveReason,
      headline: `${promo.name} promoted to ${team.name}`,
      detail: `${promo.name} promoted from reserves to ${team.name} for their F1 debut`,
      teamColor: team.color || "#666",
      driverName: promo.name,
    });
    return true;
  }

  // No reserve left — generate a new driver so grid stays at 22
  const generated = generateNewDriver(drivers);
  const leaver = teamLeavers[teamId]?.shift();
  const outName = leaver?.name ?? "—";
  const leaveReason = leaver?.leaveReason ?? "—";
  generated.teamId = teamId;
  generated.contractExpiry = 1;
  generated.status = "active";
  promotions.push({ driver: generated, teamId });
  offSeasonNews.push({
    type: "promotion",
    out: outName,
    in: generated.name,
    reason: "promotion",
    leaveReason,
    headline: `${generated.name} promoted to ${team.name}`,
    detail: `${generated.name} makes F1 debut with ${team.name}`,
    teamColor: team.color || "#666",
    driverName: generated.name,
  });
  return true;
}

function runTransferWindow(
  drivers,
  teams,
  freeAgents,
  simulationMode,
  signings,
  promotions,
  offSeasonNews,
  transfers,
  teamLeavers
) {
  const leavers = teamLeavers || {};
  const juniorsAndReserves = drivers.filter(
    (d) => (d.status === "junior" || d.status === "reserve") && !d.teamId
  );
  const availableReserves = [...juniorsAndReserves].sort(
    (a, b) => (b.reputation || 0) - (a.reputation || 0)
  );

  const tier1 = teams.filter((t) => (t.budget ?? TEAM_BUDGETS[t.id] ?? 0) >= 280);
  const tier2 = teams.filter((t) => {
    const b = t.budget ?? TEAM_BUDGETS[t.id] ?? 0;
    return b >= 150 && b < 280;
  });
  const tier3and4 = teams.filter((t) => (t.budget ?? TEAM_BUDGETS[t.id] ?? 0) < 150);

  const processTier = (teamList) => {
    for (const t of teamList) {
      const needed = 2 - countActiveDriversInTeam(drivers, t.id);
      for (let s = 0; s < needed; s++) {
        fillOneVacantSeat(drivers, t.id, t, freeAgents, availableReserves, signings, promotions, offSeasonNews, transfers, teams, leavers);
      }
    }
  };

  processTier(tier1);
  processTier(tier2);
  processTier(tier3and4);

  const totalFilled = drivers.filter((d) => d.status === "active" && d.teamId).length;
  if (totalFilled < 22) {
    if (typeof console !== "undefined" && console.warn) {
      console.warn(`[Transfer window] Only ${totalFilled}/22 seats filled. No generated drivers — use more reserves/juniors in data if needed.`);
    }
    for (const t of teams) {
      const count = countActiveDriversInTeam(drivers, t.id);
      for (let i = count; i < 2; i++) {
        const reservesNow = drivers.filter((d) => (d.status === "junior" || d.status === "reserve") && !d.teamId).sort((a, b) => (b.reputation || 0) - (a.reputation || 0));
        if (reservesNow[0]) {
          const promo = reservesNow[0];
          const leaver = leavers[t.id]?.shift();
          const outName = leaver?.name ?? "—";
          const leaveReason = leaver?.leaveReason ?? "—";
          promo.teamId = t.id;
          promo.contractExpiry = 1;
          promo.status = "active";
          promotions.push({ driver: promo, teamId: t.id });
          offSeasonNews.push({
            type: "promotion",
            out: outName,
            in: promo.name,
            reason: "promotion",
            leaveReason,
            headline: `${t.name} promote ${promo.name}`,
            detail: `${promo.name} promoted to ${t.name} (validation fill)`,
            teamColor: t.color || "#666",
            driverName: promo.name,
          });
        } else {
          const generated = generateNewDriver(drivers);
          const leaver = leavers[t.id]?.shift();
          const outName = leaver?.name ?? "—";
          const leaveReason = leaver?.leaveReason ?? "—";
          generated.teamId = t.id;
          generated.contractExpiry = 1;
          generated.status = "active";
          promotions.push({ driver: generated, teamId: t.id });
          offSeasonNews.push({
            type: "promotion",
            out: outName,
            in: generated.name,
            reason: "promotion",
            leaveReason,
            headline: `${t.name} sign ${generated.name}`,
            detail: `${generated.name} makes F1 debut with ${t.name} (validation fill)`,
            teamColor: t.color || "#666",
            driverName: generated.name,
          });
        }
      }
    }
  }
}

// =============================================================================
// STEP 8 — MID-SEASON FIRING CHECK (exported separately)
// =============================================================================

/**
 * Runs after race 12. Returns list of firings made.
 */
export function checkMidSeasonFirings(franchiseState, raceResults, currentRound, simulationMode) {
  if (currentRound < 12) return { firings: [], news: [] };

  const { drivers, teams } = franchiseState;
  const races = (raceResults || []).slice(0, 12);
  const points = {};
  drivers.forEach((d) => (points[d.id] = 0));
  for (const race of races) {
    for (const r of race.results || []) {
      if (!r.dnf) points[r.driverId] = (points[r.driverId] || 0) + r.points;
    }
  }
  const sorted = [...drivers]
    .filter((d) => d.status === "active" && d.teamId)
    .sort((a, b) => (points[b.id] || 0) - (points[a.id] || 0));
  const bottomSixIds = new Set(sorted.slice(-6).map((d) => d.id));

  const firings = [];
  const news = [];

  for (const d of drivers) {
    if (d.status !== "active" || !d.teamId) continue;
    const myPoints = points[d.id] || 0;
    const teammate = drivers.find(
      (x) => x.status === "active" && x.teamId === d.teamId && x.id !== d.id
    );
    const teammatePoints = teammate ? points[teammate.id] || 0 : 0;
    if (teammatePoints === 0 && myPoints === 0) continue;
    if (myPoints >= teammatePoints * 0.5) continue;
    if (!bottomSixIds.has(d.id)) continue;
    if (!roll(simulationMode.firingProbability ?? 0.25)) continue;

    const team = getTeamById(teams, d.teamId);
    const reserves = franchiseState.drivers.filter(
      (x) => (x.status === "reserve" || x.status === "junior") && !x.teamId
    );
    const replacement = reserves.sort((a, b) => (b.reputation || 0) - (a.reputation || 0))[0];
    if (!replacement) continue;

    d.teamId = null;
    d.status = "reserve";
    d.contractExpiry = 0;
    replacement.teamId = team.id;
    replacement.status = "active";
    replacement.contractExpiry = 1;
    firings.push({ fired: d, replacement, teamId: team.id });
    news.push({
      type: "firing",
      out: d.name,
      in: replacement.name,
      reason: "firing",
      leaveReason: "fired",
      headline: `${team.name} replace ${d.name}`,
      detail: `${team.name} replace ${d.name} with ${replacement.name} with immediate effect`,
      teamColor: team.color || "#666",
      driverName: d.name,
    });
  }

  return { firings, news };
}

// =============================================================================
// STEP 9 — OFF-SEASON NEWS FEED (ordered)
// =============================================================================

function buildOrderedOffSeasonNews(offSeasonNews) {
  const retirements = offSeasonNews.filter((n) => n.type === "retirement");
  const bigSignings = offSeasonNews.filter(
    (n) => n.type === "signing" && (n.driverReputation ?? 0) > 85
  );
  const otherSignings = offSeasonNews.filter(
    (n) => n.type === "signing" && (n.driverReputation ?? 0) <= 85
  );
  const promotions = offSeasonNews.filter((n) => n.type === "promotion");
  return [...retirements, ...bigSignings, ...otherSignings, ...promotions];
}

// =============================================================================
// STEP 10 — SEASON PREVIEW STORYLINES
// =============================================================================

function generatePreviewStorylines(drivers, teams, signings, currentSeason) {
  const storylines = [];
  const topDrivers = drivers
    .filter((d) => d.status === "active" && d.teamId)
    .sort((a, b) => (b.reputation || 0) - (a.reputation || 0));
  const blockbuster = signings.find((s) => (s.driver?.reputation || 0) >= 90);
  if (blockbuster) {
    const t = getTeamById(teams, blockbuster.teamId);
    storylines.push(
      `${blockbuster.driver.name} joins ${t.name} in a blockbuster move — the sport holds its breath`
    );
  }

  if (topDrivers[0]) {
    const d = topDrivers[0];
    const t = getTeamById(teams, d.teamId);
    storylines.push(
      `Can ${d.name} challenge for the title again in ${t.name}'s machine?`
    );
  }

  const youngGun = drivers.find(
    (d) => d.status === "active" && d.teamId && (d.age || 25) <= 22 && (d.reputation || 0) >= 75
  );
  if (youngGun) {
    const t = getTeamById(teams, youngGun.teamId);
    storylines.push(
      `${youngGun.name} enters year ${currentSeason} with ${t.name} — can he break through for a first win?`
    );
  }

  while (storylines.length < 3) {
    storylines.push(
      `Season ${currentSeason} is here — the grid is set and the title fight begins.`
    );
  }
  return storylines.slice(0, 3);
}

// =============================================================================
// MAIN EXPORT — resolveOffSeason
// =============================================================================

/**
 * Resolves everything between seasons. Mutates a clone of franchiseState and returns
 * it plus offSeasonNews, retirements, promotions, signings, firings, previewStorylines.
 *
 * @param {Object} franchiseState - { currentSeason, teams, drivers, seasonHistory, transfers }
 * @param {Object} simulationMode - SIMULATION_MODES.realistic or .wildcard
 * @returns {Object} Updated franchiseState + offSeasonNews, retirements, promotions, signings, firings, previewStorylines
 */
export function resolveOffSeason(franchiseState, simulationMode) {
  const state = deepClone(franchiseState);
  const { drivers, teams, seasonHistory } = state;
  const lastSeason = seasonHistory?.length
    ? seasonHistory[seasonHistory.length - 1]
    : null;
  const constructorStandings = lastSeason?.constructorStandings || [];
  const driverStandings = lastSeason?.driverStandings || [];

  // Ensure teams have budget
  for (const t of teams) {
    if (t.budget == null) t.budget = TEAM_BUDGETS[t.id] ?? 100;
  }

  const retirements = [];
  const promotions = [];
  const signings = [];
  const firings = [];
  const offSeasonNews = [];

  // Step 1 — Aging and decline
  applyAgingAndDecline(drivers);

  // Step 2 — Junior development
  applyJuniorDevelopment(drivers);

  // Step 3 — Form adjustment (last season)
  applyFormAdjustment(drivers, teams, lastSeason, state.transfers || []);

  // Step 4 — Retirements
  applyRetirements(drivers, teams, lastSeason, simulationMode, retirements, offSeasonNews);

  // Step 5 — Contract expiry → free agents
  let freeAgents = applyContractExpiry(drivers);

  // Build who left each team and why (for 1-in-1-out transfer display)
  const teamLeavers = {};
  for (const r of retirements) {
    const tid = r.teamId;
    if (tid) {
      if (!teamLeavers[tid]) teamLeavers[tid] = [];
      teamLeavers[tid].push({ name: r.driver.name, leaveReason: "retirement" });
    }
  }
  for (const d of freeAgents) {
    const tid = d.previousTeamId;
    if (tid) {
      if (!teamLeavers[tid]) teamLeavers[tid] = [];
      teamLeavers[tid].push({ name: d.name, leaveReason: "contract expired" });
    }
  }

  // Step 6 — Budget and pace updates
  applyBudgetAndPaceUpdates(teams, constructorStandings);

  // Step 7 — Transfer window
  runTransferWindow(
    drivers,
    teams,
    freeAgents,
    simulationMode,
    signings,
    promotions,
    offSeasonNews,
    state.transfers || (state.transfers = []),
    teamLeavers
  );

  // Step 9 — Ordered news
  const orderedNews = buildOrderedOffSeasonNews(offSeasonNews);

  // Step 10 — Preview storylines
  const nextSeason = (state.currentSeason || 2026) + 1;
  state.currentSeason = nextSeason;
  const previewStorylines = generatePreviewStorylines(
    drivers,
    teams,
    signings,
    nextSeason
  );

  return {
    ...state,
    offSeasonNews: orderedNews,
    retirements,
    promotions,
    signings,
    firings,
    previewStorylines,
  };
}
