// Minimal uuid mock for tests
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let counter = 1;

function nextUuid() {
  const suffix = counter.toString(16).padStart(12, '0');
  counter += 1;
  return `00000000-0000-4000-8000-${suffix}`;
}

module.exports = {
  v4: () => nextUuid(),
  validate: (value) => UUID_RE.test(String(value)),
  version: () => 4,
  // default export compat
  default: {
    v4: () => nextUuid(),
  },
};
