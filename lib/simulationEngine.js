/**
 * F1 Season Simulation Engine
 * Simulates a complete F1 season with qualifying, race results, DNFs,
 * safety cars, upgrades, and narrative generation.
 * Pure JavaScript — no AI/LLM calls.
 */

// =============================================================================
// CONSTANTS
// =============================================================================

const STANDARD_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1];

const DNF_REASONS = [
  "Power unit",
  "Hydraulics",
  "Collision",
  "Brake failure",
  "Suspension",
  "Gearbox",
];

// =============================================================================
// RANDOM HELPERS
// =============================================================================

/**
 * Returns a random number between min and max (inclusive).
 */
function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * Returns a value with Gaussian-like variance around 1.
 * chaosLevel 1 = minimal variance, 10 = high variance.
 */
function varianceFactor(chaosLevel) {
  const spread = 0.02 + chaosLevel * 0.015;
  return 1 + randomBetween(-spread, spread);
}

/**
 * Roll a random value 0-1. Returns true if below threshold.
 */
function roll(probability) {
  return Math.random() < probability;
}

/**
 * Pick a random element from an array, with optional weights.
 */
function pickRandom(arr, weights = null) {
  if (!weights) {
    return arr[Math.floor(Math.random() * arr.length)];
  }
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < arr.length; i++) {
    r -= weights[i];
    if (r <= 0) return arr[i];
  }
  return arr[arr.length - 1];
}

// =============================================================================
// LOOKUP HELPERS
// =============================================================================

function getDriverById(drivers, id) {
  return drivers.find((d) => d.id === id);
}

function getTeamById(teams, id) {
  return teams.find((t) => t.id === id);
}

// =============================================================================
// UPGRADES
// =============================================================================

/**
 * Returns effective basePace for a team at given round.
 * Early: +upgradePotential from round 4
 * Mid: from round 10
 * Late: from round 17
 * None: no upgrade
 */
function getEffectiveBasePace(team, round, upgradesEnabled) {
  if (!upgradesEnabled) return team.basePace;

  const { upgradeSchedule, upgradePotential } = team;
  let activeFrom = Infinity;

  if (upgradeSchedule === "early") activeFrom = 4;
  else if (upgradeSchedule === "mid") activeFrom = 10;
  else if (upgradeSchedule === "late") activeFrom = 17;
  else return team.basePace;

  const bonus = round >= activeFrom ? upgradePotential : 0;
  return Math.min(99, team.basePace + bonus);
}

// =============================================================================
// WEATHER
// =============================================================================

/**
 * Determines race weather from probability distribution.
 * race.weatherProbability = { dry, mixed, wet } (percentages).
 * Override in config.races if provided.
 */
function determineWeather(race, racesConfig = null) {
  const prob = race.weatherProbability || { dry: 70, mixed: 25, wet: 5 };
  const r = Math.random() * 100;
  if (r < prob.dry) return "dry";
  if (r < prob.dry + prob.mixed) return "mixed";
  return "wet";
}

// =============================================================================
// QUALIFYING
// =============================================================================

/**
 * Calculates qualifying score for a driver.
 * baseScore = (team.basePace * teamWeight) + (driver.pace * driverWeight)
 * Street: driver weight 0.45, team 0.55
 * Power: team weight 0.75, driver 0.25
 * Default: team 0.65, driver 0.35
 */
function getQualifyingScore(driver, team, race, chaosLevel, effectiveBasePace) {
  const circuitType = race.circuitType || "balanced";
  let teamWeight = 0.65;
  let driverWeight = 0.35;

  if (circuitType === "street") {
    teamWeight = 0.55;
    driverWeight = 0.45;
  } else if (circuitType === "power") {
    teamWeight = 0.75;
    driverWeight = 0.25;
  }

  const baseScore =
    effectiveBasePace * teamWeight + driver.pace * driverWeight;
  return baseScore * varianceFactor(chaosLevel);
}

