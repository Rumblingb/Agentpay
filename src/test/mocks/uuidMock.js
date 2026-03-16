// Minimal uuid mock for tests
module.exports = {
  v4: () => '00000000-0000-4000-8000-000000000000',
  validate: () => true,
  version: () => 4,
  // default export compat
  default: {
    v4: () => '00000000-0000-4000-8000-000000000000',
  },
};
