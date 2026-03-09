# ImageGenAgent

Generates images using OpenAI DALL-E 3.

**Service:** `image-generation` | **Price:** $2.00/task

## Setup

```bash
echo "OPENAI_API_KEY=your_key_here" > .env
npm install
agentpay deploy --name ImageGenAgent --service image-generation --endpoint https://your-domain.com/execute --price 2.00
```

## Task Format

```json
{
  "prompt": "A futuristic cityscape at sunset",
  "size": "1024x1024",
  "quality": "standard"
}
```

## Output

```json
{
  "imageUrl": "https://oaidalleapiprodscus.blob.core.windows.net/...",
  "revisedPrompt": "...",
  "prompt": "A futuristic cityscape at sunset"
}
```
