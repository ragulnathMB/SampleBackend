const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const PLACEHOLDER_FILE = path.join(__dirname, 'Placeholder.json');


function loadPlaceholders() {
  try {
    const rawData = fs.readFileSync(PLACEHOLDER_FILE);
    return JSON.parse(rawData);
  } catch (err) {
    console.error('Error reading Placeholder.json:', err.message);
    return {};
  }
}


function fillParams(url, params) {
  return url.replace(/:([a-zA-Z_]+)/g, (_, key) => params[key] || '');
}


function registerRoute(customPath, method, targetUrl, response) {
  const expressMethod = method.toLowerCase();

  if (typeof app[expressMethod] !== 'function') {
    console.warn(`Unsupported method: ${method}`);
    return;
  }

  app[expressMethod](customPath, async (req, res) => {
    if (response) {
      console.log(` Mocked: ${method} ${customPath}`);
      return res.json(response);
    }

    // Forward to real API
    const realUrl = fillParams(targetUrl, req.params);

    try {
      const fetch = (await import('node-fetch')).default;

      const fetchOptions = {
        method,
        headers: { 'Content-Type': 'application/json' }
      };

      if (method !== 'GET' && method !== 'DELETE') {
        fetchOptions.body = JSON.stringify(req.body);
      }

      const proxyRes = await fetch(realUrl, fetchOptions);
      const data = await proxyRes.json();

      res.status(proxyRes.status).json(data);
    } catch (err) {
      console.error(' Proxy error:', err.message);
      res.status(500).json({ error: 'Proxying failed' });
    }
  });

  console.log(`Done [${method}] ${customPath} → ${targetUrl}`);
}

// Load all routes from placeholder config
function loadRoutes() {
  const data = loadPlaceholders();

  for (const category in data) {
    const actions = data[category];
    for (const action in actions) {
      const entry = actions[action];
      const method = entry.method || 'GET';
      const targetUrl = entry.url;
      const response = entry.response || null;

      const dynamicSegments = (targetUrl.match(/:([a-zA-Z_]+)/g) || []).join('/');
      const frontendPath = `/${category}/${action}${dynamicSegments ? '/' + dynamicSegments : ''}`.replace(/\/$/, '');

      registerRoute(frontendPath, method, targetUrl, response);
    }
  }
}

loadRoutes();

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`\n Placeholder server listening at http://localhost:${PORT}`);
});