// =============================================================================
// RACE SCORE
// =============================================================================

/**
 * Calculates race performance score.
 * Dry: (team.basePace * 0.55) + (driver.pace * 0.25) + (driver.consistency * 0.20)
 * Wet: (driver.wetWeather * 0.4) + (team.basePace * 0.3) + (driver.pace * 0.15) + (driver.consistency * 0.15)
 */
function getRaceScore(driver, team, weather, chaosLevel, effectiveBasePace) {
  let baseScore;

  if (weather === "wet" || weather === "mixed") {
    baseScore =
      (driver.wetWeather || 70) * 0.4 +
      effectiveBasePace * 0.3 +
      driver.pace * 0.15 +
      driver.consistency * 0.15;
  } else {
    baseScore =
      effectiveBasePace * 0.55 +
      driver.pace * 0.25 +
      driver.consistency * 0.2;
  }

  return baseScore * varianceFactor(chaosLevel);
}

// =============================================================================
// DNF LOGIC
// =============================================================================

/**
 * Base DNF chance = (100 - reliability) / 100 * 0.15
 * Scaled by chaosLevel (1 = 0.5x, 10 = 1.5x approx)
 */
function getDnfChance(team, chaosLevel) {
  const baseChance = ((100 - team.reliability) / 100) * 0.15;
  const chaosMultiplier = 0.5 + chaosLevel * 0.1;
  return Math.min(0.35, baseChance * chaosMultiplier);
}

/**
 * Pick DNF reason. Collision more likely for high overtaking drivers.
 */
function getDnfReason(driver) {
  const overtaking = driver.overtaking || 80;
  const collisionWeight = Math.min(3, overtaking / 35);
  const weights = [1, 1, collisionWeight, 1, 1, 1];
  return pickRandom(DNF_REASONS, weights);
}

// =============================================================================
// SAFETY CAR
// =============================================================================

/**
 * Probability = safetyCarFrequency * 0.08
 */
function shouldDeploySafetyCar(safetyCarFrequency) {
  return roll((safetyCarFrequency || 5) * 0.08);
}

/**
 * Compress gaps between positions — some gain, some lose.
 * Simulates field compression and restart chaos.
 */
function applySafetyCarEffect(results, chaosLevel) {
  if (results.length <= 1) return results;

  const shuffled = [...results];
  const swapCount = Math.floor(2 + chaosLevel * 0.5);
  for (let i = 0; i < swapCount; i++) {
    const a = Math.floor(Math.random() * shuffled.length);
    let b = Math.floor(Math.random() * shuffled.length);
    if (a === b) b = (b + 1) % shuffled.length;
    [shuffled[a], shuffled[b]] = [shuffled[b], shuffled[a]];
  }

  return shuffled.map((r, i) => ({ ...r, position: i + 1 }));
}

// =============================================================================
// POINTS
// =============================================================================

/**
 * Standard F1 points. +1 for fastest lap if in top 10.
 * Sprint races use 8,7,6,5,4,3,2,1 for top 8.
 */
function getPoints(position, hasFastestLap, isSprint) {
  const pointsArray = isSprint ? SPRINT_POINTS : STANDARD_POINTS;
  const idx = position - 1;
  if (idx < 0 || idx >= pointsArray.length) return 0;
  let pts = pointsArray[idx];
  if (!isSprint && hasFastestLap && position <= 10) pts += 1;
  return pts;
}

// =============================================================================
// GAP CALCULATION
// =============================================================================

/**
 * Generate realistic gap string (e.g. "+5.234", "DNF", "+1 lap")
 */
