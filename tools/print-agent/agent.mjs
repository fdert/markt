#!/usr/bin/env node
// مساعد الطباعة المحلي لنظام رصيد
// يستقبل أوامر ESC/POS من المتصفح ويرسلها للطابعة: طابعات Windows أو CUPS (macOS/Linux) أو طابعة شبكة IP:9100.
// التشغيل: node agent.mjs   (لا يحتاج أي حزم إضافية — Node.js 18 أو أحدث)
import http from 'node:http';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.RASEED_AGENT_PORT ?? 17777);
const ALLOWED = (process.env.RASEED_ALLOWED_ORIGINS ?? '*').split(',');
const isWin = platform() === 'win32';

const run = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, { windowsHide: true, maxBuffer: 1 << 20 }, (e, out, err) => (e ? rej(new Error(err || e.message)) : res(out))));

async function listPrinters() {
  if (isWin) {
    const out = await run('powershell', ['-NoProfile', '-Command', 'Get-Printer | Select-Object -ExpandProperty Name']);
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  const out = await run('lpstat', ['-a']).catch(() => '');
  return out.split('\n').map((l) => l.split(' ')[0]).filter(Boolean);
}

// طباعة خام على Windows عبر winspool دون الحاجة لمشاركة الطابعة
const WIN_RAW = `
param([string]$printer, [string]$file)
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class RawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool StartDocPrinter(IntPtr h, int l, DOCINFO d);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr h, byte[] b, int c, out int w);
  public static void Send(string printer, byte[] data) {
    IntPtr h; if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("OpenPrinter failed");
    var di = new DOCINFO { pDocName = "Raseed Receipt", pDataType = "RAW" };
    StartDocPrinter(h, 1, di); StartPagePrinter(h); int w; WritePrinter(h, data, data.Length, out w); EndPagePrinter(h); EndDocPrinter(h); ClosePrinter(h);
  }
}
"@
[RawPrint]::Send($printer, [System.IO.File]::ReadAllBytes($file))
`;

async function print(printer, data) {
  // طابعة شبكة: tcp://192.168.1.50:9100 أو 192.168.1.50:9100
  const m = /^(?:tcp:\/\/)?(\d{1,3}(?:\.\d{1,3}){3})(?::(\d+))?$/.exec(printer);
  if (m) {
    return new Promise((res, rej) => {
      const s = net.createConnection({ host: m[1], port: Number(m[2] ?? 9100), timeout: 8000 }, () => s.end(data, res));
      s.on('error', rej); s.on('timeout', () => { s.destroy(); rej(new Error('انتهت مهلة الاتصال بالطابعة')); });
    });
  }
  const file = join(tmpdir(), `raseed-${Date.now()}.bin`);
  writeFileSync(file, data);
  try {
    if (isWin) {
      const ps = join(tmpdir(), 'raseed-raw.ps1'); writeFileSync(ps, WIN_RAW);
      await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps, '-printer', printer, '-file', file]);
    } else {
      await run('lp', ['-d', printer, '-o', 'raw', file]);
    }
  } finally { try { unlinkSync(file); } catch { /* تجاهل */ } }
}

http.createServer(async (req, res) => {
  const origin = req.headers.origin ?? '*';
  const ok = ALLOWED.includes('*') || ALLOWED.includes(origin);
  res.setHeader('Access-Control-Allow-Origin', ok ? origin : 'null');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') return res.end();
  const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
  try {
    if (req.url === '/status') return send(200, { ok: true, version: '1.0.0', platform: platform() });
    if (req.url === '/printers') return send(200, { printers: await listPrinters() });
    if (req.url === '/print' && req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk;
      const { printer, data } = JSON.parse(body);
      if (!printer) return send(400, { message: 'اختر الطابعة.' });
      await print(printer, Buffer.from(data, 'base64'));
      return send(200, { ok: true });
    }
    send(404, { message: 'غير موجود' });
  } catch (e) { send(500, { message: String(e.message ?? e) }); }
}).listen(PORT, '127.0.0.1', () => console.log(`Raseed print agent on http://127.0.0.1:${PORT}`));
