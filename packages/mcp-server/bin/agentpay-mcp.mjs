#!/usr/bin/env node
import { startStdioServer } from '../dist/index.js';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stderr.write(
    'AgentPay MCP server\n'
    + '\n'
    + 'Usage:\n'
    + '  npx -y @agentpayxyz/mcp-server\n'
    + '\n'
    + 'Starts an MCP stdio server. A missing AGENTPAY_API_KEY warns on stderr\n'
    + 'but the process stays up and speaks MCP.\n'
    + '\n'
    + 'Default API: https://api.agentpay.so\n',
  );
}

await startStdioServer();
