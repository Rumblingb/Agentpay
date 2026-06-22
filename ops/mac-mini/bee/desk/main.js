// Bee desktop companion — transparent always-on-top butterfly whose state mirrors the live fleet board.
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, shell } = require('electron');
const { execFileSync, spawn } = require('child_process');
const { homedir } = require('os');
const { join } = require('path');
const { readFileSync, writeFileSync } = require('fs');

const DB = process.env.BEE_DB || join(homedir(), '.bee', 'labs-board.db');
const BEE = join(__dirname, '..', 'bee.mjs');
const POINTER_FILE = join(homedir(), '.bee', 'pointer.json');
const DESK_STATE = join(homedir(), '.bee', 'desk-window.json'); // remembers where you parked Bee
const COLLAPSED = { w: 220, h: 220 };   // just the creature
const EXPANDED = { w: 344, h: 600 };    // creature + the status card above it (height auto-fits content, capped here)
let win, ptrWin, tray, lastDone = 0, flightUntil = 0, saveTimer;

function q(sql) { try { return execFileSync('sqlite3', [DB, sql], { encoding: 'utf8' }).trim(); } catch { return ''; } }
function counts() {
  const g = (s) => parseInt(q(`SELECT count(*) FROM tasks WHERE ${s};`) || '0', 10) || 0;
  return {
    inProgress: g("status='in_progress'"),
    routed: g("status='routed'"),
    needsHuman: g("needs_human=1 AND status!='done'"),
    done: g("status='done'"),
  };
}
function approvals() {
  const out = q(`SELECT lane||'|'||substr(title,1,60) FROM tasks WHERE needs_human=1 AND status!='done' ORDER BY created_at LIMIT 6;`);
  return out ? out.split('\n').map((l) => { const [lane, ...t] = l.split('|'); return { lane, title: t.join('|') }; }) : [];
}
// Bee's state IS the butterfly's life-cycle — the metamorphosis carries the meaning (calm-tech: no alert badges).
function deriveState(c) {
  const now = Date.now();
  if (c.done > lastDone) { flightUntil = now + 6500; lastDone = c.done; } // a task just shipped → emerge + fly
  if (c.needsHuman > 0) return 'landed';           // needs you — Bee alights, warm + patient (never a red dot)
  if (now < flightUntil) return 'flight';          // just shipped — the emerged butterfly, brief & bright
  if (c.inProgress > 0) return 'cocoon';           // deep work — recedes, dims, melts into the background
  if (c.routed > 0) return 'larva';                // queued & building — potential, not yet moving
  return 'egg';                                    // dormant — the calmest, quietest presence
}
function tick() {
  if (!win) return;
  const c = counts();
  win.webContents.send('state', { state: deriveState(c), counts: c, approvals: approvals() });
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const W = 220, H = 220;
  // restore where the founder parked Bee last time; default to the bottom-right perch
  let pos = { x: workArea.x + workArea.width - W - 24, y: workArea.y + workArea.height - H - 24 };
  try { const s = JSON.parse(readFileSync(DESK_STATE, 'utf8')); if (Number.isFinite(s.x) && Number.isFinite(s.y)) pos = { x: s.x, y: s.y }; } catch {}
  win = new BrowserWindow({
    width: W, height: H, x: pos.x, y: pos.y,
    frame: false, transparent: true, resizable: false, movable: true,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, fullscreenable: false,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(join(__dirname, 'renderer.html'));
  win.webContents.on('did-finish-load', tick);
  // Bee can perch anywhere — remember the spot (debounced; save the collapsed top-left, not an expanded card)
  const remember = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return; const b = win.getBounds();
    try { writeFileSync(DESK_STATE, JSON.stringify({ x: b.x, y: b.y + b.height - H })); } catch {}
  }, 600); };
  win.on('moved', remember);
}

function createPointerWindow() {                       // Clicky's own pointer — full-screen, transparent, click-through
  const { bounds } = screen.getPrimaryDisplay();
  ptrWin = new BrowserWindow({
    x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
    frame: false, transparent: true, resizable: false, movable: false, focusable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, fullscreenable: false, enableLargerThanScreen: true,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true },
  });
  ptrWin.setAlwaysOnTop(true, 'screen-saver');
  ptrWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  ptrWin.setIgnoreMouseEvents(true, { forward: true }); // never steals clicks
  ptrWin.loadFile(join(__dirname, 'pointer.html'));
}
function pointerTick() {                               // poll ~/.bee/pointer.json → drive the overlay
  if (!ptrWin) return;
  let p = null; try { p = JSON.parse(readFileSync(POINTER_FILE, 'utf8')); } catch {}
  const active = p && p.until && (Date.now() / 1000) < p.until;
  if (!active) { ptrWin.webContents.send('pointer', { active: false }); return; }
  const b = screen.getPrimaryDisplay().bounds;
  if (p.ride) {                                        // Clicky OWNS the cursor: the butterfly rides the live pointer
    const c = screen.getCursorScreenPoint();
    ptrWin.webContents.send('pointer', { active: true, ride: true, x: c.x - b.x, y: c.y - b.y, label: p.label || '' });
  } else {                                             // spotlight a fixed coordinate (point-at mode)
    ptrWin.webContents.send('pointer', { active: true, ride: false, x: p.x - b.x, y: p.y - b.y, label: p.label || '' });
  }
}

