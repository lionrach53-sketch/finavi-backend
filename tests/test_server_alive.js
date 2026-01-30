#!/usr/bin/env node

const http = require('http');

async function testServer() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:3000/api', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('✅ Server responded:', data.slice(0, 100));
        resolve();
      });
    });

    req.on('error', (err) => {
      console.error('❌ Server error:', err.message);
      resolve();
    });

    setTimeout(() => {
      console.log('⏱️ Timeout waiting for server');
      resolve();
    }, 3000);
  });
}

testServer().then(() => process.exit(0));
