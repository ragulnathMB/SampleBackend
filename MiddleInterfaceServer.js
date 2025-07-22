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

async function getUserDBConnection() {
  const pool = await sql.connect(userDBConfig);
  return pool;
}

async function getTenantDBConnection() {
  const pool = await sql.connect(TenantDBConfig);
  return pool;
}

// USER CRUD
app.post('/users', async (req, res) => {
  const { UserID, EmpID, TenantID, Name, Status } = req.body;
  try {
    const pool = await getUserDBConnection();
    const password = '123456';
    await pool.request()
      .input('UserID', sql.VarChar(50), UserID)
      .input('EmpID', sql.VarChar(50), EmpID)
      .input('TenantID', sql.VarChar(50), TenantID)
      .input('Name', sql.VarChar(100), Name)
      .input('Password', sql.VarChar(50), password)
      .input('Status', sql.VarChar(20), Status)
      .query(`INSERT INTO Users (UserID, EmpID, TenantID, Name, Password, Status)
              VALUES (@UserID, @EmpID, @TenantID, @Name, @Password, @Status)`);
    res.json({ message: 'User added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/users/:userId', async (req, res) => {
  const { userId } = req.params;
  const { EmpID, TenantID, Name, Status } = req.body;
  try {
    const pool = await getUserDBConnection();
    await pool.request()
      .input('UserID', sql.VarChar(50), userId)
      .input('EmpID', sql.VarChar(50), EmpID)
      .input('TenantID', sql.VarChar(50), TenantID)
      .input('Name', sql.VarChar(100), Name)
      .input('Status', sql.VarChar(20), Status)
      .query(`UPDATE Users SET EmpID=@EmpID, TenantID=@TenantID, Name=@Name, Status=@Status
              WHERE UserID=@UserID`);
    res.json({ message: 'User updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

app.put('/userStatus/enable', async (req, res) => {
  const { userIds } = req.body;
  if (!Array.isArray(userIds)) return res.status(400).json({ error: 'userIds array required' });
  const inClause = userIds.map(id => `'${id}'`).join(',');
  try {
    const pool = await getUserDBConnection();
    await pool.request().query(`UPDATE Users SET Status = 'Enabled' WHERE UserID IN (${inClause})`);
    res.json({ message: 'Users enabled' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/userStatus/disable', async (req, res) => {
  const { userIds } = req.body;
  if (!Array.isArray(userIds)) return res.status(400).json({ error: 'userIds array required' });
  const inClause = userIds.map(id => `'${id}'`).join(',');
  try {
    const pool = await getUserDBConnection();
    await pool.request().query(`UPDATE Users SET Status = 'Disabled' WHERE UserID IN (${inClause})`);
    res.json({ message: 'Users disabled' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

app.get('/users', async (req, res) => {
  try {
    const pool = await getUserDBConnection();
    const result = await pool.request().query('SELECT * FROM Users');
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// TENANT ENDPOINTS
app.get('/tenant/:tenantId/apis', async (req, res) => {
  const { tenantId } = req.params;
  try {
    const pool = await getTenantDBConnection();
    const result = await pool.request()
      .input('tenantId', sql.VarChar, tenantId)
      .query('SELECT APIList FROM dbo.Tenants WHERE TenantID = @tenantId');
    if (result.recordset.length === 0) return res.status(404).json({ error: 'Tenant not found' });
    const apiListJson = result.recordset[0].APIList;
    const apiList = JSON.parse(apiListJson || '{}');
    res.json(apiList);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// admin auth
// Admin authentication endpoint
app.post('/auth/admin', async (req, res) => {
  const { empId, password } = req.body;
  
  if (!empId || !password) {
    return res.status(400).json({ error: 'Employee ID and password are required' });
  }
  
  try {
    // First, check if user exists in UserDB with the given EmpID and password
    const userPool = await getUserDBConnection();
    const userResult = await userPool.request()
      .input('EmpID', sql.VarChar(50), empId)
      .input('Password', sql.VarChar(50), password)
      .query('SELECT UserID, TenentID, Name, Status FROM Users WHERE EmpID = @EmpID AND Password = @Password');
    
    if (userResult.recordset.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const user = userResult.recordset[0];
    
    if (user.Status !== 'Enabled') {
      return res.status(401).json({ error: 'User account is disabled' });
    }
    
    // Check if this employee is an admin of any tenant in TenantDB
    const tenantPool = await getTenantDBConnection();
    const tenantResult = await tenantPool.request()
      .input('Admin', sql.VarChar(50), empId)
      .query('SELECT TenantID, Name FROM Tenants WHERE Admin = @Admin');
    
    if (tenantResult.recordset.length === 0) {
      return res.status(403).json({ error: 'You are not authorized as an admin for any tenant' });
    }
    
    // User is an admin, return tenant information
    const adminTenants = tenantResult.recordset;
    
    res.json({
      success: true,
      user: {
        empId: empId,
        userId: user.UserID,
        name: user.Name,
        userTenantId: user.TenantID
      },
      adminTenants: adminTenants,
      primaryTenant: adminTenants[0] // Use first tenant as primary if multiple
    });
    
  } catch (err) {
    res.status(500).json({ error: 'Authentication failed', details: err.message });
  }
});
// Get single tenant by ID
app.get('/tenant/:tenantId', async (req, res) => {
  const { tenantId } = req.params;
  try {
    const pool = await getTenantDBConnection();
    const result = await pool.request()
      .input('tenantId', sql.VarChar, tenantId)
      .query('SELECT * FROM dbo.Tenants WHERE TenantID = @tenantId');
    
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    
    const tenant = result.recordset[0];
    const formattedTenant = {
      TenantID: tenant.TenantID,
      Name: tenant.Name,
      LicenseCount: tenant.LicenseCount,
      APIList: tenant.APIList ? JSON.parse(tenant.APIList) : {},
      LicenseType: tenant.LicenseType,
      EnabledUsersCount: tenant.EnabledUsersCount,
      DisabledUsersCount: tenant.DisabledUsersCount,
      LicenseExpiry: tenant.LicenseExpiry
    };
    
    res.json(formattedTenant);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update tenant info with all fields
app.put('/tenant/:tenantId/info', async (req, res) => {
  const { tenantId } = req.params;
  const { 
    name, 
    licenseCount, 
    licenseType, 
    enabledUsersCount, 
    disabledUsersCount, 
    licenseExpiry 
  } = req.body;
  
  try {
    const pool = await getTenantDBConnection();
    
    // Build dynamic query based on provided fields
    let updateFields = [];
    let request = pool.request().input('tenantId', sql.VarChar, tenantId);
    
    if (name !== undefined) {
      updateFields.push('Name = @name');
      request.input('name', sql.VarChar, name);
    }
    if (licenseCount !== undefined) {
      updateFields.push('LicenseCount = @licenseCount');
      request.input('licenseCount', sql.Int, licenseCount);
    }
    if (licenseType !== undefined) {
      updateFields.push('LicenseType = @licenseType');
      request.input('licenseType', sql.VarChar, licenseType);
    }
    if (enabledUsersCount !== undefined) {
      updateFields.push('EnabledUsersCount = @enabledUsersCount');
      request.input('enabledUsersCount', sql.Int, enabledUsersCount);
    }
    if (disabledUsersCount !== undefined) {
      updateFields.push('DisabledUsersCount = @disabledUsersCount');
      request.input('disabledUsersCount', sql.Int, disabledUsersCount);
    }
    if (licenseExpiry !== undefined) {
      updateFields.push('LicenseExpiry = @licenseExpiry');
      request.input('licenseExpiry', sql.DateTime, licenseExpiry);
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    const query = `UPDATE dbo.Tenants SET ${updateFields.join(', ')} WHERE TenantID = @tenantId`;
    await request.query(query);
    
    res.json({ message: 'Tenant info updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update tenant license counts
app.put('/tenant/:tenantId/license-counts', async (req, res) => {
  const { tenantId } = req.params;
  const { enabledUsersCount, disabledUsersCount } = req.body;
  
  try {
    const pool = await getTenantDBConnection();
    await pool.request()
      .input('tenantId', sql.VarChar, tenantId)
      .input('enabledUsersCount', sql.Int, enabledUsersCount)
      .input('disabledUsersCount', sql.Int, disabledUsersCount)
      .query(`UPDATE dbo.Tenants 
              SET EnabledUsersCount = @enabledUsersCount, 
                  DisabledUsersCount = @disabledUsersCount 
              WHERE TenantID = @tenantId`);
    
    res.json({ message: 'License counts updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update tenant license expiry
app.put('/tenant/:tenantId/license-expiry', async (req, res) => {
  const { tenantId } = req.params;
  const { licenseExpiry } = req.body;
  
  try {
    const pool = await getTenantDBConnection();
    await pool.request()
      .input('tenantId', sql.VarChar, tenantId)
      .input('licenseExpiry', sql.DateTime, licenseExpiry)
      .query('UPDATE dbo.Tenants SET LicenseExpiry = @licenseExpiry WHERE TenantID = @tenantId');
    
    res.json({ message: 'License expiry updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/tenant/:tenantId/apis/:section/:apiName', async (req, res) => {
  const { tenantId, section, apiName } = req.params;
  const { url, method, newName } = req.body;
  try {
    const pool = await getTenantDBConnection();
    const result = await pool.request()
      .input('tenantId', sql.VarChar, tenantId)
      .query('SELECT APIList FROM dbo.Tenants WHERE TenantID = @tenantId');
    if (result.recordset.length === 0) return res.status(404).json({ error: 'Tenant not found' });
    const apiList = JSON.parse(result.recordset[0].APIList || '{}');
    if (!apiList[section] || !apiList[section][apiName]) return res.status(404).json({ error: 'API not found' });
    if (url) apiList[section][apiName].url = url;
    if (method) apiList[section][apiName].method = method;
    if (newName && newName !== apiName) {
      apiList[section][newName] = apiList[section][apiName];
      delete apiList[section][apiName];
    }
    await pool.request()
      .input('tenantId', sql.VarChar, tenantId)
      .input('apiList', sql.NVarChar(sql.MAX), JSON.stringify(apiList))
      .query('UPDATE dbo.Tenants SET APIList = @apiList WHERE TenantID = @tenantId');
    res.json({ message: 'API updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add new API to tenant
app.post('/tenant/:tenantId/apis/:section', async (req, res) => {
  const { tenantId, section } = req.params;
  const { apiName, url, method } = req.body;
  
  if (!apiName || !url || !method) {
    return res.status(400).json({ error: 'apiName, url, and method are required' });
  }
  
  try {
    const pool = await getTenantDBConnection();
    const result = await pool.request()
      .input('tenantId', sql.VarChar, tenantId)
      .query('SELECT APIList FROM dbo.Tenants WHERE TenantID = @tenantId');
    
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    
    const apiList = JSON.parse(result.recordset[0].APIList || '{}');
    
    if (!apiList[section]) {
      apiList[section] = {};
    }
    
    if (apiList[section][apiName]) {
      return res.status(409).json({ error: 'API already exists' });
    }
    
    apiList[section][apiName] = { url, method };
    
    await pool.request()
      .input('tenantId', sql.VarChar, tenantId)
      .input('apiList', sql.NVarChar(sql.MAX), JSON.stringify(apiList))
      .query('UPDATE dbo.Tenants SET APIList = @apiList WHERE TenantID = @tenantId');
    
    res.json({ message: 'API added successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete API from tenant
app.delete('/tenant/:tenantId/apis/:section/:apiName', async (req, res) => {
  const { tenantId, section, apiName } = req.params;
  
  try {
    const pool = await getTenantDBConnection();
    const result = await pool.request()
      .input('tenantId', sql.VarChar, tenantId)
      .query('SELECT APIList FROM dbo.Tenants WHERE TenantID = @tenantId');
    
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    
    const apiList = JSON.parse(result.recordset[0].APIList || '{}');
    
    if (!apiList[section] || !apiList[section][apiName]) {
      return res.status(404).json({ error: 'API not found' });
    }
    
    delete apiList[section][apiName];
    
    // Remove section if empty
    if (Object.keys(apiList[section]).length === 0) {
      delete apiList[section];
    }
    
    await pool.request()
      .input('tenantId', sql.VarChar, tenantId)
      .input('apiList', sql.NVarChar(sql.MAX), JSON.stringify(apiList))
      .query('UPDATE dbo.Tenants SET APIList = @apiList WHERE TenantID = @tenantId');
    
    res.json({ message: 'API deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new tenant with all fields
app.post('/tenant', async (req, res) => {
  const { 
    TenantID, 
    Name, 
    LicenseCount = 0, 
    APIList = {}, 
    LicenseType = null,
    EnabledUsersCount = 0,
    DisabledUsersCount = 0,
    LicenseExpiry = null
  } = req.body;

  if (!TenantID || !Name) {
    return res.status(400).json({ error: 'TenantID and Name are required' });
  }

  try {
    const pool = await getTenantDBConnection();
    await pool.request()
      .input('TenantID', sql.VarChar(50), TenantID)
      .input('Name', sql.VarChar(100), Name)
      .input('LicenseCount', sql.Int, LicenseCount)
      .input('APIList', sql.NVarChar(sql.MAX), JSON.stringify(APIList))
      .input('LicenseType', sql.VarChar(50), LicenseType)
      .input('EnabledUsersCount', sql.Int, EnabledUsersCount)
      .input('DisabledUsersCount', sql.Int, DisabledUsersCount)
      .input('LicenseExpiry', sql.DateTime, LicenseExpiry)
      .query(`
        INSERT INTO dbo.Tenants (TenantID, Name, LicenseCount, APIList, LicenseType, EnabledUsersCount, DisabledUsersCount, LicenseExpiry)
        VALUES (@TenantID, @Name, @LicenseCount, @APIList, @LicenseType, @EnabledUsersCount, @DisabledUsersCount, @LicenseExpiry)
      `);

    res.json({ message: 'Tenant created successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all tenants
app.get('/tenants', async (req, res) => {
  try {
    const pool = await getTenantDBConnection();
    const result = await pool.request().query('SELECT * FROM dbo.Tenants');
    const tenants = result.recordset.map(row => ({
      TenantID: row.TenantID,
      Name: row.Name,
      LicenseCount: row.LicenseCount,
      APIList: row.APIList ? JSON.parse(row.APIList) : {},
      LicenseType: row.LicenseType,
      EnabledUsersCount: row.EnabledUsersCount,
      DisabledUsersCount: row.DisabledUsersCount,
      LicenseExpiry: row.LicenseExpiry
    }));
    res.json(tenants);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete tenant
app.delete('/tenant/:tenantId', async (req, res) => {
  const { tenantId } = req.params;
  
  try {
    const pool = await getTenantDBConnection();
    const result = await pool.request()
      .input('tenantId', sql.VarChar, tenantId)
      .query('DELETE FROM dbo.Tenants WHERE TenantID = @tenantId');
    
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    
    res.json({ message: 'Tenant deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get tenant statistics
app.get('/tenant/:tenantId/stats', async (req, res) => {
  const { tenantId } = req.params;
  
  try {
    const tenantPool = await getTenantDBConnection();
    const tenantResult = await tenantPool.request()
      .input('tenantId', sql.VarChar, tenantId)
      .query('SELECT * FROM dbo.Tenants WHERE TenantID = @tenantId');
    
    if (tenantResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    
    const userPool = await getUserDBConnection();
    const userResult = await userPool.request()
      .input('tenantId', sql.VarChar, tenantId)
      .query(`
        SELECT 
          COUNT(*) as TotalUsers,
          SUM(CASE WHEN Status = 'Enabled' THEN 1 ELSE 0 END) as EnabledUsers,
          SUM(CASE WHEN Status = 'Disabled' THEN 1 ELSE 0 END) as DisabledUsers
        FROM Users 
        WHERE TenantID = @tenantId
      `);
    
    const tenant = tenantResult.recordset[0];
    const userStats = userResult.recordset[0];
    
    const stats = {
      TenantID: tenant.TenantID,
      Name: tenant.Name,
      LicenseCount: tenant.LicenseCount,
      LicenseType: tenant.LicenseType,
      LicenseExpiry: tenant.LicenseExpiry,
      TotalUsers: userStats.TotalUsers,
      EnabledUsers: userStats.EnabledUsers,
      DisabledUsers: userStats.DisabledUsers,
      AvailableLicenses: tenant.LicenseCount - userStats.EnabledUsers,
      APICount: tenant.APIList ? Object.keys(JSON.parse(tenant.APIList)).length : 0
    };
    
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UNIVERSAL PROXY
app.all('/api/proxy/:method/:tenantId/:section/:apiName/*', (req, res) => {
  const { method, tenantId, section, apiName } = req.params;
  const wildcardPath = req.params[0] || '';
  const paramValues = wildcardPath.split('/').filter(Boolean);
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

// API TESTING
app.post('/api/test/:tenantId/:section/:apiName', async (req, res) => {
  const { tenantId, section, apiName } = req.params;
  const { pathParams = [], queryParams = {}, body = {} } = req.body;
  try {
    const pool = await getTenantDBConnection();
    const result = await pool.request()
      .input('tenantId', sql.VarChar, tenantId)
      .query('SELECT APIList FROM dbo.Tenants WHERE TenantID = @tenantId');
    if (result.recordset.length === 0) return res.status(404).json({ error: 'Tenant not found' });
    const apiList = JSON.parse(result.recordset[0].APIList || '{}');
    if (!apiList[section] || !apiList[section][apiName]) return res.status(404).json({ error: 'API not found for tenant' });
    const apiConfig = apiList[section][apiName];
    const method = apiConfig.method;

    const userPool = await getUserDBConnection();
    const transaction = new sql.Transaction(userPool);
    await transaction.begin();

    let testResData = null;
    let testError = null;
    try {
      const fakeRes = {
        statusCode: 200,
        headers: {},
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(data) { this.body = data; },
        send(data) { this.body = data; }
      };
      await forwardRequest(
        { method, params: { tenantId, section, apiName }, query: queryParams, body },
        fakeRes,
        method,
        tenantId,
        section,
        apiName,
        pathParams,
        queryParams,
        body
      );
      testResData = fakeRes.body;
      await transaction.rollback();
    } catch (err) {
      testError = err;
      await transaction.rollback();
    }
    if (testError) return res.status(500).json({ error: 'API test failed', details: testError.message });
    return res.json({ message: 'API test completed successfully', result: testResData });
  } catch (err) {
    return res.status(500).json({ error: 'Test setup failed', details: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\u2705 Server running at http://localhost:${PORT}`);
});