const axios = require('axios');
const sql = require('mssql');

// MSSQL DB Config – replace with your credentials
const dbConfig = {
    user: 'testuser',
    password: '1234',
    server: 'localhost',
    database: 'TenantDB',
    options: {
        encrypt: true,
        trustServerCertificate: true,
    },
};

// Fetch API details from the Tenants table based on tenantId, section, and apiName
async function getApiDetails(tenantId, section, apiName) {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool
            .request()
            .input('tenantId', sql.VarChar, tenantId)
            .query(`SELECT APIList FROM Tenants WHERE TenantID = @tenantId`);

        if (!result.recordset.length) {
            throw new Error(`Tenant ID '${tenantId}' not found in database.`);
        }

        const apiListStr = result.recordset[0].APIList;
        const apiList = JSON.parse(apiListStr);

        if (!apiList[section]) {
            throw new Error(`Section '${section}' not found for Tenant '${tenantId}'.`);
        }

        const apiEntry = apiList[section][apiName];
        if (!apiEntry || !apiEntry.url || !apiEntry.method) {
            throw new Error(`API '${apiName}' not found in section '${section}' for Tenant '${tenantId}'.`);
        }

        console.log(`✅ Resolved API from DB:`, apiEntry);
        return apiEntry;
    } catch (error) {
        console.error("❌ DB/API Lookup Error:", error.message);
        throw error;
    }
}

// Replace :param placeholders in the URL with actual values from paramValues array
function replaceUrlParams(urlTemplate, paramValues) {
    const urlObject = new URL(urlTemplate, 'http://dummy-base');
    const path = urlObject.pathname;

    const paramPattern = /:([a-zA-Z0-9_]+)/g;
    let index = 0;

    const newPath = path.replace(paramPattern, (_, paramName) => {
        if (index >= paramValues.length) {
            throw new Error(`Missing value for parameter: ${paramName}. Expected ${index + 1} param(s), got ${paramValues.length}`);
        }
        return encodeURIComponent(paramValues[index++]);
    });

    if (index < paramValues.length) {
        console.warn(`⚠️ Extra param values provided (not used): ${paramValues.slice(index).join(", ")}`);
    }

    urlObject.pathname = newPath;
    return urlObject.href.replace('http://dummy-base', '');
}

// Main forwarding function
async function forwardRequest(req, res, method, tenantId, section, apiName, paramValues = [], query = {}, body = {}) {
    try {
        console.log("➡️ Proxy request details:", {
            method,
            tenantId,
            section,
            apiName,
            paramValues,
            query,
            body
        });

        const apiDetails = await getApiDetails(tenantId, section, apiName);
        const resolvedUrl = replaceUrlParams(apiDetails.url, paramValues);

        console.log(`🌐 Forwarding to real backend URL: ${resolvedUrl}`);

        const response = await axios({
            method: apiDetails.method.toLowerCase(),
            url: resolvedUrl,
            params: query,
            data: body,
        });

        res.status(response.status).json(response.data);
    } catch (error) {
        console.error("❌ Forwarding Error:", error.message);
        res.status(500).json({ error: error.message });
    }
}

module.exports = forwardRequest;
