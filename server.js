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
    return res.send(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Consultations</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background: white;
      border-radius: 20px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.1);
      overflow: hidden;
      text-align: center;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 40px;
    }
    .header h1 {
      font-size: 2.5rem;
      font-weight: 300;
      margin-bottom: 10px;
    }
    .content {
      padding: 60px 40px;
    }
    .empty-state h2 {
      font-size: 1.8rem;
      color: #333;
      margin-bottom: 15px;
    }
    .empty-state p {
      color: #666;
      font-size: 1.1rem;
      line-height: 1.6;
    }
    .icon {
      font-size: 4rem;
      margin-bottom: 20px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 Consultations Dashboard</h1>
    </div>
    <div class="content">
      <div class="empty-state">
        <div class="icon">📋</div>
        <h2>No Consultations Yet</h2>
        <p>When patients book consultations through your website, they will appear here. Share your website link to start receiving bookings!</p>
      </div>
    </div>
  </div>
</body>
</html>`);
  }
  const csv = fs.readFileSync(submissionsCsvPath, 'utf8');
  const { headers, records } = parseCsv(csv);
  const th = headers.map(h => `<th>${h}</th>`).join('');
  const trs = records.map(r => {
    const cells = headers.map((h, idx) => {
      let cellClass = '';
      let cellContent = r[h] || '';
      
      if (h === 'timestamp') {
        cellClass = 'timestamp';
        cellContent = new Date(cellContent).toLocaleString();
      } else if (h === 'name') {
        cellClass = 'name';
      } else if (h === 'email') {
        cellClass = 'email';
      } else if (h === 'source') {
        cellClass = 'source';
        cellContent = `<span class="source">${cellContent}</span>`;
      }
      
      return `<td class="${cellClass}" data-label="${h}">${cellContent}</td>`;
    }).join('');
    
    return `<tr>${cells}</tr>`;
  }).join('');
  res.send(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Consultations</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      border-radius: 20px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.1);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      text-align: center;
    }
    .header h1 {
      font-size: 2.5rem;
      font-weight: 300;
      margin-bottom: 10px;
    }
    .header p {
      font-size: 1.1rem;
      opacity: 0.9;
    }
    .content {
      padding: 40px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
      color: white;
      padding: 25px;
      border-radius: 15px;
      text-align: center;
      box-shadow: 0 10px 20px rgba(0,0,0,0.1);
    }
    .stat-card h3 {
      font-size: 2rem;
      font-weight: 600;
      margin-bottom: 5px;
    }
    .stat-card p {
      font-size: 0.9rem;
      opacity: 0.9;
    }
    .download-btn {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 15px 30px;
      border: none;
      border-radius: 50px;
      cursor: pointer;
      margin-bottom: 30px;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      font-size: 1rem;
      font-weight: 500;
      box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
      transition: all 0.3s ease;
    }
    .download-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 15px 30px rgba(102, 126, 234, 0.4);
    }
    .table-container {
      background: white;
      border-radius: 15px;
      overflow: hidden;
      box-shadow: 0 10px 20px rgba(0,0,0,0.05);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    thead {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    thead th {
      padding: 20px 15px;
      text-align: left;
      font-weight: 600;
      font-size: 0.9rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    tbody tr {
      border-bottom: 1px solid #f0f0f0;
      transition: all 0.3s ease;
    }
    tbody tr:hover {
      background: #f8f9ff;
      transform: scale(1.01);
    }
    tbody td {
      padding: 20px 15px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .timestamp {
      color: #666;
      font-size: 0.85rem;
    }
    .name {
      font-weight: 600;
      color: #333;
    }
    .email {
      color: #667eea;
    }
    .source {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 5px 12px;
      border-radius: 20px;
      font-size: 0.8rem;
      font-weight: 500;
    }
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #666;
    }
    .empty-state h2 {
      font-size: 1.5rem;
      margin-bottom: 10px;
      color: #333;
    }
    /* Mobile responsive table → card layout */
    @media (max-width: 768px) {
      .header h1 { font-size: 1.8rem; }
      .content { padding: 20px; }
      .stats-grid { grid-template-columns: 1fr; }

      .table-container { box-shadow: none; background: transparent; }
      table { border-collapse: separate; border-spacing: 0 12px; font-size: 0.9rem; }
      thead { display: none; }
      tbody { display: block; }
      tbody tr { display: block; background: #ffffff; border-radius: 16px; box-shadow: 0 8px 16px rgba(0,0,0,0.06); padding: 6px 0; }
      tbody td { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #f1f1f5; padding: 12px 16px; white-space: normal; word-break: break-word; }
      tbody td:last-child { border-bottom: 0; }
      tbody td:before { content: attr(data-label); font-weight: 700; color: #5a67d8; text-transform: uppercase; letter-spacing: .3px; margin-right: 12px; flex: 0 0 40%; }
      tbody td.email { word-break: break-all; }
      .source { display: inline-block; }
    }
  </style>
  </head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 Consultations Dashboard</h1>
      <p>Manage and track all consultation bookings</p>
    </div>
    <div class="content">
      <div class="stats-grid">
        <div class="stat-card">
          <h3>${records.length}</h3>
          <p>Total Consultations</p>
        </div>
        <div class="stat-card">
          <h3>${records.filter(r => r.source === 'hero').length}</h3>
          <p>Hero Form</p>
        </div>
        <div class="stat-card">
          <h3>${records.filter(r => r.source === 'popup').length}</h3>
          <p>Popup Form</p>
        </div>
        <div class="stat-card">
          <h3>${new Date().toLocaleDateString()}</h3>
          <p>Last Updated</p>
        </div>
      </div>
      
      <a href="/admin/download" class="download-btn">
        📥 Download CSV Report
      </a>
      
      <div class="table-container">
        <table>
          <thead><tr>${th}</tr></thead>
          <tbody>${trs}</tbody>
        </table>
      </div>
    </div>
  </div>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});