// Grow/shrink the window around a FIXED bottom-right corner so the creature never moves —
// the card unfurls upward + leftward from the butterfly, like a popover anchored to it.
ipcMain.on('panel-resize', (_e, arg) => {
  if (!win) return;
  const open = arg && arg.open;
  const b = win.getBounds();
  const right = b.x + b.width, bottom = b.y + b.height;
  const w = open ? EXPANDED.w : COLLAPSED.w;
  const h = open ? Math.min(EXPANDED.h, Math.max(COLLAPSED.h, arg.h || EXPANDED.h)) : COLLAPSED.h;
  const { workArea } = screen.getPrimaryDisplay();
  const y = Math.max(workArea.y + 8, bottom - h); // don't run off the top of the screen
  win.setBounds({ x: right - w, y, width: w, height: h });
});

// ── DASHBOARD WINDOW: a clean, full product surface (replaces the old Terminal dump) ──
let dashWin, dashTimer, feedTimer;
function beeState() { try { return JSON.parse(execFileSync('node', [BEE, 'state'], { encoding: 'utf8', timeout: 12000 })); } catch { return null; } }
function pushDash() { if (dashWin && !dashWin.isDestroyed()) { const s = beeState(); if (s) dashWin.webContents.send('dash-data', s); } }
function pushFeed() {                                   // the AgentPay Feed — fetched on its own slow cadence (not every state tick)
  if (!dashWin || dashWin.isDestroyed()) return;
  try { const f = JSON.parse(execFileSync('node', [BEE, 'feed-json', '8'], { encoding: 'utf8', timeout: 12000 })); dashWin.webContents.send('dash-feed', f); } catch {}
}
function openDashboardWindow() {
  if (dashWin && !dashWin.isDestroyed()) { dashWin.show(); dashWin.focus(); pushDash(); return; }
  dashWin = new BrowserWindow({
    width: 980, height: 720, minWidth: 760, minHeight: 560, show: false,
    titleBarStyle: 'hiddenInset', frame: false, backgroundColor: '#0b0c0f', vibrancy: 'under-window',
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true },
  });
  dashWin.loadFile(join(__dirname, 'dashboard.html'));
  dashWin.once('ready-to-show', () => { dashWin.show(); dashWin.focus(); pushDash(); pushFeed(); });
  dashTimer = setInterval(pushDash, 3000);
  feedTimer = setInterval(pushFeed, 300000);            // refresh the feed every 5 min
  dashWin.on('closed', () => { clearInterval(dashTimer); clearInterval(feedTimer); dashWin = null; });
}
ipcMain.on('open-dashboard', openDashboardWindow);
ipcMain.on('dash-close', () => { if (dashWin && !dashWin.isDestroyed()) dashWin.close(); });
ipcMain.on('dash-action', (_e, a) => {                // dashboard buttons → bee commands, then refresh
  const run = (args) => { try { execFileSync('node', [BEE, ...args], { timeout: 20000 }); } catch {} };
  if (a.kind === 'autonomy') run(['autonomy', a.arg]);
  else if (a.kind === 'run') run(['run', a.arg]);
  else if (a.kind === 'done') run(['done', a.arg]);
  else if (a.kind === 'dispatch-all') run(['dispatch', 'all']);
  setTimeout(pushDash, 400); tick();
});
ipcMain.on('speak', (_e, t) => { try { spawn('node', [BEE, 'speak', String(t)], { detached: true, stdio: 'ignore' }).unref(); } catch {} });

app.whenReady().then(() => {
  createWindow();
  createPointerWindow();
  setInterval(pointerTick, 55);   // ~18fps — smooth enough for the butterfly to ride the cursor
  const icon = nativeImage.createFromNamedImage('NSImageNameTouchBarColorPickerFont', [0, 0, 0]);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Bee — founder in a box');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show/Hide Bee', click: () => (win.isVisible() ? win.hide() : win.show()) },
    { label: 'Open dashboard', click: () => ipcMain.emit('open-dashboard') },
    { type: 'separator' },
    { label: 'Quit Bee', click: () => app.quit() },
  ]));
  setInterval(tick, 3000);
  if (process.platform === 'darwin') app.dock?.hide();
});
app.on('window-all-closed', () => {}); // stay alive in tray