function generateGap(position, totalFinishers, isDnf) {
  if (isDnf) return "DNF";
  if (position === 1) return "";
  if (position <= 3) {
    const base = 2 + Math.random() * 8;
    return `+${base.toFixed(3)}`;
  }
  if (position <= 10) {
    const base = 5 + (position - 3) * 3 + Math.random() * 5;
    return `+${base.toFixed(3)}`;
  }
  const lapsDown = position <= 15 ? 0 : Math.floor(Math.random() * 2) + 1;
  return lapsDown > 0 ? `+${lapsDown} lap${lapsDown > 1 ? "s" : ""}` : `+${(15 + position * 2 + Math.random() * 10).toFixed(3)}`;
}

// =============================================================================
// FOCUS DRIVER NOTE
// =============================================================================

/**
 * Generate a 1-sentence note about the focus driver's race.
 */
function generateFocusDriverNote(
  focusDriverId,
  qualifyingPosition,
  finalPosition,
  points,
  dnf,
  dnfReason,
  safetyCarDeployed,
  weather
) {
  const pos = (p) => (p === 1 ? "P1" : `P${p}`);
  const qPos = qualifyingPosition;
  const fPos = finalPosition;

  if (dnf) {
    const reason = dnfReason || "mechanical failure";
    return `Started ${pos(qPos)}, retired with ${reason}.`;
  }

  const improved = fPos < qPos;
  const declined = fPos > qPos;

  const parts = [];
  parts.push(`Started ${pos(qPos)}`);

  if (safetyCarDeployed && (improved || declined)) {
    parts.push(`safety car reshuffle`);
  }
  if (weather !== "dry" && (improved || declined)) {
    parts.push(`${weather} conditions`);
  }

  if (improved) {
    parts.push(`fought through to ${pos(fPos)}`);
  } else if (declined) {
    parts.push(`dropped to ${pos(fPos)}`);
  } else {
    parts.push(`finished ${pos(fPos)}`);
  }

  if (points > 0) {
    parts.push(`scoring ${points} points`);
  }

  return parts.join(", ") + ".";
}

// =============================================================================
// SEASON STORYLINES
// =============================================================================

/**
 * Scan results and generate 3-5 narrative storylines.
 */
