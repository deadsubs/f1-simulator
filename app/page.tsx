import Link from "next/link";

const F1_RED = "#E10600";
const BG_DARK = "#080812";
const PANEL_BG = "#0d0d1a";

export default function HomePage() {
  return (
    <div className="min-h-screen text-white flex flex-col items-center justify-center px-6" style={{ background: BG_DARK }}>
      <div className="max-w-3xl w-full">
        <div className="text-center mb-16">
          <h1 className="text-5xl font-black uppercase tracking-widest" style={{ fontFamily: "Titillium Web, sans-serif" }}>
            Jake's <span style={{ color: F1_RED }}>Tools</span>
          </h1>
          <p className="mt-3 text-white/50 text-lg">A collection of fun interactive tools</p>
          <div className="mt-4 h-px w-16 mx-auto" style={{ background: F1_RED }} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Single Season */}
          <Link href="/single-season" className="group block">
            <div
              className="rounded-xl p-8 border transition-all duration-200 group-hover:scale-[1.02]"
              style={{
                background: PANEL_BG,
                borderColor: F1_RED,
                boxShadow: `0 0 24px rgba(225,6,0,0.15)`,
              }}
            >
              <div className="text-3xl mb-4">🏎️</div>
              <h2 className="text-xl font-black uppercase tracking-wider mb-2" style={{ fontFamily: "Titillium Web, sans-serif" }}>
                Single Season
              </h2>
              <p className="text-white/60 text-sm mb-6">
                Follow the 2026 F1 season race by race. Commentary, tyre strategy, lap charts and more.
              </p>
              <div
                className="inline-block px-4 py-2 rounded text-sm font-bold uppercase tracking-wider text-white"
                style={{ background: F1_RED }}
              >
                Launch Tool →
              </div>
            </div>
          </Link>

          {/* Franchise Mode */}
          <Link href="/simulator" className="group block">
            <div
              className="rounded-xl p-8 border transition-all duration-200 group-hover:scale-[1.02]"
              style={{
                background: PANEL_BG,
                borderColor: "#3671C6",
                boxShadow: `0 0 24px rgba(54,113,198,0.15)`,
              }}
            >
              <div className="text-3xl mb-4">🏆</div>
              <h2 className="text-xl font-black uppercase tracking-wider mb-2" style={{ fontFamily: "Titillium Web, sans-serif" }}>
                Franchise Mode
              </h2>
              <p className="text-white/60 text-sm mb-6">
                Simulate a decade of Formula 1. Transfers, retirements, rookies and championship battles across 10 seasons.
              </p>
              <div
                className="inline-block px-4 py-2 rounded text-sm font-bold uppercase tracking-wider text-white"
                style={{ background: "#3671C6" }}
              >
                Launch Tool →
              </div>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}