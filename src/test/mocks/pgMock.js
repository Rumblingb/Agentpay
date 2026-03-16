// Minimal pg Pool mock for tests
class Pool {
  constructor() {}
  on() {}
  connect() { return { release: () => {} }; }
  query(_sql, _params) { return Promise.resolve({ rows: [] }); }
}
module.exports = { Pool };
