const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-haiku-4-5-20251001";

function fallbackRadio(driverName, isWin, isDNF) {
  if (isWin) return "Yes! Yes! We did it! Unbelievable.";
  if (isDNF) return "Something's broken. I'm pulling over.";
  return "Good race. We'll review the data and come back stronger.";
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ radio: fallbackRadio("Driver", false, false) }, { status: 200 });
  }

  const {
    driverName = "Driver",
    teamName = "Team",
    position,
    raceName = "the Grand Prix",
    isWin = false,
    isDNF = false,
    isFocusDriver = false,
    season = new Date().getFullYear(),
  } = body;

  const outcome = isWin ? "winning" : isDNF ? "retiring with DNF" : `finishing P${position ?? "?"}`;
  const userContent = `Write a team radio message from ${driverName} to their pit wall after ${outcome} at the ${raceName} ${season}. Just the driver's words, no attribution.`;

  const systemPrompt =
    "You write realistic F1 team radio messages. Keep them under 25 words. Sound authentic — clipped, emotional, real. No hashtags or emojis.";

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ radio: fallbackRadio(driverName, isWin, isDNF) }, { status: 200 });
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
        max_tokens: 128,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!res.ok) {
      return Response.json({ radio: fallbackRadio(driverName, isWin, isDNF) }, { status: 200 });
    }

    const data = await res.json();
    const text = data.content?.find((c) => c.type === "text")?.text;
    const radio =
      typeof text === "string" && text.trim() ? text.trim() : fallbackRadio(driverName, isWin, isDNF);

    return Response.json({ radio });
  } catch (err) {
    return Response.json({ radio: fallbackRadio(driverName, isWin, isDNF) }, { status: 200 });
  }
}
