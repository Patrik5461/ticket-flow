import { createFileRoute } from '@tanstack/react-router'
import { getApplePass } from '../server/order-service'

/**
 * Apple Wallet .pkpass download for one ticket. Authorized by the same signed
 * order token as the PDF (?t=...). Returns 404 when Apple Wallet isn't configured.
 */
export const Route = createFileRoute(
  '/api/orders/$orderId/tickets/$ticketId/pass',
)({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const token = new URL(request.url).searchParams.get('t') ?? ''
        const pass = await getApplePass(params.orderId, params.ticketId, token)
        if (!pass) return new Response('Nenájdené.', { status: 404 })
        return new Response(pass.bytes as unknown as BodyInit, {
          status: 200,
          headers: {
            'Content-Type': 'application/vnd.apple.pkpass',
            'Content-Disposition': `attachment; filename="${pass.filename}"`,
            'Cache-Control': 'private, no-store',
          },
        })
      },
    },
  },
})
