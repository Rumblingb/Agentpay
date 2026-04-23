export const metadata = { title: 'Ace for Billing Offices' };

export default function BillingLandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{`
        @keyframes ace-pulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.45); }
          50%      { box-shadow: 0 0 0 14px rgba(16,185,129,0); }
        }
        @keyframes waveBar {
          0%,100% { transform: scaleY(0.25); opacity: 0.4; }
          50%     { transform: scaleY(1); opacity: 1; }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .ace-pulse { animation: ace-pulse 1.4s ease-in-out infinite; }
        .wave-bar  { animation: waveBar 0.9s ease-in-out infinite; transform-origin: bottom; }
        .fade-up   { animation: fadeUp 0.4s cubic-bezier(0.25,0.46,0.45,0.94) both; }
      `}</style>
      {children}
    </>
  );
}
