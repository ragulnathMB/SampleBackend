const express = require('express');
const sql = require('mssql');
const forwardRequest = require('./RequestForwarder.js');
const bodyParser = require('body-parser');
const app = express();
app.use(express.json());
app.use(bodyParser.json());


const userDBConfig = {
  user: 'testuser',
  password: '1234',
  server: 'localhost',
  database: 'UserDB',
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};
const TenantDBConfig = {
  user: 'testuser',
  password: '1234',
  server: 'localhost',
  database: 'TenantDB',
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};


// Connect to DB
async function getUserDBConnection() {
  const pool = await sql.connect(userDBConfig);
  return pool;
}

// Add a user (admin sets default password)
app.post('/users', async (req, res) => {
  const { UserID, EmpID, TenentID, Name, Status } = req.body;
  try {
    const pool = await getUserDBConnection();
    const password = '123456'; // fixed password by admin
    await pool.request()
      .input('UserID', sql.VarChar(50), UserID)
      .input('EmpID', sql.VarChar(50), EmpID)
      .input('TenentID', sql.VarChar(50), TenentID)
      .input('Name', sql.VarChar(100), Name)
      .input('Password', sql.VarChar(50), password)
      .input('Status', sql.VarChar(20), Status)
      .query(`
        INSERT INTO Users (UserID, EmpID, TenentID, Name, Password, Status)
        VALUES (@UserID, @EmpID, @TenentID, @Name, @Password, @Status)
      `);
    res.json({ message: 'User added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Edit a user (admin cannot change password)
app.put('/users/:userId', async (req, res) => {
  const { userId } = req.params;
  const { EmpID, TenentID, Name, Status } = req.body;

  try {
    const pool = await getUserDBConnection();
    await pool.request()
      .input('UserID', sql.VarChar(50), userId)
      .input('EmpID', sql.VarChar(50), EmpID)
      .input('TenentID', sql.VarChar(50), TenentID)
      .input('Name', sql.VarChar(100), Name)
      .input('Status', sql.VarChar(20), Status)
      .query(`
        UPDATE Users
        SET EmpID = @EmpID,
            TenentID = @TenentID,
            Name = @Name,
            Status = @Status
        WHERE UserID = @UserID
      `);
    res.json({ message: 'User updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete multiple users
app.delete('/users', async (req, res) => {
  const { userIds } = req.body;

  if (!Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: 'userIds array is required' });
  }

  const inClause = userIds.map(id => `'${id}'`).join(',');

  try {
    const pool = await getUserDBConnection();
    await pool.request().query(`DELETE FROM Users WHERE UserID IN (${inClause})`);
    res.json({ message: 'Users deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Enable multiple users
app.put('/userStatus/enable', async (req, res) => {
  const { userIds } = req.body;

  if (!Array.isArray(userIds)) {
    return res.status(400).json({ error: 'userIds array required' });
  }

  const inClause = userIds.map(id => `'${id}'`).join(',');

  try {
    const pool = await getUserDBConnection();
    await pool.request().query(`UPDATE Users SET Status = 'Enabled' WHERE UserID IN (${inClause})`);
    res.json({ message: 'Users enabled' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Disable multiple users
app.put('/userStatus/disable', async (req, res) => {
  const { userIds } = req.body;

  if (!Array.isArray(userIds)) {
    return res.status(400).json({ error: 'userIds array required' });
  }

  const inClause = userIds.map(id => `'${id}'`).join(',');

  try {
    const pool = await getUserDBConnection();
    await pool.request().query(`UPDATE Users SET Status = 'Disabled' WHERE UserID IN (${inClause})`);
    res.json({ message: 'Users disabled' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get users by TenantID
app.get('/users/tenant/:tenantId', async (req, res) => {
  const { tenantId } = req.params;

  try {
    const pool = await getUserDBConnection();
    const result = await pool.request()
      .input('TenantID', sql.VarChar(50), tenantId)
      .query('SELECT * FROM Users WHERE TenentID = @TenantID');
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all users
app.get('/users', async (req, res) => {
  try {
    const pool = await getUserDBConnection();
    const result = await pool.request().query('SELECT * FROM Users');
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// #### Tenants ####
// get all api list for given tenant id
app.get('/tenant/:tenantId/apis', async (req, res) => {
  const { tenantId } = req.params;

  try {
    const pool = await sql.connect(TenantDBConfig);
    const result = await pool.request()
      .input('tenantId', sql.VarChar, tenantId)
      .query('SELECT APIList FROM Tenants WHERE TenantID = @tenantId');

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const apiListJson = result.recordset[0].APIList;
    const apiList = JSON.parse(apiListJson);

    res.json(apiList);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// to update tenant name and license count
app.put('/tenant/:tenantId/info', async (req, res) => {
  const { tenantId } = req.params;
  const { name, licenseCount } = req.body;

  try {
    const pool = await sql.connect(TenantDBConfig);
    await pool.request()
      .input('tenantId', sql.VarChar, tenantId)
      .input('name', sql.VarChar, name)
      .input('licenseCount', sql.Int, licenseCount)
      .query(`
        UPDATE Tenants 
        SET Name = @name, LicenseCount = @licenseCount 
        WHERE TenantID = @tenantId
      `);

    res.json({ message: 'Tenant info updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// to replace entire api list
app.patch('/tenant/:tenantId/apis/:section/:apiName', async (req, res) => {
  const { tenantId, section, apiName } = req.params;
  const { url, method, newName } = req.body;

  try {
    const pool = await sql.connect(TenantDBConfig);
    const result = await pool.request()
      .input('tenantId', sql.VarChar, tenantId)
      .query(`SELECT APIList FROM Tenants WHERE TenantID = @tenantId`);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const apiList = JSON.parse(result.recordset[0].APIList);

    if (!apiList[section] || !apiList[section][apiName]) {
      return res.status(404).json({ error: 'API not found' });
    }

    // Update fields
    if (url) apiList[section][apiName].url = url;
    if (method) apiList[section][apiName].method = method;

    // Rename key if needed
    if (newName && newName !== apiName) {
      apiList[section][newName] = apiList[section][apiName];
      delete apiList[section][apiName];
    }

    await pool.request()
      .input('tenantId', sql.VarChar, tenantId)
      .input('apiList', sql.NVarChar(sql.MAX), JSON.stringify(apiList))
      .query(`UPDATE Tenants SET APIList = @apiList WHERE TenantID = @tenantId`);

    res.json({ message: 'API updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// To update specific api list
app.patch('/tenant/:tenantId/apis/:section/:apiName', async (req, res) => {
  const { tenantId, section, apiName } = req.params;
  const { url, method, newName } = req.body;

  try {
    const pool = await sql.connect(TenantDBConfig);
    const result = await pool.request()
      .input('tenantId', sql.VarChar, tenantId)
      .query(`SELECT APIList FROM Tenants WHERE TenantID = @tenantId`);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const apiList = JSON.parse(result.recordset[0].APIList);

    if (!apiList[section] || !apiList[section][apiName]) {
      return res.status(404).json({ error: 'API not found' });
    }

    // Update fields
    if (url) apiList[section][apiName].url = url;
    if (method) apiList[section][apiName].method = method;

    // Rename key if needed
    if (newName && newName !== apiName) {
      apiList[section][newName] = apiList[section][apiName];
      delete apiList[section][apiName];
    }

    await pool.request()
      .input('tenantId', sql.VarChar, tenantId)
      .input('apiList', sql.NVarChar(sql.MAX), JSON.stringify(apiList))
      .query(`UPDATE Tenants SET APIList = @apiList WHERE TenantID = @tenantId`);

    res.json({ message: 'API updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// get tenant table info
app.get('/tenants', async (req, res) => {
  try {
    const pool = await sql.connect(TenantDBConfig);
    const result = await pool.request()
      .query('SELECT * FROM Tenants');

    const tenants = result.recordset.map(row => ({
      TenantID: row.TenantID,
      Name: row.Name,
      LicenseCount: row.LicenseCount,
      APIList: row.APIList ? JSON.parse(row.APIList) : {}
    }));

    res.json(tenants);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ## API interaction between end user, middleInterface, end Server

// Universal route handler for all HTTP methods
app.all('/api/proxy/:method/:tenantId/:section/:apiName/*', (req, res) => {
  const { method, tenantId, section, apiName } = req.params;

  // Extract wildcard parameters (everything after apiName)
  const wildcardPath = req.params[0] || '';
  const paramValues = wildcardPath.split('/').filter(param => param.length > 0);

  console.log(`Proxy request details:`, {
    method: method.toUpperCase(),
    tenantId,
    section,
    apiName,
    paramValues,
    query: req.query,
    body: req.body
  });

  forwardRequest(
    req,
    res,
    method.toUpperCase(),
    tenantId,
    section,
    apiName,
    paramValues,
    req.query,
    req.body
  );
});





// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
