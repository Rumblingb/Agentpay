#!/usr/bin/env node
import { createAgentPayMcpServer } from '../dist/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = createAgentPayMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write('AgentPay MCP server running on stdio\n');
