// Minimal jsonwebtoken mock for tests
module.exports = {
  sign: (payload) => {
    try {
      return Buffer.from(JSON.stringify(payload)).toString('base64');
    } catch (e) {
      return 'mocked-token';
    }
  },
  verify: (token) => {
    try {
      const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
      return decoded;
    } catch (e) {
      // mimic jwt verify throwing on invalid token
      throw new Error('invalid token');
    }
  },
  decode: (token) => {
    try {
      return JSON.parse(Buffer.from(token, 'base64').toString());
    } catch (e) {
      return null;
    }
  },
  default: {}
};
