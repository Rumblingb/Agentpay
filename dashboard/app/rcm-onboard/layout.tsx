export default function RcmOnboardLayout({ children }: { children: React.ReactNode }) {
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
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes stepSlide {
          from { opacity: 0; transform: translateX(16px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .ace-pulse  { animation: ace-pulse 1.4s ease-in-out infinite; }
        .wave-bar   { animation: waveBar 0.9s ease-in-out infinite; transform-origin: bottom; }
        .fade-up    { animation: fadeUp 0.4s cubic-bezier(0.25,0.46,0.45,0.94) both; }
        .step-slide { animation: stepSlide 0.2s cubic-bezier(0.25,0.46,0.45,0.94) both; }
        .spin       { animation: spin 0.8s linear infinite; }
      `}</style>
      {children}
    </>
  );
}