function generateSeasonStorylines(
  races,
  driverStandings,
  constructorStandings,
  drivers,
  teams
) {
  const storylines = [];
  const driverMap = Object.fromEntries(drivers.map((d) => [d.id, d]));
  const teamMap = Object.fromEntries(teams.map((t) => [t.id, t]));

  // 1. Champion narrative
  if (driverStandings.length >= 1) {
    const champ = driverStandings[0];
    const wins = races.filter(
      (r) => r.results[0]?.driverId === champ.driverId
    ).length;
    const name = driverMap[champ.driverId]?.name || champ.driverId;
    if (wins >= 5) {
      storylines.push(
        `${name} dominated with ${wins} wins to claim the championship.`
      );
    } else if (wins >= 2) {
      storylines.push(
        `${name} took the title with ${wins} wins in a closely fought season.`
      );
    } else {
      storylines.push(
        `${name} won the championship with consistency over outright pace.`
      );
    }
  }

  // 2. DNF/reliability narrative
  const totalDnfs = races.reduce(
    (sum, r) => sum + (r.dnfs?.length || 0),
    0
  );
  const highDnfDriver = driverStandings.find((d) => d.dnfs >= 3);
  if (highDnfDriver && totalDnfs > 5) {
    const name = driverMap[highDnfDriver.driverId]?.name || highDnfDriver.driverId;
    const wins = races.filter(
      (r) => r.results[0]?.driverId === highDnfDriver.driverId
    ).length;
    if (wins >= 3) {
      storylines.push(
        `${name} won ${wins} races but ${highDnfDriver.dnfs} DNFs cost him the title.`
      );
    }
  }

  // 3. Rookie / surprise performer
  const topTen = driverStandings.slice(0, 10);
  const rookies = ["lindblad", "bortoleto", "colapinto"];
  const rookieInTopTen = topTen.find((d) => rookies.includes(d.driverId));
  if (rookieInTopTen) {
    const name = driverMap[rookieInTopTen.driverId]?.name || rookieInTopTen.driverId;
    const firstPoints = races.find((r) =>
      r.results.some(
        (res) =>
          res.driverId === rookieInTopTen.driverId &&
          res.points > 0 &&
          !res.dnf
      )
    );
    if (firstPoints) {
      storylines.push(
        `Rookie ${name} scored points and impressed with P${driverStandings.findIndex((d) => d.driverId === rookieInTopTen.driverId) + 1} in the standings.`
      );
    }
  }

  // 4. Constructor battle
  if (constructorStandings.length >= 2) {
    const first = constructorStandings[0];
    const second = constructorStandings[1];
    const gap = first.points - second.points;
    const firstName = teamMap[first.teamId]?.name || first.teamId;
    const secondName = teamMap[second.teamId]?.name || second.teamId;
    if (gap < 50) {
      storylines.push(
        `${firstName} pipped ${secondName} by ${gap} points in a tight constructors' fight.`
      );
    } else if (gap > 150) {
      storylines.push(
        `${firstName} ran away with the constructors' championship.`
      );
    }
  }

  // 5. Wet weather specialist
  const wetRaces = races.filter((r) => r.weather === "wet" || r.weather === "mixed");
  if (wetRaces.length >= 2) {
    const wetWinners = wetRaces.map((r) => r.results[0]?.driverId).filter(Boolean);
    const repeatWinner = wetWinners.find(
      (id, i) => wetWinners.indexOf(id) !== i
    );
    if (repeatWinner) {
      const name = driverMap[repeatWinner]?.name || repeatWinner;
      storylines.push(
        `${name} excelled in the wet, winning ${wetWinners.filter((w) => w === repeatWinner).length} of ${wetRaces.length} rain-affected races.`
      );
    }
  }

  // Ensure we have 3-5 storylines
  const filler = [
    "The new regulations shook up the established order.",
    "Strategy and tyre management proved decisive across the season.",
    "The midfield battle remained fiercely contested throughout.",
  ];
  while (storylines.length < 3) {
    storylines.push(filler[storylines.length % filler.length]);
  }
  return storylines.slice(0, 5);
}

// =============================================================================
// TYRE STINTS & POSITION CHECKPOINTS (for single-season mode)
// =============================================================================

/**
 * Total race laps: ~57 ±5 (varies by circuit type).
 */
function getTotalLaps(race) {
  const base = 57;
  const variance = 5;
  return base + Math.floor(randomBetween(-variance, variance));
}

/**
 * Estimate lap at which DNF occurred (for stints/checkpoints). Not stored in results.
 */
function estimateDnfLap(totalLaps, chaosLevel) {
  const spread = 0.3 + (chaosLevel || 5) * 0.05;
  const t = Math.random();
  if (t < 0.2) return Math.max(1, Math.floor(totalLaps * 0.1 * randomBetween(0.5, 1.5)));
  if (t < 0.5) return Math.floor(totalLaps * randomBetween(0.2, 0.45));
  return Math.floor(totalLaps * randomBetween(0.5, 0.95));
}

/**
 * Generate tyre stints per driver. Dry: soft/medium/hard. Wet: intermediate/wet.
 * Most 2 stops (3 stints). Chaos increases 1-stop and 3-stop probability.
 */
