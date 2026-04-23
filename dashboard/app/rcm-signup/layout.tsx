export default function RcmSignupLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{`
        @keyframes ace-pulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.45); }
          50%      { box-shadow: 0 0 0 14px rgba(16,185,129,0); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .fade-up { animation: fadeUp 0.35s cubic-bezier(0.25,0.46,0.45,0.94) both; }
        .spin     { animation: spin 0.8s linear infinite; }
      `}</style>
      {children}
    </>
  );
}
