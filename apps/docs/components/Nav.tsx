'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/',            label: 'Overview'    },
  { href: '/quickstart',  label: 'Quickstart'  },
  { href: '/mcp',         label: 'MCP Tools'   },
  { href: '/examples',    label: 'Examples'    },
  { href: '/adapters',    label: 'Adapters'    },
  { href: '/passport',    label: 'AgentPassport' },
  { href: '/pricing',     label: 'Pricing'     },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        background: 'rgba(8,8,8,0.92)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid #1f1f1f',
      }}
    >
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', height: 56 }}>
        <Link href="/" style={{ fontWeight: 700, fontSize: '1rem', color: '#fff', textDecoration: 'none', marginRight: '1.5rem', letterSpacing: '-0.02em' }}>
          AgentPay<span style={{ color: '#10b981' }}> docs</span>
        </Link>
        {links.map(({ href, label }) => {
          const active = href === '/' ? path === '/' : path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              style={{
                fontSize: '0.875rem',
                color: active ? '#fff' : '#6b7280',
                textDecoration: 'none',
                padding: '0.25rem 0.75rem',
                borderRadius: 6,
                background: active ? '#1a1a1a' : 'transparent',
                transition: 'color 0.15s',
              }}
            >
              {label}
            </Link>
          );
        })}
        <div style={{ flex: 1 }} />
        <a
          href="https://api.agentpay.so/api/merchants/register"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: '0.8125rem',
            fontWeight: 600,
            color: '#10b981',
            textDecoration: 'none',
            border: '1px solid #065f46',
            padding: '0.375rem 1rem',
            borderRadius: 6,
          }}
        >
          Get API key
        </a>
      </div>
    </nav>
  );
}