function generateTyreStints(
  qualifyingOrder,
  results,
  weather,
  totalLaps,
  chaosLevel,
  dnfLapByDriver
) {
  const isWet = weather === "wet" || weather === "mixed";
  const dryCompounds = ["soft", "medium", "hard"];
  const wetCompounds = ["intermediate", "wet"];
  const compounds = isWet ? wetCompounds : dryCompounds;

  const numStintsRoll = Math.random();
  let numStints = 3;
  if (chaosLevel >= 6 && numStintsRoll < 0.15) numStints = 2;
  else if (chaosLevel >= 4 && numStintsRoll < 0.25) numStints = 4;
  else if (numStintsRoll < 0.1) numStints = 2;

  const tyreStints = {};
  for (const r of results) {
    const driverId = r.driverId;
    const dnfLap = dnfLapByDriver[driverId];
    const effectiveLaps = dnfLap != null ? dnfLap : totalLaps;

    const stints = [];
    let remaining = effectiveLaps;
    const stintSizes = [];
    if (numStints === 2) {
      stintSizes.push(Math.max(1, Math.floor(effectiveLaps * 0.45)));
      stintSizes.push(Math.max(1, remaining - stintSizes[0]));
    } else {
      const base = Math.floor(effectiveLaps / numStints);
      for (let i = 0; i < numStints - 1; i++) stintSizes.push(base);
      stintSizes.push(Math.max(1, effectiveLaps - stintSizes.reduce((a, b) => a + b, 0)));
    }

    for (let s = 0; s < stintSizes.length && stintSizes[s] > 0; s++) {
      const laps = stintSizes[s];
      const isLast = s === stintSizes.length - 1;
      let compound;
      if (isWet) {
        compound = s === 0 && effectiveLaps > 20 ? "intermediate" : pickRandom(wetCompounds);
      } else {
        if (s === 0) compound = roll(0.65) ? "soft" : "medium";
        else if (isLast) compound = roll(0.7) ? "hard" : "medium";
        else compound = pickRandom(["soft", "medium", "hard"]);
      }
      stints.push({ compound, laps });
    }
    if (stints.length) tyreStints[driverId] = stints;
  }
  return tyreStints;
}

/**
 * Generate 20 position checkpoints. Start from qualifying, move toward final result.
 * Safety car compression at random checkpoint; DNF drops to last+1 at DNF checkpoint.
 */
function generatePositionCheckpoints(
  results,
  qualifyingOrder,
  totalLaps,
  safetyCarDeployed,
  chaosLevel,
  dnfLapByDriver
) {
  const numCheckpoints = 20;
  const positionsByDriver = {};
  const finalPositionByDriver = {};
  results.forEach((r) => { finalPositionByDriver[r.driverId] = r.position; });

  const totalDrivers = qualifyingOrder.length;
  const dnfDriverIds = new Set(results.filter((r) => r.dnf).map((r) => r.driverId));
  const safetyCarCheckpoint = safetyCarDeployed && totalDrivers > 1
    ? Math.floor(4 + Math.random() * (numCheckpoints - 8))
    : -1;

  for (const driverId of qualifyingOrder) {
    const qualPos = qualifyingOrder.indexOf(driverId) + 1;
    const finalPos = finalPositionByDriver[driverId] ?? totalDrivers + 1;
    const dnfLap = dnfLapByDriver[driverId];
    const dnfCheckpoint = dnfLap != null
      ? Math.min(numCheckpoints - 1, Math.max(0, Math.floor((dnfLap / totalLaps) * numCheckpoints)))
      : -1;

    const checkpoints = [];
    for (let c = 0; c < numCheckpoints; c++) {
      let pos;
      if (dnfCheckpoint >= 0 && c >= dnfCheckpoint) {
        pos = totalDrivers + 1;
      } else {
        const t = c / (numCheckpoints - 1);
        const progress = t * t;
        pos = Math.round(qualPos + (finalPos - qualPos) * progress);
        if (c === safetyCarCheckpoint && safetyCarDeployed) {
          pos = Math.max(1, Math.min(totalDrivers, pos + Math.floor((Math.random() - 0.5) * 4)));
        }
        const wobble = chaosLevel ? Math.floor((Math.random() - 0.5) * 4) : 0;
        pos = Math.max(1, Math.min(totalDrivers, pos + wobble));
      }
      checkpoints.push(pos);
    }
    if (finalPositionByDriver[driverId] != null) {
      checkpoints[numCheckpoints - 1] = finalPositionByDriver[driverId];
    }
    positionsByDriver[driverId] = checkpoints;
  }
  return positionsByDriver;
}

