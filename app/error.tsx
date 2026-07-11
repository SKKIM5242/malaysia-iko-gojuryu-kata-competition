"use client";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-24 text-center">
      <p className="text-6xl font-black text-neutral-300">Oops</p>
      <h1 className="mt-3 text-xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-neutral-500">
        An unexpected error occurred{error.digest ? ` (ref ${error.digest})` : ""}. Please try again.
      </p>
      <button
        onClick={reset}
        className="mt-6 rounded-md bg-red-700 px-5 py-2.5 font-semibold text-white hover:bg-red-600"
      >
        Try again
      </button>
    </main>
  );
}
