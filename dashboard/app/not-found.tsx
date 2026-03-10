import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center px-6 text-center">
      <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-4">
        404
      </p>
      <h1 className="text-3xl font-bold text-white mb-3">Page not found</h1>
      <p className="text-slate-400 max-w-sm mb-8">
        This route does not exist on the AgentPay exchange. Check the URL or navigate
        back to a known surface.
      </p>
      <div className="flex flex-wrap gap-3 justify-center">
        <Link
          href="/"
          className="bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:text-emerald-300 px-4 py-2 rounded-lg transition font-medium text-sm"
        >
          Home
        </Link>
        <Link
          href="/network"
          className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white px-4 py-2 rounded-lg transition text-sm"
        >
          Network
        </Link>
        <Link
          href="/build"
          className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white px-4 py-2 rounded-lg transition text-sm"
        >
          Build
        </Link>
      </div>
    </div>
  );
}
