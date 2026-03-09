const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-haiku-4-5-20251001";

function fallbackCommentary(raceName, season, winnerName) {
  return `${raceName} ${season} delivered another chapter of the season. ${winnerName || "The winner"} took the chequered flag after a competitive race. The result shakes up the championship order as the calendar moves on.`;
}

function buildUserMessage(body) {
  const {
    raceResult,
    qualifyingOrder = [],
    season,
    round,
    totalRounds = 24,
    driverStandings = [],
    constructorStandings = [],
    previousRaceWinner,
    focusDriverId,
    drivers = [],
    teams = [],
  } = body;

  const getDriver = (id) => drivers.find((d) => d.id === id);
  const getTeam = (id) => teams.find((t) => t.id === id);
  const raceName = raceResult?.name ?? raceResult?.raceName ?? `Round ${round}`;

  const top5Quali = qualifyingOrder.slice(0, 5).map((id, i) => `${i + 1}. ${getDriver(id)?.name ?? id}`).join(", ") || "—";
  const winner = raceResult?.results?.[0];
  const winnerName = winner ? getDriver(winner.driverId)?.name : null;
  const winnerTeam = winner ? getTeam(winner.teamId)?.name : null;
  const qualiPosWinner = winner ? qualifyingOrder.indexOf(winner.driverId) + 1 : "—";
  const podium = (raceResult?.results ?? []).slice(0, 3).map((r) => getDriver(r.driverId)?.name ?? r.driverId).join(", ") || "—";
  const top10 = (raceResult?.results ?? []).slice(0, 10).map((r, i) => `${i + 1}. ${getDriver(r.driverId)?.name ?? r.driverId} (${getTeam(r.teamId)?.name ?? ""})`).join("; ") || "—";
  const dnfs = (raceResult?.results ?? []).filter((r) => r.dnf).map((r) => `${getDriver(r.driverId)?.name ?? r.driverId}${r.dnfReason ? ` (${r.dnfReason})` : ""}).join("; ") || "None";
  const weather = (raceResult?.weather ?? "dry").charAt(0).toUpperCase() + (raceResult?.weather ?? "dry").slice(1);
  const safetyCar = raceResult?.safetyCarDeployed ? "yes" : "no";

  const biggestMoverId = raceResult?.biggestMover;
  const biggestMoverName = biggestMoverId ? getDriver(biggestMoverId)?.name : "—";
  const overtakeCount = raceResult?.overtakeCount ?? {};
  const biggestMoverGain = biggestMoverId ? (overtakeCount[biggestMoverId] ?? 0) : 0;

  const driverOfDayId = raceResult?.driverOfDay ?? biggestMoverId;
  const driverOfDayName = driverOfDayId ? getDriver(driverOfDayId)?.name : "—";

  const focusResult = focusDriverId ? (raceResult?.results ?? []).find((r) => r.driverId === focusDriverId) : null;
  const focusName = focusDriverId ? getDriver(focusDriverId)?.name : "—";
  const focusQualiPos = focusDriverId ? qualifyingOrder.indexOf(focusDriverId) + 1 : "—";
  const focusFinishPos = focusResult?.position ?? "—";

  const leader = driverStandings[0];
  const leaderName = leader ? getDriver(leader.driverId)?.name : "—";
  const leaderPts = leader?.points ?? 0;
  const p2 = driverStandings[1];
  const p2Name = p2 ? getDriver(p2.driverId)?.name : "—";
  const p2Pts = p2?.points ?? 0;

  return `Write a race report for the ${raceName}, Round ${round} of ${totalRounds}, ${season} season.

Qualifying: ${top5Quali}
Race winner: ${winnerName ?? "—"} (${winnerTeam ?? "—"}) from P${qualiPosWinner}
Podium: P1 ${(raceResult?.results ?? [])[0] ? getDriver(raceResult.results[0].driverId)?.name : "—"}, P2 ${(raceResult?.results ?? [])[1] ? getDriver(raceResult.results[1].driverId)?.name : "—"}, P3 ${(raceResult?.results ?? [])[2] ? getDriver(raceResult.results[2].driverId)?.name : "—"}
Top 10: ${top10}
DNFs: ${dnfs}
Weather: ${weather}
Safety car: ${safetyCar}
Biggest mover: ${biggestMoverName} (+${biggestMoverGain} positions)
Driver of the day: ${driverOfDayName}
Focus driver ${focusName}: started P${focusQualiPos}, finished P${focusFinishPos}
Championship after round ${round}: ${leaderName} leads on ${leaderPts}pts, ${p2Name} on ${p2Pts}pts

Write exactly 2 paragraphs, max 180 words total.`;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ commentary: fallbackCommentary("Race", new Date().getFullYear(), null) }, { status: 200 });
  }

  const systemPrompt =
    "You are an F1 race commentator writing for a simulator app in the style of Sky Sports F1. Be dramatic, specific, and engaging. Reference real F1 storytelling tropes. Always mention the race winner, key battles, and championship implications.";

  const userContent = buildUserMessage(body);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const raceName = body.raceResult?.name ?? body.raceResult?.raceName ?? `Round ${body.round ?? "?"}`;
    const winner = body.raceResult?.results?.[0];
    const drivers = body.drivers ?? [];
    const winnerName = winner ? drivers.find((d) => d.id === winner.driverId)?.name : null;
    return Response.json({
      commentary: fallbackCommentary(raceName, body.season ?? new Date().getFullYear(), winnerName),
    }, { status: 200 });
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!res.ok) {
      const raceName = body.raceResult?.name ?? body.raceResult?.raceName ?? "Race";
      const winner = body.raceResult?.results?.[0];
      const drivers = body.drivers ?? [];
      const winnerName = winner ? drivers.find((d) => d.id === winner.driverId)?.name : null;
      return Response.json({
        commentary: fallbackCommentary(raceName, body.season ?? new Date().getFullYear(), winnerName),
      }, { status: 200 });
    }

    const data = await res.json();
    const text = data.content?.find((c) => c.type === "text")?.text;
    const commentary =
      typeof text === "string" && text.trim()
        ? text.trim()
        : fallbackCommentary(
            body.raceResult?.name ?? body.raceResult?.raceName ?? "Race",
            body.season ?? new Date().getFullYear(),
            body.drivers?.find((d) => d.id === body.raceResult?.results?.[0]?.driverId)?.name
          );

    return Response.json({ commentary });
  } catch (err) {
    const raceName = body?.raceResult?.name ?? body?.raceResult?.raceName ?? "Race";
    const season = body?.season ?? new Date().getFullYear();
    const winner = body?.raceResult?.results?.[0];
    const winnerName = winner && body?.drivers ? body.drivers.find((d) => d.id === winner.driverId)?.name : null;
    return Response.json({
      commentary: fallbackCommentary(raceName, season, winnerName),
    }, { status: 200 });
  }
}
