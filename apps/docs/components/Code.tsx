interface CodeProps {
  children: string;
  lang?: string;
  filename?: string;
}

export default function Code({ children, filename }: CodeProps) {
  return (
    <div style={{ margin: '1.5rem 0' }}>
      {filename && (
        <div
          style={{
            background: '#111',
            border: '1px solid #1f1f1f',
            borderBottom: 'none',
            borderRadius: '8px 8px 0 0',
            padding: '0.5rem 1rem',
            fontSize: '0.75rem',
            color: '#6b7280',
            fontFamily: 'monospace',
          }}
        >
          {filename}
        </div>
      )}
      <pre
        style={{
          borderRadius: filename ? '0 0 8px 8px' : 8,
          marginTop: 0,
        }}
      >
        <code>{children.trimStart()}</code>
      </pre>
    </div>
  );
}
