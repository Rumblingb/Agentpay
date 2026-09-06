import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isExecutedAsCliEntry } from '../../packages/mcp-server/src/cli-entry';

const binSource = readFileSync(resolve(__dirname, '../../packages/mcp-server/bin/agentpay-mcp.mjs'), 'utf8');
const indexSource = readFileSync(resolve(__dirname, '../../packages/mcp-server/src/index.ts'), 'utf8');

describe('MCP stdio boot contract', () => {
  it('does not use CJS require.main to decide whether to start', () => {
    expect(binSource).not.toMatch(/require\.main/);
    expect(indexSource).not.toMatch(/require\.main\s*===\s*module/);
    expect(indexSource).toContain('startStdioServer');
    expect(indexSource).toContain("https://api.agentpay.so");
    expect(indexSource).not.toMatch(/import\.meta\.url/);
  });

  it('starts the stdio server from the published bin instead of a bare import', () => {
    expect(binSource).toContain('startStdioServer');
    expect(binSource).not.toMatch(/^import\s+['"]\.\.\/dist\/index\.js['"]\s*;?\s*$/m);
  });

  it('detects ESM CLI entry the way npm 0.2.0 failed to', () => {
    expect(isExecutedAsCliEntry(
      'file:///tmp/pkg/dist/index.js',
      '/tmp/pkg/dist/index.js',
    )).toBe(true);
    expect(isExecutedAsCliEntry(
      'file:///tmp/pkg/dist/index.js',
      '/tmp/pkg/bin/agentpay-mcp.mjs',
    )).toBe(false);
    expect(isExecutedAsCliEntry('file:///tmp/pkg/dist/index.js', undefined)).toBe(false);
  });
});