/**
 * Overtake count = qualifying position - race position (min 0). Exclude DNFs for biggest mover.
 */
function computeOvertakeAndMovers(results, qualifyingOrder) {
  const overtakeCount = {};
  for (const r of results) {
    const qualPos = qualifyingOrder.indexOf(r.driverId) + 1;
    const gained = qualPos - r.position;
    overtakeCount[r.driverId] = Math.max(0, gained);
  }
  const finishers = results.filter((r) => !r.dnf);
  const biggestMover = finishers.length === 0
    ? null
    : finishers.reduce((best, r) => {
        const gained = overtakeCount[r.driverId] || 0;
        const bestGained = overtakeCount[best?.driverId] || 0;
        if (gained > bestGained) return r;
        if (gained === bestGained && r.position < (best?.position ?? 99)) return r;
        return best;
      }, finishers[0])?.driverId ?? null;
  const driverOfDay = biggestMover;
  return { overtakeCount, biggestMover, driverOfDay };
}

// =============================================================================
// SINGLE RACE SIMULATION
// =============================================================================

function simulateRace(
  race,
  round,
  drivers,
  teams,
  config
) {
  const {
    chaosLevel = 5,
    safetyCarFrequency = 5,
    upgradesEnabled = true,
    focusDriverId,
  } = config;

  const teamMap = Object.fromEntries(teams.map((t) => [t.id, t]));
  const isSprint = race.isSprint || false;

  // 1. Determine weather
  const weatherOverride = race.weather;
  const weather = weatherOverride || determineWeather(race);

  // 2. Build driver entries with their teams
  const entries = drivers.map((d) => ({
    driver: d,
    team: teamMap[d.teamId] || teamMap[teams[0]?.id],
  }));

  // 3. Qualifying
  const qualifyingScores = entries.map(({ driver, team }) => {
    const effectiveBasePace = getEffectiveBasePace(
      team,
      round,
      upgradesEnabled
    );
    const score = getQualifyingScore(
      driver,
      team,
      race,
      chaosLevel,
      effectiveBasePace
    );
    return { driverId: driver.id, teamId: driver.teamId, score };
  });
  qualifyingScores.sort((a, b) => b.score - a.score);
  const qualifyingOrder = qualifyingScores.map((e) => e.driverId);

  // 4. Race scores (determines natural order before DNFs)
  const raceScores = entries.map(({ driver, team }) => {
    const effectiveBasePace = getEffectiveBasePace(
      team,
      round,
      upgradesEnabled
    );
    const score = getRaceScore(
      driver,
      team,
      weather,
      chaosLevel,
      effectiveBasePace
    );
    return { driverId: driver.id, teamId: driver.teamId, score, driver, team };
  });
  raceScores.sort((a, b) => b.score - a.score);

  // 5. DNF rolls
  const dnfs = [];
  const survivors = [];
  for (const entry of raceScores) {
    const team = teamMap[entry.teamId];
    const dnfChance = getDnfChance(team, chaosLevel);
    if (roll(dnfChance)) {
      const reason = getDnfReason(entry.driver);
      dnfs.push({
        driverId: entry.driverId,
        teamId: entry.teamId,
        reason,
      });
    } else {
      survivors.push(entry);
    }
  }

  // 6. Build results (survivors in race order)
  const results = survivors.map((entry, idx) => {
    const position = idx + 1;
    const points = getPoints(position, false, isSprint);
    const gap = generateGap(position, survivors.length, false);
    return {
      position,
      driverId: entry.driverId,
      teamId: entry.teamId,
      points,
      fastestLap: false,
      dnf: false,
      dnfReason: null,
      gap,
    };
  });

  // 7. Fastest lap (top 10 finisher, favour faster drivers)
  if (results.length >= 1) {
    const topTen = results.slice(0, Math.min(10, results.length));
    const weights = topTen.map((_, i) => 10 - i);
    const flIdx = Math.floor(
      Math.random() * Math.min(3, topTen.length)
    );
    const flEntry = topTen[flIdx];
    flEntry.fastestLap = true;
    flEntry.points = getPoints(flEntry.position, true, isSprint);
  }

  // 8. Add DNFs to results
  for (const dnf of dnfs) {
    results.push({
      position: results.length + 1,
      driverId: dnf.driverId,
      teamId: dnf.teamId,
      points: 0,
      fastestLap: false,
      dnf: true,
      dnfReason: dnf.reason,
      gap: "DNF",
    });
  }
  results.sort((a, b) => a.position - b.position);

  // 9. Safety car
  let safetyCarDeployed = shouldDeploySafetyCar(safetyCarFrequency);
  if (safetyCarDeployed && results.length > 1) {
    const finishers = results.filter((r) => !r.dnf);
    const compressed = applySafetyCarEffect(finishers, chaosLevel);
    const dnfResults = results.filter((r) => r.dnf);
    const merged = [...compressed, ...dnfResults];
    merged.sort((a, b) => a.position - b.position);
    for (let i = 0; i < merged.length; i++) {
      results[i] = { ...merged[i], position: i + 1 };
      if (!results[i].dnf) {
        results[i].points = getPoints(
          i + 1,
          results[i].fastestLap,
          isSprint
        );
      }
    }
  }

  // 10. Re-assign positions and gaps
  let pos = 1;
  for (const r of results) {
    r.position = pos++;
    if (!r.dnf) r.gap = generateGap(r.position, results.filter((x) => !x.dnf).length, false);
  }

  // 11. Focus driver
  const focusDriverPosition = focusDriverId
    ? results.find((r) => r.driverId === focusDriverId)?.position ?? null
    : null;
  const focusDriverResult = results.find((r) => r.driverId === focusDriverId);
  const qualPos = focusDriverId
    ? qualifyingOrder.indexOf(focusDriverId) + 1
    : null;
  const focusDriverNote = focusDriverId
    ? generateFocusDriverNote(
        focusDriverId,
        qualPos,
        focusDriverPosition,
        focusDriverResult?.points ?? 0,
        focusDriverResult?.dnf ?? false,
        focusDriverResult?.dnfReason,
        safetyCarDeployed,
        weather
      )
    : "";

  const totalLaps = getTotalLaps(race);
  const dnfLapByDriver = {};
  results.filter((r) => r.dnf).forEach((r) => {
    dnfLapByDriver[r.driverId] = estimateDnfLap(totalLaps, chaosLevel);
  });

  const tyreStints = generateTyreStints(
    qualifyingOrder,
    results,
    weather,
    totalLaps,
    chaosLevel,
    dnfLapByDriver
  );
  const positionCheckpoints = generatePositionCheckpoints(
    results,
    qualifyingOrder,
    totalLaps,
    safetyCarDeployed,
    chaosLevel,
    dnfLapByDriver
  );
  const { overtakeCount, biggestMover, driverOfDay } = computeOvertakeAndMovers(
    results,
    qualifyingOrder
  );

  return {
    round: race.round,
    raceName: race.name,
    session: isSprint ? "sprint" : "gp",
    isSprint,
    weather,
    safetyCarDeployed,
    results,
    dnfs,
    qualifyingOrder,
    tyreStints,
    positionCheckpoints,
    overtakeCount,
    biggestMover,
    driverOfDay,
    totalLaps,
    polePosition: qualifyingOrder[0] || null,
    fastestLap: results.find((r) => r.fastestLap)?.driverId ?? null,
    focusDriverPosition,
    focusDriverNote,
  };
}

