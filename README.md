Welcome to your new TanStack Start app! 

# Getting Started

To run this application:

```bash
npm install
npm run dev
```

# Building For Production

To build this application for production:

```bash
npm run build
```

## Testing

This project uses [Vitest](https://vitest.dev/) for testing. You can run the tests with:

```bash
npm run test
```

## Styling

This project uses [Tailwind CSS](https://tailwindcss.com/) for styling.

### Removing Tailwind CSS

If you prefer not to use Tailwind CSS:

1. Remove the demo pages in `src/routes/demo/`
2. Replace the Tailwind import in `src/styles.css` with your own styles
3. Remove `tailwindcss()` from the plugins array in `vite.config.ts`
4. Uninstall the packages: `npm install @tailwindcss/vite tailwindcss -D`

## Linting & Formatting


This project uses [eslint](https://eslint.org/) and [prettier](https://prettier.io/) for linting and formatting. Eslint is configured using [tanstack/eslint-config](https://tanstack.com/config/latest/docs/eslint). The following scripts are available:

```bash
npm run lint
npm run format
npm run check
```


## Deploy with Nitro

This project uses Nitro as a generic server adapter, so it can run on any Node-compatible host.

```bash
npm run build
node dist/server/index.mjs
```

The build output is a self-contained Node server. To deploy, push the `dist/` directory to your host (Render, Fly.io, your own VPS, etc.) and run the server command above.

For host-specific presets (Vercel, Netlify, Cloudflare, AWS Lambda, etc.) and tuning, see https://v3.nitro.build/deploy.


## Deployment (Ticketio)

Production runs on a VM behind HAProxy/OPNsense, managed by PM2, deployed from
GitHub via webhook. Per `CLAUDE.md`, the PM2 ecosystem config and the real
secrets file live **on the VM, not in this repo** — sample templates are in
[`docs/deploy/`](docs/deploy/).

### Build

```bash
git pull origin main
npm ci
npm run generate-routes           # regenerate the route tree
NODE_OPTIONS="--max-old-space-size=4096" npm run build
```

- **`NODE_OPTIONS="--max-old-space-size=4096"` is required for the build** — the
  SSR bundle (pdf-lib, node-forge, jsQR, …) exhausts the default heap otherwise.
- Delete stale build artifacts before building (`rm -rf .output`).
- The build output is a self-contained Node server at `.output/server/index.mjs`.

### Run (PM2)

```bash
pm2 start ~/ecosystem.config.cjs      # sample: docs/deploy/ecosystem.config.cjs
pm2 save
```

The server reads secrets from `~/ticketio-secrets.env` (sample:
[`docs/deploy/ticketio-secrets.env.example`](docs/deploy/ticketio-secrets.env.example)).

### Database migrations

```bash
npx supabase db push       # apply pending migrations to the linked project
```

Apply migrations **before** restarting the app when a release adds columns/tables.
The app degrades gracefully for a short pre-migration window (tolerant writes),
but new features stay inert until their migration lands.

### Environment checklist

Full annotated list in `.env.example` and
[`docs/deploy/ticketio-secrets.env.example`](docs/deploy/ticketio-secrets.env.example).
Minimum for a working production deploy:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Database / auth. Service role is server-only. |
| `APP_URL` | Public base URL (return/webhook URLs, email links). No trailing slash. |
| `VITE_SITE_URL` | Canonical public URL baked into SEO tags, sitemap, OG images. **Build-time** — set before `npm run build`. |
| `CRON_SECRET` | Guards the internal `/api/cron/*` worker endpoints. Must match `app_settings.cron_secret`. |
| `GOPAY_GOID`, `GOPAY_CLIENT_ID`, `GOPAY_CLIENT_SECRET`, `GOPAY_ENV` | Payments. `GOPAY_ENV=production` for live. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Transactional email. `EMAIL_FROM` must be on a Resend-verified domain (SPF/DKIM/DMARC). |
| `FAKTERO_API_KEY`, `FAKTERO_API_URL` | Commission invoicing (optional — logs if unset). |
| `APPLE_*`, `GOOGLE_WALLET_*` | Wallet passes (optional — buttons hidden if unset). |

Supabase vars also accept a `TICKETIO_`-prefixed alias (Lovable sandbox); plain
names take precedence.

### Cron workers (`app_settings` + pg_cron)

Every-minute pg_cron ticks ping the app's worker endpoints via `pg_net`, but only
if the endpoint URL is configured. Seed these rows in the `app_settings` table
(server-only, service role). Each `*_endpoint` is `${APP_URL}` + the path below;
all share `cron_secret` (must equal the `CRON_SECRET` env var):

| `app_settings.key` | Endpoint path | Worker |
| --- | --- | --- |
| `cron_secret` | — | Shared secret sent as `x-cron-secret`. |
| `cron_endpoint` | `/api/cron/process-refunds` | Refund queue |
| `email_cron_endpoint` | `/api/cron/process-email` | Email queue (reminders, bulk, tickets) |
| `invoice_cron_endpoint` | `/api/cron/issue-invoices` | Commission invoices |
| `waitlist_cron_endpoint` | `/api/cron/process-waitlist` | Waitlist notifications |
| `webhook_cron_endpoint` | `/api/cron/process-webhooks` | Outgoing webhook deliveries |

Until an endpoint is set, its tick is a safe no-op. Example:

```sql
insert into app_settings (key, value) values
  ('cron_secret', '<same as CRON_SECRET>'),
  ('cron_endpoint',          'https://ticketio.sk/api/cron/process-refunds'),
  ('email_cron_endpoint',    'https://ticketio.sk/api/cron/process-email'),
  ('invoice_cron_endpoint',  'https://ticketio.sk/api/cron/issue-invoices'),
  ('waitlist_cron_endpoint', 'https://ticketio.sk/api/cron/process-waitlist'),
  ('webhook_cron_endpoint',  'https://ticketio.sk/api/cron/process-webhooks')
on conflict (key) do update set value = excluded.value;
```

### Health & monitoring

- `GET /api/health` → `{ status: "ok", db: true }` for uptime checks (never 500s;
  reports `db:false` when the DB is unreachable).
- Security headers (CSP, HSTS, …) are emitted by the app; the `/e/*/embed` route
  intentionally relaxes `frame-ancestors` so the widget stays iframeable.


## Routing

This project uses [TanStack Router](https://tanstack.com/router) with file-based routing. Routes are managed as files in `src/routes`.

### Adding A Route

To add a new route to your application just add a new file in the `./src/routes` directory.

TanStack will automatically generate the content of the route file for you.

Now that you have two routes you can use a `Link` component to navigate between them.

### Adding Links

To use SPA (Single Page Application) navigation you will need to import the `Link` component from `@tanstack/react-router`.

```tsx
import { Link } from "@tanstack/react-router";
```

Then anywhere in your JSX you can use it like so:

```tsx
<Link to="/about">About</Link>
```

This will create a link that will navigate to the `/about` route.

More information on the `Link` component can be found in the [Link documentation](https://tanstack.com/router/v1/docs/framework/react/api/router/linkComponent).

### Using A Layout

In the File Based Routing setup the layout is located in `src/routes/__root.tsx`. Anything you add to the root route will appear in all the routes. The route content will appear in the JSX where you render `{children}` in the `shellComponent`.

Here is an example layout that includes a header:

```tsx
import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'My App' },
    ],
  }),
  shellComponent: ({ children }) => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <header>
          <nav>
            <Link to="/">Home</Link>
            <Link to="/about">About</Link>
          </nav>
        </header>
        {children}
        <Scripts />
      </body>
    </html>
  ),
})
```

More information on layouts can be found in the [Layouts documentation](https://tanstack.com/router/latest/docs/framework/react/guide/routing-concepts#layouts).

## Server Functions

TanStack Start provides server functions that allow you to write server-side code that seamlessly integrates with your client components.

```tsx
import { createServerFn } from '@tanstack/react-start'

const getServerTime = createServerFn({
  method: 'GET',
}).handler(async () => {
  return new Date().toISOString()
})

// Use in a component
function MyComponent() {
  const [time, setTime] = useState('')
  
  useEffect(() => {
    getServerTime().then(setTime)
  }, [])
  
  return <div>Server time: {time}</div>
}
```

## API Routes

You can create API routes by using the `server` property in your route definitions:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

export const Route = createFileRoute('/api/hello')({
  server: {
    handlers: {
      GET: () => json({ message: 'Hello, World!' }),
    },
  },
})
```

## Data Fetching

There are multiple ways to fetch data in your application. You can use TanStack Query to fetch data from a server. But you can also use the `loader` functionality built into TanStack Router to load the data for a route before it's rendered.

For example:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/people')({
  loader: async () => {
    const response = await fetch('https://swapi.dev/api/people')
    return response.json()
  },
  component: PeopleComponent,
})

function PeopleComponent() {
  const data = Route.useLoaderData()
  return (
    <ul>
      {data.results.map((person) => (
        <li key={person.name}>{person.name}</li>
      ))}
    </ul>
  )
}
```

Loaders simplify your data fetching logic dramatically. Check out more information in the [Loader documentation](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading#loader-parameters).

# Demo files

Files prefixed with `demo` can be safely deleted. They are there to provide a starting point for you to play around with the features you've installed.

# Learn More

You can learn more about all of the offerings from TanStack in the [TanStack documentation](https://tanstack.com).

For TanStack Start specific documentation, visit [TanStack Start](https://tanstack.com/start).

# E-mail (Resend) — doména a doručiteľnosť

Transakčné e-maily posiela Resend (`RESEND_API_KEY`, `EMAIL_FROM`). Bez API kľúča
sa e-maily iba logujú do konzoly (dev). `EMAIL_FROM` musí byť adresa na doméne
overenej v Resende.

Odporúčaná odosielacia subdoména: `mail.ticketio.sk` (napr.
`EMAIL_FROM="Ticketio <noreply@mail.ticketio.sk>"`).

DNS pre doručiteľnosť (hodnoty vygeneruje Resend pri „Add Domain"):

- **SPF** (TXT na `mail.ticketio.sk`): `v=spf1 include:amazonses.com ~all`
  (Resend používa Amazon SES; presný include potvrdí Resend).
- **DKIM** (3× CNAME `resend._domainkey…` → hodnoty z Resendu). Podpisuje e-maily.
- **DMARC** (TXT na `_dmarc.ticketio.sk`): začni s
  `v=DMARC1; p=none; rua=mailto:dmarc@ticketio.sk`, po odladení sprísni na
  `p=quarantine`/`p=reject`.
- **Return-Path / MAIL FROM** (voliteľne CNAME `send.mail.ticketio.sk`) pre
  zarovnanie SPF.

Po pridaní DNS počkaj na overenie domény v Resende, potom otestuj doručiteľnosť
(napr. mail-tester.com) — cieľ je SPF+DKIM+DMARC „pass".
