// Minimal bcrypt mock for tests
module.exports = {
  genSalt: async () => 'salt',
  hash: async (s) => `hashed-${s}`,
  compare: async (plain, hashed) => hashed === `hashed-${plain}`,
  // default export compatibility
  default: {
    genSalt: async () => 'salt',
    hash: async (s) => `hashed-${s}`,
    compare: async (plain, hashed) => hashed === `hashed-${plain}`,
  },
};