// =============================================================================
// STANDINGS ACCUMULATION
// =============================================================================

function buildDriverStandings(races, drivers) {
  const points = {};
  const dnfs = {};
  drivers.forEach((d) => {
    points[d.id] = 0;
    dnfs[d.id] = 0;
  });

  for (const race of races) {
    for (const r of race.results) {
      points[r.driverId] = (points[r.driverId] || 0) + r.points;
      if (r.dnf) dnfs[r.driverId] = (dnfs[r.driverId] || 0) + 1;
    }
  }

  return drivers
    .map((d) => ({
      driverId: d.id,
      teamId: d.teamId,
      points: points[d.id] || 0,
      dnfs: dnfs[d.id] || 0,
    }))
    .sort((a, b) => b.points - a.points);
}

function buildConstructorStandings(races, teams) {
  const points = {};
  teams.forEach((t) => (points[t.id] = 0));

  for (const race of races) {
    for (const r of race.results) {
      if (!r.dnf) points[r.teamId] = (points[r.teamId] || 0) + r.points;
    }
  }

  return teams
    .map((t) => ({
      teamId: t.id,
      points: points[t.id] || 0,
    }))
    .sort((a, b) => b.points - a.points);
}

// =============================================================================
// MAIN EXPORT
// =============================================================================

