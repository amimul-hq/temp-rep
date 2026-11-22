import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

// Reproduce the CommonJS runtime that esbuild uses on Netlify, where
// import.meta.url is undefined. Exercise native ESM directory resolution too.
const source = fs.readFileSync(new URL('../netlify/functions/db.js', import.meta.url), 'utf8');
const resolver = source.slice(source.indexOf('// Netlify bundles'), source.indexOf('// Fallback baseline'));
const moduleDir = fileURLToPath(new URL('../netlify/functions/', import.meta.url)).replace(/\/$/, '');
for (const commonJS of [true, false]) {
  const context = {
    path, fs, fileURLToPath, process,
    ...(commonJS ? { __dirname: moduleDir } : {}),
    moduleUrl: commonJS ? undefined : new URL('../netlify/functions/db.js', import.meta.url).href
  };
  const result = vm.runInNewContext(
    resolver.replaceAll('import.meta.url', 'moduleUrl') + '\nresolveDataFilePaths()', context
  );
  assert.equal(result.primaryPath, path.join(moduleDir, 'data/website-data.json'));
  assert.ok(fs.existsSync(result.primaryPath));
}

// Exercise the actual serverless adapter without sending or printing credentials.
// Random test-only values ensure this check never uses deployed credentials.
process.env.ADMIN_USERNAME = randomUUID();
process.env.ADMIN_PASSWORD = randomUUID();
process.env.JWT_SECRET = randomUUID();
delete process.env.MONGODB_URI;
const { handler } = await import('../netlify/functions/api.js');
for (const requestPath of ['/api/admin/login', '/.netlify/functions/api/admin/login']) {
  const response = await handler({
    httpMethod: 'POST', path: requestPath, headers: { 'content-type': 'application/json' },
    body: '{}', isBase64Encoded: false, requestContext: {}, queryStringParameters: null
  }, {});
  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).message, 'Username and password required');
}
const event = {
  httpMethod: 'POST', path: '/api/admin/login', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD }),
  isBase64Encoded: false, requestContext: {}, queryStringParameters: null
};
const login = await handler(event, {});
assert.equal(login.statusCode, 200);
const { token } = JSON.parse(login.body);
assert.ok(token);
const session = await handler({
  ...event, httpMethod: 'GET', path: '/api/admin/me', body: null,
  headers: { authorization: `Bearer ${token}` }
}, {});
assert.equal(session.statusCode, 200);
assert.equal(JSON.parse(session.body).admin.username, process.env.ADMIN_USERNAME);
const rejected = await handler({ ...event, body: JSON.stringify({
  username: process.env.ADMIN_USERNAME, password: randomUUID()
}) }, {});
assert.equal(rejected.statusCode, 401);

// Missing configuration must never fall back to a shared signing secret.
delete process.env.JWT_SECRET;
const { default: unconfiguredApp } = await import('../netlify/functions/app.js?missing-secret');
const { default: serverless } = await import('serverless-http');
const unconfiguredHandler = serverless(unconfiguredApp);
const unavailable = await unconfiguredHandler(event, {});
assert.equal(unavailable.statusCode, 503);
assert.equal(JSON.parse(unavailable.body).success, false);
const storefront = await unconfiguredHandler({
  ...event, httpMethod: 'GET', path: '/api/website-data', body: null, headers: {}
}, {});
assert.equal(storefront.statusCode, 200);
assert.ok(JSON.parse(storefront.body).data.products.length);
console.log('Function startup, login, session, invalid password, missing-secret, and public storefront checks passed.');
