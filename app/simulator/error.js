"use client";

import { useEffect } from "react";

export default function SimulatorError({ error, reset }) {
  useEffect(() => {
    console.error("Simulator error:", error);
  }, [error]);

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center p-8"
      style={{ background: "#080812", color: "#fff", fontFamily: "'Titillium Web', sans-serif" }}
    >
      <h1 className="mb-4 text-xl font-bold" style={{ color: "#E10600" }}>
        Something went wrong
      </h1>
      <p className="mb-6 max-w-md text-center text-sm" style={{ color: "#888" }}>
        {error?.message || "An unexpected error occurred"}
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded px-4 py-2 text-sm font-semibold text-white"
        style={{ background: "#E10600" }}
      >
        Try again
      </button>
    </div>
  );
}
