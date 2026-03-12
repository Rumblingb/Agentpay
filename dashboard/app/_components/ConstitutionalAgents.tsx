'use client';

const AGENTS = ['TrustOracle', 'SettlementGuardian', 'IdentityVerifier', 'NetworkObserver'];

export default function ConstitutionalAgents() {
  return (
    <section className="constitutional">
      <h2 className="text-sm text-neutral-300 font-medium mb-3">CONSTITUTIONAL AGENTS</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {AGENTS.map((a) => (
          <div key={a} className="institution-card p-6 rounded-lg border border-[#1c1c1c] bg-[#050505]/50 text-center text-sm font-semibold text-neutral-200">
            <div className="mb-2 text-2xl text-emerald-400">{a}</div>
            <div className="text-xs text-neutral-500">System Guardian</div>
          </div>
        ))}
      </div>
    </section>
  );
}
