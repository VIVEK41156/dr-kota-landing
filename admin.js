const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.ADMIN_PORT || 3001;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'change-me';

const submissionsCsvPath = path.join(__dirname, 'data', 'submissions.csv');

function unauthorized(res) {
  res.set('WWW-Authenticate', 'Basic realm="Restricted"');
  return res.status(401).send('Authentication required');
}

function basicAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme !== 'Basic' || !encoded) return unauthorized(res);
  const decoded = Buffer.from(encoded, 'base64').toString();
  const idx = decoded.indexOf(':');
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  if (user === ADMIN_USER && pass === ADMIN_PASS) return next();
  return unauthorized(res);
}

app.use(basicAuth);

function parseCsv(content) {
  const lines = content.trim().split(/\r?\n/);
  const [headerLine, ...rows] = lines;
  const headers = headerLine.split(',');
  const records = rows.map(line => {
    // simple CSV split; matches our sanitizeCsv which quotes commas
    const cols = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) {
        cols.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    cols.push(current);
    const obj = {};
    headers.forEach((h, idx) => obj[h] = cols[idx] || '');
    return obj;
  });
  return { headers, records };
}

app.get('/', (req, res) => {
  if (!fs.existsSync(submissionsCsvPath)) {
    return res.send('<h2>No submissions yet</h2>');
  }
  const csv = fs.readFileSync(submissionsCsvPath, 'utf8');
  const { headers, records } = parseCsv(csv);
  const th = headers.map(h => `<th style="text-align:left;padding:8px;border-bottom:1px solid #ddd;">${h}</th>`).join('');
  const trs = records.map(r => `<tr>${headers.map(h => `<td style="padding:8px;border-bottom:1px solid #eee;white-space:pre-wrap;">${r[h]}</td>`).join('')}</tr>`).join('');
  res.send(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Consultations</title>
  <style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:20px} table{border-collapse:collapse;width:100%} thead{background:#f8f8f8} h1{margin-bottom:16px}</style>
  </head>
<body>
  <h1>Consultations (${records.length})</h1>
  <table>
    <thead><tr>${th}</tr></thead>
    <tbody>${trs}</tbody>
  </table>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`Admin listening on http://localhost:${PORT}`);
});


