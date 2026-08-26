import type { NextRequest } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';

export async function middleware(request: NextRequest) {
  const { pathname } = new URL(request.url);

  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (process.env.NODE_ENV === 'production' && forwardedProto === 'http') {
    const secureUrl = new URL(request.url);
    secureUrl.protocol = 'https:';
    return new Response(null, { status: 308, headers: { Location: secureUrl.toString() } });
  }

  // API handlers perform their own authentication and validation. The
  // middleware participates only in the transport-security redirect above.
  if (pathname.startsWith('/api/')) return;

  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;

  const session = sessionCookie ? await verifySession(sessionCookie) : null;
  const isAuthenticated = session !== null;
  const isPublicPage =
    pathname === '/login' ||
    pathname === '/rcm-login' ||
    pathname === '/' ||
    pathname === '/docs' ||
    pathname === '/about' ||
    pathname === '/experiments' ||
    pathname === '/sitemap.xml' ||
    pathname === '/robots.txt' ||
    pathname === '/pricing' ||
    pathname.startsWith('/network') ||
    pathname === '/registry' ||
    pathname === '/trust' ||
    pathname === '/build' ||
    pathname.startsWith('/commerce') ||
    pathname === '/for-billing' ||
    pathname === '/rcm-signup' ||
    pathname === '/rcm-onboard';

  if (!isAuthenticated && !isPublicPage) {
    const redirectTarget = pathname.startsWith('/rcm') ? '/rcm-login' : '/login';
    return new Response(null, {
      status: 302,
      headers: { Location: new URL(redirectTarget, request.url).toString() },
    });
  }

  if (isAuthenticated && pathname === '/login') {
    return new Response(null, {
      status: 302,
      headers: { Location: new URL('/overview', request.url).toString() },
    });
  }

  if (isAuthenticated && pathname === '/rcm-login') {
    return new Response(null, {
      status: 302,
      headers: { Location: new URL('/rcm', request.url).toString() },
    });
  }

  return;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
