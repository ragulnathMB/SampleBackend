const express = require('express');
const fs = require('fs').promises;
const axios = require('axios');
const app = express();
const port = 3001;

// Middleware to parse JSON bodies
app.use(express.json());

// Load Placeholder.json
async function loadPlaceholderData() {
    try {
        const data = await fs.readFile('Placeholder.json', 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error loading Placeholder.json:', error);
        return {};
    }
}

// Helper to find matching endpoint in Placeholder.json
function findEndpointConfig(apiData, requestedUrl, method) {
    for (const module in apiData) {
        for (const endpoint in apiData[module]) {
            const config = apiData[module][endpoint];
            if (config.method.toUpperCase() === method.toUpperCase()) {
                // Convert URL pattern to regex to match parameters (e.g., :empId)
                const urlPattern = config.url.replace(/:[^/]+/g, '([^/]+)');
                const regex = new RegExp(`^${urlPattern}$`);
                const match = requestedUrl.match(regex);
                if (match) {
                    return { config, params: match.slice(1) };
                }
            }
        }
    }
    return null;
}

// Helper to replace parameters in URL
function replaceUrlParams(url, params) {
    let paramIndex = 0;
    return url.replace(/:[^/]+/g, () => params[paramIndex++] || '');
}

// Main request handler
app.all('/api/:path(*)', async (req, res) => {
    const apiData = await loadPlaceholderData();
    const requestedUrl = `/api/${req.params.path}`;
    const method = req.method;

    const endpointConfig = findEndpointConfig(apiData, requestedUrl, method);
    if (!endpointConfig) {
        return res.status(404).json({ error: 'Endpoint not found in Placeholder.json' });
    }

    const { config, params } = endpointConfig;
    const targetUrl = replaceUrlParams(config.url, params);

    try {
        // Forward request to the real backend URL
        const response = await axios({
            method: method,
            url: targetUrl,
            data: ['POST', 'PATCH'].includes(method.toUpperCase()) ? req.body : undefined,
            params: method.toUpperCase() === 'GET' ? req.query : undefined,
            headers: {
                'Content-Type': 'application/json',
                ...req.headers,
                host: undefined, // Remove host header to avoid issues
            },
        });

        res.status(response.status).json(response.data);
    } catch (error) {
        console.error(`Error forwarding request to ${targetUrl}:`, error.message);
        res.status(error.response?.status || 500).json({
            error: 'Failed to forward request',
            details: error.message,
        });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Placeholder server running on http://localhost:${port}`);
});