/**
 * Simulates a single race. Exported for single-season mode (race-by-race reveal).
 * @returns {Object} Race result with results, qualifyingOrder, tyreStints, positionCheckpoints, overtakeCount, biggestMover, driverOfDay, etc.
 */
export function simulateSingleRace(race, round, drivers, teams, config) {
  return simulateRace(race, round, drivers, teams, config);
}

/**
 * Simulates an entire F1 season.
 *
 * @param {Object} config
 * @param {Array} config.drivers - Full driver array
 * @param {Array} config.teams - Full team array
 * @param {Array} config.races - Full race array (or subset)
 * @param {string} config.focusDriverId - Driver for extra commentary
 * @param {number} config.chaosLevel - 1-10, random variance
 * @param {number} config.safetyCarFrequency - 1-10
 * @param {boolean} config.upgradesEnabled
 * @param {number} config.seasonLength - 1-24 races to simulate
 *
 * @returns {Object} { races, driverStandings, constructorStandings, seasonStorylines }
 */
export function simulateSeason(config) {
  const {
    drivers = [],
    teams = [],
    races = [],
    focusDriverId = null,
    chaosLevel = 5,
    safetyCarFrequency = 5,
    upgradesEnabled = true,
    seasonLength = 24,
  } = config;

  const racesToSimulate = races.slice(0, Math.min(seasonLength, races.length));
  const results = [];

  for (let i = 0; i < racesToSimulate.length; i++) {
    const race = racesToSimulate[i];
    const round = i + 1;
    const raceConfig = {
      chaosLevel,
      safetyCarFrequency,
      upgradesEnabled,
      focusDriverId,
    };

    if (race.isSprint) {
      // Sprint weekend: simulate sprint first (sprint points), then full GP (full points)
      const sprintResult = simulateRace(race, round, drivers, teams, raceConfig);
      sprintResult.raceName = (race.name || sprintResult.raceName) + " (Sprint)";
      sprintResult.session = "sprint";
      results.push(sprintResult);

      const gpRace = { ...race, isSprint: false };
      const gpResult = simulateRace(gpRace, round, drivers, teams, raceConfig);
      gpResult.session = "gp";
      results.push(gpResult);
    } else {
      const raceResult = simulateRace(race, round, drivers, teams, raceConfig);
      raceResult.session = "gp";
      results.push(raceResult);
    }
  }

  const driverStandings = buildDriverStandings(results, drivers);
  const constructorStandings = buildConstructorStandings(results, teams);
  const seasonStorylines = generateSeasonStorylines(
    results,
    driverStandings,
    constructorStandings,
    drivers,
    teams
  );

  return {
    races: results,
    driverStandings,
    constructorStandings,
    seasonStorylines,
  };
}
