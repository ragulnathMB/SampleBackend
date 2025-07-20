const express = require('express');
const app = express();

app.post('/api/proxy/:method/:tenantId/:section/:apiName/:wildcard*', (req, res) => {
  res.send(req.params);
});

app.listen(3000, () => console.log('✅ Server running on http://localhost:3000'));
