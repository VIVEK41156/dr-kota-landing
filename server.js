// Basic Express server to receive contact form submissions
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'change-me';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Serve static site (so Index.html works at http://localhost:3000)
app.use(express.static(__dirname));

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
const submissionsCsvPath = path.join(dataDir, 'submissions.csv');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}
if (!fs.existsSync(submissionsCsvPath)) {
  fs.writeFileSync(
    submissionsCsvPath,
    'timestamp,name,phone,email,symptoms,source\n',
    'utf8'
  );
}

function sanitizeCsv(value) {
  if (value == null) return '';
  const str = String(value).replace(/\r|\n/g, ' ').trim();
  if (str.includes(',') || str.includes('"')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

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

function parseCsv(content) {
  const lines = content.trim().split(/\r?\n/);
  const [headerLine, ...rows] = lines;
  const headers = headerLine.split(',');
  const records = rows.map(line => {
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

app.post('/api/contact', (req, res) => {
  const { name, phone, email, symptoms, source } = req.body || {};

  if (!name || !phone || !email) {
    return res.status(400).json({ ok: false, error: 'Missing required fields' });
  }

  const row = [
    new Date().toISOString(),
    sanitizeCsv(name),
    sanitizeCsv(phone),
    sanitizeCsv(email),
    sanitizeCsv(symptoms || ''),
    sanitizeCsv(source || 'unknown')
  ].join(',') + '\n';

  try {
    fs.appendFileSync(submissionsCsvPath, row, 'utf8');
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Failed to save submission' });
  }

  return res.json({ ok: true });
});

// Map root path to capitalized Index.html (Linux is case-sensitive)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'Index.html'));
});

// Download CSV endpoint
app.get('/admin/download', basicAuth, (req, res) => {
  if (!fs.existsSync(submissionsCsvPath)) {
    return res.status(404).send('No submissions found');
  }
  
  const csv = fs.readFileSync(submissionsCsvPath, 'utf8');
  const filename = `consultations-${new Date().toISOString().split('T')[0]}.csv`;
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

// Password-protected admin viewer at /admin
app.get('/admin', basicAuth, (req, res) => {
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
  <style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:20px} table{border-collapse:collapse;width:100%} thead{background:#f8f8f8} h1{margin-bottom:16px} .download-btn{background:#007bff;color:white;padding:10px 20px;border:none;border-radius:5px;cursor:pointer;margin-bottom:20px;text-decoration:none;display:inline-block} .download-btn:hover{background:#0056b3}</style>
  </head>
<body>
  <h1>Consultations (${records.length})</h1>
  <a href="/admin/download" class="download-btn">📥 Download CSV</a>
  <table>
    <thead><tr>${th}</tr></thead>
    <tbody>${trs}</tbody>
  </table>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});


