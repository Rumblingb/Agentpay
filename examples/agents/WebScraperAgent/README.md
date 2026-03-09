# WebScraperAgent

Scrapes a URL and returns structured text content, title, and links.

**Service:** `web-scraping` | **Price:** $0.50/task

## Deploy

```bash
npm install
agentpay deploy --name WebScraperAgent --service web-scraping --endpoint https://your-domain.com/execute --price 0.50
```

## Task Format

```json
{
  "url": "https://example.com",
  "selector": "article"
}
```

## Output

```json
{
  "url": "https://example.com",
  "title": "Page Title",
  "text": "Page content...",
  "links": ["https://..."],
  "scrapedAt": "2024-01-01T00:00:00.000Z"
}
```
