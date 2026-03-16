export default function DesignSystem() {
  return (
    <style>{`
      :root{
        --bg: #050607;
        --panel-bg: #071017;
        --panel-border: #1B2630;
        --muted: #9AA4AF;
        --fg: #F5F7FA;
        --accent: #22C55E;
        --glass-radius: 12px;
        --space-1: 8px;
        --space-2: 12px;
        --space-3: 18px;
      }

      /* Base tokens + small utility resets for consistent look */
      html,body{background:var(--bg);color:var(--fg);font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,'Helvetica Neue',Arial}

      .heading-xl{font-size:34px;font-weight:900;color:var(--fg);margin:0}
      .heading-lg{font-size:18px;font-weight:700;color:var(--fg);margin:0}
      .text-body{color:var(--muted);font-size:15px}

      .panel-glass{background:var(--panel-bg);border:1px solid var(--panel-border);border-radius:var(--glass-radius);padding:var(--space-2)}
      .panel-ledger{background:var(--panel-bg);border:1px solid var(--panel-border);border-radius:10px}

      .btn-primary{background:var(--accent);color:#050607;padding:10px 14px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-flex;align-items:center;gap:8px}
      .btn-link{color:var(--muted);text-decoration:none}

      /* Header compact indicator */
      .preview-indicator { display:flex; align-items:center; gap:8px; color:var(--muted); font-size:12px }
      .preview-indicator .dot{ width:8px; height:8px; border-radius:50%; background:var(--accent); box-shadow:0 0 8px rgba(34,197,94,0.18); }

      /* Small layout helpers */
      .content-wrap{max-width:1200px;margin:18px auto;padding:0 20px}
      .heading-strip{max-width:1200px;margin:48px auto;padding:0 20px}

      /* Make small text colors consistent */
      .text-muted{color:var(--muted)}

      @media (max-width:640px){
        .hero-title{ max-width:18ch; margin-left:auto; margin-right:auto; }
        .home-top-strip{display:none !important}
      }
    `}</style>
  );
}
