import type { Metadata } from 'next';
import Code from '../../components/Code';

export const metadata: Metadata = {
  title: 'Adapters',
  description: 'Drop-in AgentPay wrappers for OpenAI function calling, LangChain, and Vercel AI SDK.',
};

const S = {
  h1: { fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', fontWeight: 800, letterSpacing: '-0.03em', margin: '0 0 0.75rem' } as React.CSSProperties,
  lead: { fontSize: '1.0625rem', color: '#9ca3af', lineHeight: 1.6, margin: '0 0 3rem', maxWidth: 640 } as React.CSSProperties,
  h2: { fontSize: '1.375rem', fontWeight: 700, letterSpacing: '-0.02em', margin: '3rem 0 0.5rem', paddingTop: '2.5rem', borderTop: '1px solid #1a1a1a' } as React.CSSProperties,
  h3: { fontSize: '1rem', fontWeight: 600, color: '#e5e7eb', margin: '1.75rem 0 0.5rem' } as React.CSSProperties,
  p: { color: '#9ca3af', lineHeight: 1.7, margin: '0 0 1rem' } as React.CSSProperties,
  badge: {
    display: 'inline-block',
    fontSize: '0.6875rem',
    fontWeight: 600,
    color: '#10b981',
    background: '#052e16',
    border: '1px solid #065f46',
    padding: '0.2rem 0.5rem',
    borderRadius: 4,
    fontFamily: 'monospace',
    marginLeft: '0.75rem',
    verticalAlign: 'middle',
  } as React.CSSProperties,
};

export default function Adapters() {
  return (
    <>
      <h1 style={S.h1}>Adapters</h1>
      <p style={S.lead}>
        <code>@agentpayxyz/adapters</code> is a single npm package with zero runtime dependencies.
        It ships adapters for the three most common agent frameworks. Pick what you use — you get payment intents,
        settlement verification, and AgentPassport trust queries as native tool/function calls.
      </p>

      <Code lang="bash">{`
npm install @agentpayxyz/adapters
`}</Code>

      <p style={S.p}>
        Set your API key as an environment variable:
      </p>
      <Code lang="bash">{`
AGENTPAY_API_KEY=sk_live_...
`}</Code>

      {/* OpenAI */}
      <h2 style={S.h2}>
        OpenAI function calling
        <span style={S.badge}>openai</span>
      </h2>
      <p style={S.p}>
        Pass the AgentPay tools to any Chat Completions call. The adapter handles tool execution;
        your loop just processes the responses.
      </p>

      <h3 style={S.h3}>Register the tools</h3>
      <Code lang="typescript" filename="agent.ts">{`
import OpenAI from 'openai';
import { openaiTools, executeOpenAITool } from '@agentpayxyz/adapters/openai';

const client = new OpenAI();
const agentpayKey = process.env.AGENTPAY_API_KEY!;

const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Book the data cleaning job for $2.50' }],
  tools: openaiTools,           // createIntent, verifyPayment, getPassport
  tool_choice: 'auto',
});

for (const choice of response.choices) {
  const msg = choice.message;
  if (msg.tool_calls) {
    for (const call of msg.tool_calls) {
      const result = await executeOpenAITool(call, agentpayKey);
      console.log(result);
      // { intentId: 'intent_01J...', status: 'pending', depositAddress: '7vfC...' }
    }
  }
}
`}</Code>

      <h3 style={S.h3}>Available tools</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1f1f1f' }}>
              {['Function', 'Description', 'Key params'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: '#6b7280', fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ['createIntent', 'Create a USDC payment intent', 'amount, agentId, metadata?'],
              ['verifyPayment', 'Poll until intent verified or expired', 'intentId, timeoutMs?'],
              ['getPassport',  'Read an agent\'s trust passport', 'agentId'],
            ].map(([fn, desc, params]) => (
              <tr key={fn as string} style={{ borderBottom: '1px solid #111' }}>
                <td style={{ padding: '0.6rem 0.75rem' }}><code style={{ color: '#34d399' }}>{fn}</code></td>
                <td style={{ padding: '0.6rem 0.75rem', color: '#9ca3af' }}>{desc}</td>
                <td style={{ padding: '0.6rem 0.75rem' }}><code style={{ fontSize: '0.8125rem', color: '#6b7280' }}>{params}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* LangChain */}
      <h2 style={S.h2}>
        LangChain
        <span style={S.badge}>langchain</span>
      </h2>
      <p style={S.p}>
        Structured tools compatible with any LangChain agent executor. Works with LangGraph nodes too.
      </p>

      <Code lang="typescript" filename="agent.ts">{`
import { ChatOpenAI } from '@langchain/openai';
import { AgentExecutor, createOpenAIFunctionsAgent } from 'langchain/agents';
import { agentpayLangChainTools } from '@agentpayxyz/adapters/langchain';

const tools = agentpayLangChainTools(process.env.AGENTPAY_API_KEY!);

const llm = new ChatOpenAI({ model: 'gpt-4o', temperature: 0 });
const agent = await createOpenAIFunctionsAgent({ llm, tools, prompt });
const executor = new AgentExecutor({ agent, tools });

const result = await executor.invoke({
  input: 'Create a payment intent for $5 to agent agt_01J...',
});
console.log(result.output);
`}</Code>

      <h3 style={S.h3}>LangGraph node</h3>
      <Code lang="typescript" filename="graph.ts">{`
import { agentpayLangChainTools } from '@agentpayxyz/adapters/langchain';
import { ToolNode } from '@langchain/langgraph/prebuilt';

const tools = agentpayLangChainTools(process.env.AGENTPAY_API_KEY!);
const toolNode = new ToolNode(tools);

// Add toolNode to your StateGraph as a node
`}</Code>

      {/* Vercel AI SDK */}
      <h2 style={S.h2}>
        Vercel AI SDK
        <span style={S.badge}>ai</span>
      </h2>
      <p style={S.p}>
        Works with <code>generateText</code>, <code>streamText</code>, and the RSC <code>streamUI</code> helper.
      </p>

      <Code lang="typescript" filename="app/api/chat/route.ts">{`
import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { agentpayVercelTools } from '@agentpayxyz/adapters/vercel';

const tools = agentpayVercelTools(process.env.AGENTPAY_API_KEY!);

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: openai('gpt-4o'),
    messages,
    tools,
    maxSteps: 5,
  });

  return result.toDataStreamResponse();
}
`}</Code>

      {/* Notes */}
      <div
        style={{
          marginTop: '3rem',
          background: '#0d1f17',
          border: '1px solid #065f46',
          borderRadius: 8,
          padding: '1.25rem 1.5rem',
        }}
      >
        <div style={{ fontWeight: 600, color: '#10b981', marginBottom: '0.5rem' }}>All adapters, one package</div>
        <p style={{ ...S.p, margin: 0 }}>
          Every adapter in <code>@agentpayxyz/adapters</code> calls the same AgentPay API under the hood.
          Switch frameworks without changing your integration logic. Full API reference at{' '}
          <a href="https://api.agentpay.so" style={{ color: '#10b981' }}>api.agentpay.so</a>.
        </p>
      </div>
    </>
  );
}
