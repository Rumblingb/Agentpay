import { NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/session';

export async function POST() {
  const cookieParts = [
    `${COOKIE_NAME}=`,
    `Path=/`,
    `Max-Age=0`,
    `SameSite=Lax`,
    `HttpOnly`,
  ];
  if (process.env.NODE_ENV === 'production') cookieParts.push('Secure');
  const setCookie = cookieParts.join('; ');

  return NextResponse.json({ success: true }, { status: 200, headers: { 'Set-Cookie': setCookie } });
}
