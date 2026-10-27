'use strict';

// Phase 0 spike 2: global cursor position from Node, since CEP only sees the
// pointer while it is over the panel.
//
// Windows: one long-lived PowerShell process answers a line per request, so
// only the first read pays PowerShell's start-up. macOS: one osascript (JXA)
// call per read, converted to top-left origin coordinates.

const { spawn, execFile } = require('child_process');

const WINDOWS_LOOP =
  'Add-Type -AssemblyName System.Windows.Forms; ' +
  'while ($true) { ' +
  '$line = [Console]::In.ReadLine(); ' +
  'if ($line -eq $null) { break }; ' +
  '$p = [System.Windows.Forms.Cursor]::Position; ' +
  '[Console]::Out.WriteLine("$($p.X),$($p.Y)"); ' +
  '[Console]::Out.Flush() ' +
  '}';

const MAC_SCRIPT = [
  "ObjC.import('AppKit');",
  'var p = $.NSEvent.mouseLocation;',
  'var h = $.NSScreen.screens.objectAtIndex(0).frame.size.height;',
  "Math.round(p.x) + ',' + Math.round(h - p.y);",
].join(' ');

function parse(line) {
  const [x, y] = String(line).trim().split(',').map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`Unexpected cursor reply: ${line}`);
  return { x, y };
}

class CursorReader {
  constructor() {
    this.platform = process.platform;
    this.proc = null;
    this.waiting = [];
    this.buffer = '';
  }

  startWindows() {
    this.proc = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_LOOP],
      { windowsHide: true });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', chunk => {
      this.buffer += chunk;
      let i;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        const next = this.waiting.shift();
        if (next) {
          try { next.resolve(parse(line)); } catch (e) { next.reject(e); }
        }
      }
    });
    this.proc.on('exit', () => {
      this.proc = null;
      for (const w of this.waiting.splice(0)) w.reject(new Error('Cursor helper exited'));
    });
  }

  // Resolves { x, y, ms } in screen pixels.
  read() {
    const started = performance.now();
    const done = p => Object.assign(p, { ms: performance.now() - started });
    if (this.platform === 'win32') {
      if (!this.proc) this.startWindows();
      return new Promise((resolve, reject) => {
        this.waiting.push({ resolve: p => resolve(done(p)), reject });
        this.proc.stdin.write('\n');
      });
    }
    if (this.platform === 'darwin') {
      return new Promise((resolve, reject) => {
        execFile('osascript', ['-l', 'JavaScript', '-e', MAC_SCRIPT], (err, stdout) => {
          if (err) reject(err); else resolve(done(parse(stdout)));
        });
      });
    }
    return Promise.reject(new Error(`No cursor helper for ${this.platform}`));
  }

  stop() {
    if (this.proc) this.proc.stdin.end();
  }
}

module.exports = { CursorReader, WINDOWS_LOOP, MAC_SCRIPT };
