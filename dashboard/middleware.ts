import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';

export async function middleware(request: NextRequest) {
  const { pathname } = new URL(request.url);
  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;

  const session = sessionCookie ? await verifySession(sessionCookie) : null;
  const isAuthenticated = session !== null;
  const isPublicPage =
    pathname === '/login' ||
    pathname === '/' ||
    pathname === '/docs' ||
    pathname.startsWith('/network') ||
    pathname === '/registry' ||
    pathname === '/trust' ||
    pathname === '/build';

  if (!isAuthenticated && !isPublicPage) {
    return new Response(null, {
      status: 302,
      headers: { Location: new URL('/login', request.url).toString() },
    });
  }

  if (isAuthenticated && pathname === '/login') {
    return new Response(null, {
      status: 302,
      headers: { Location: new URL('/overview', request.url).toString() },
    });
  }

  // no response → continue to next handler
  return;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
