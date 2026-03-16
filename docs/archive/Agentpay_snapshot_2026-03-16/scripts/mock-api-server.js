const http = require('http');

const port = process.env.PORT || 3000;

const leaderboard = { leaderboard: [ { agentId: 'agent1', name: 'TravelAgent', totalEarnings: 1234.5, tasksCompleted: 42, rating: 4.9 } ] };
const feed = { events: [ { id: 'e1', title: 'TravelAgent → FlightAgent', value: 12.34, at: Date.now() } ] };
const trust = { pagination: { total: 0 }, events: [] };

const server = http.createServer((req, res) => {
  if (req.method !== 'GET') return res.writeHead(405).end();
  if (req.url.startsWith('/api/agents/leaderboard')) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(leaderboard));
    return;
  }
  if (req.url.startsWith('/api/agents/feed')) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(feed));
    return;
  }
  if (req.url.startsWith('/api/v1/trust/events')) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(trust));
    return;
  }
  res.writeHead(404).end();
});

server.listen(port, () => {
  console.log(`Mock API server listening on http://localhost:${port}`);
});

process.on('SIGTERM', () => server.close());
