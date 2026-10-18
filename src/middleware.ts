import { clerkMiddleware } from '@clerk/nextjs/server'
import { dashboardAuthenticationMode, dashboardClerkEnabled } from '@/lib/clerk/config'
import { updateSession } from '@/lib/supabase/middleware'
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server'

async function handleRequest(request: NextRequest, hasClerkSession = false) {
  if (
    request.nextUrl.pathname.startsWith('/api/')
  ) {
    return NextResponse.next()
  }
  return await updateSession(request, hasClerkSession)
}

const clerkHandler = clerkMiddleware(async (auth, request) => {
  const session = await auth()
  const mode = dashboardAuthenticationMode(
    request.headers.get('x-forwarded-host') ?? request.headers.get('host'),
  )
  if (mode === 'clerk' && !session.userId && request.nextUrl.pathname.startsWith('/admin')) {
    const url = request.nextUrl.clone()
    url.pathname = '/clerk-auth/sign-in'
    url.search = ''
    url.searchParams.set('redirect_url', request.nextUrl.pathname + request.nextUrl.search)
    return NextResponse.redirect(url)
  }
  if (session.userId && request.nextUrl.pathname.startsWith('/api/')) {
    // No dashboard API route has completed the Clerk authorization migration
    // yet. Server actions for analytics and provisioning enforce their own
    // permissions; legacy API routes remain available only to legacy sessions.
    if (
      request.nextUrl.pathname !== '/api/storage/upload-token' &&
      // Draft image uploads verify Clerk identity and business ownership in
      // their route, before writing through the service-role storage client.
      request.nextUrl.pathname !== '/api/onboarding/upload' &&
      request.nextUrl.pathname !== '/api/payments/tilopay/domain-return' &&
      // Card tokenization finishes by returning the browser to this endpoint.
      // It has its own one-time session + callback-secret validation and must
      // not be blocked merely because the user is signed in with Clerk.
      request.nextUrl.pathname !== '/api/payments/tilopay/card-token-return' &&
      !request.nextUrl.pathname.startsWith('/api/meta/')
    ) {
      return NextResponse.json({ message: 'Esta operación todavía no está disponible para esta cuenta.' }, { status: 403 })
    }
  }
  if (
    session.userId &&
    request.nextUrl.pathname.startsWith('/admin') &&
    request.nextUrl.pathname !== '/admin' &&
    request.nextUrl.pathname !== '/admin/account' &&
    request.nextUrl.pathname !== '/admin/businesses/new' &&
    !request.nextUrl.pathname.startsWith('/admin/orders') &&
    !request.nextUrl.pathname.startsWith('/admin/products') &&
    !request.nextUrl.pathname.startsWith('/admin/app/start') &&
    !request.nextUrl.pathname.startsWith('/admin/app/checkout') &&
    !request.nextUrl.pathname.startsWith('/admin/app/appearance') &&
    !request.nextUrl.pathname.startsWith('/admin/app/delivery') &&
    !request.nextUrl.pathname.startsWith('/admin/app/open-hours') &&
    !request.nextUrl.pathname.startsWith('/admin/app/closed-special-hours') &&
    !request.nextUrl.pathname.startsWith('/admin/app/payment-methods') &&
    !request.nextUrl.pathname.startsWith('/admin/app/cashback') &&
    !request.nextUrl.pathname.startsWith('/admin/dashboard-app/automatic-statuses') &&
    !request.nextUrl.pathname.startsWith('/admin/marketing') &&
    !request.nextUrl.pathname.startsWith('/admin/dashboard-app/daily-preparation-reset') &&
    !request.nextUrl.pathname.startsWith('/admin/reservations') &&
    !request.nextUrl.pathname.startsWith('/admin/open-hours') &&
    !request.nextUrl.pathname.startsWith('/admin/closed-days') &&
    !request.nextUrl.pathname.startsWith('/admin/developer') &&
    !request.nextUrl.pathname.startsWith('/admin/settings/users') &&
    !request.nextUrl.pathname.startsWith('/admin/settings/business') &&
    !request.nextUrl.pathname.startsWith('/admin/settings/market') &&
    !request.nextUrl.pathname.startsWith('/admin/settings/billing') &&
    !request.nextUrl.pathname.startsWith('/admin/settings/domains')
  ) {
    return NextResponse.redirect(new URL('/admin', request.url))
  }
  return handleRequest(request, Boolean(session.userId))
})

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  const mode = dashboardAuthenticationMode(
    request.headers.get('x-forwarded-host') ?? request.headers.get('host'),
  )
  const pathname = request.nextUrl.pathname
  const invitationTicket = request.nextUrl.searchParams.get('__clerk_ticket')

  // The stock Clerk sign-up route remains invitation-only. Public merchant
  // registration uses the custom /clerk-auth/get-started flow instead.
  if (
    pathname.startsWith('/auth/sign-up') ||
    (pathname.startsWith('/clerk-auth/sign-up') && !invitationTicket)
  ) {
    const url = request.nextUrl.clone()
    url.pathname = mode === 'clerk' ? '/clerk-auth/sign-in' : '/auth/login'
    url.search = ''
    return NextResponse.redirect(url)
  }

  if (mode === 'legacy' && pathname.startsWith('/clerk-auth')) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    url.search = ''
    return NextResponse.redirect(url)
  }
  if (mode === 'clerk' && pathname.startsWith('/auth/login')) {
    const url = request.nextUrl.clone()
    url.pathname = '/clerk-auth/sign-in'
    url.search = ''
    return NextResponse.redirect(url)
  }

  if (mode === 'legacy') return handleRequest(request)
  return dashboardClerkEnabled() ? clerkHandler(request, event) : handleRequest(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - images - .svg, .png, .jpg, .jpeg, .gif, .webp
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
