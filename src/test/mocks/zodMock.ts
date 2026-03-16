// Minimal zod mock used during Jest tests to avoid requiring the optional `zod` package.
// This mock provides a `safeParse` API and no-op validators that accept any input.
const makeNoop = () => {
  const chain: any = {
    safeParse: (data: any) => ({ success: true, data }),
  };
  const methods = [
    'min',
    'max',
    'optional',
    'url',
    'int',
    'positive',
    'nonempty',
    'length',
    'regex',
    'startsWith',
    'endsWith',
    'positive',
    'nullable',
    'transform',
  ];
  for (const m of methods) {
    chain[m] = () => chain;
  }
  return chain;
};

export const z = {
  object: () => makeNoop(),
  string: () => makeNoop(),
  number: () => makeNoop(),
  array: () => makeNoop(),
  enum: () => makeNoop(),
  record: () => makeNoop(),
  unknown: () => makeNoop(),
};

export default z;
