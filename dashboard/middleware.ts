import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;

  const session = sessionCookie ? await verifySession(sessionCookie) : null;
  const isAuthenticated = session !== null;
  const isPublicPage =
    pathname === '/login' || pathname === '/' || pathname.startsWith('/network');

  if (!isAuthenticated && !isPublicPage) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (isAuthenticated && pathname === '/login') {
    return NextResponse.redirect(new URL('/overview', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
