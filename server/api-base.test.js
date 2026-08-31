const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'api.js'), 'utf8');
  const calls = [];

  const sandbox = {
    console,
    fetch: async (url, opts) => {
      calls.push(url);
      return { ok: true, json: async () => ({ ok: true }) };
    },
    localStorage: {
      getItem: (key) => key === 'gorenthive_api_base' ? 'https://api.example.com' : null,
    },
    window: {
      location: { origin: 'https://app.example.com', hostname: 'app.example.com' },
      __GORENTHIVE_API_BASE__: 'https://api.example.com'
    }
  };
  sandbox.globalThis = sandbox;

  vm.runInContext(`${src}\nglobalThis.API = API;`, vm.createContext(sandbox));
  await sandbox.API.get('/auth/me');
  assert.deepStrictEqual(calls, ['https://api.example.com/api/auth/me']);
  console.log('API base override test passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
