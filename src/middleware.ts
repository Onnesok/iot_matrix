import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Simple CORS middleware that allows all origins for API routes.
export function middleware(request: NextRequest) {
  const origin = request.headers.get('origin') || '*';

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    const preflight = new NextResponse(null, { status: 204 });
    preflight.headers.set('Access-Control-Allow-Origin', origin === 'null' ? '*' : origin);
    preflight.headers.set(
      'Access-Control-Allow-Methods',
      'GET,POST,PUT,PATCH,DELETE,OPTIONS'
    );
    preflight.headers.set('Access-Control-Allow-Headers', request.headers.get('Access-Control-Request-Headers') || '*');
    preflight.headers.set('Access-Control-Allow-Credentials', 'true');
    return preflight;
  }

  const response = NextResponse.next();
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', '*');
  response.headers.set('Access-Control-Allow-Credentials', 'true');
  return response;
}

// Apply only to API routes to avoid impacting static assets unnecessarily
export const config = {
  matcher: ['/api/:path*'],
};


