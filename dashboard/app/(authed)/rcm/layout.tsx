export default function RcmLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{`
        @keyframes ace-pulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.45); }
          50%      { box-shadow: 0 0 0 14px rgba(16,185,129,0); }
        }
      `}</style>
      {children}
    </>
  );
}
