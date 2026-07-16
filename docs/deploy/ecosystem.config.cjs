/**
 * SAMPLE PM2 ecosystem config for Ticketio.
 *
 * Per CLAUDE.md the REAL file lives on the VM at ~/ecosystem.config.cjs and is
 * NOT committed. Copy this template there and adjust paths. Secrets are loaded
 * from ~/ticketio-secrets.env (see ticketio-secrets.env.example) via node
 * --env-file, NOT inlined here.
 *
 * Start:   pm2 start ~/ecosystem.config.cjs && pm2 save
 * Logs:    pm2 logs ticketio
 * Restart: pm2 restart ticketio     (only after cron/import locks are clear)
 */

module.exports = {
  apps: [
    {
      name: 'ticketio',
      // The Nitro build output (see README "Deployment" → Build).
      script: '.output/server/index.mjs',
      cwd: '/opt/ticketio/app',
      // Load secrets from the env file kept outside the repo.
      node_args: '--env-file=/root/ticketio-secrets.env',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        // The HTTP port Nitro listens on; HAProxy proxies ticketio.sk -> here.
        PORT: '3000',
        HOST: '127.0.0.1',
      },
      max_memory_restart: '1G',
      autorestart: true,
      // Give the app time to boot before health checks / restarts.
      min_uptime: '10s',
      max_restarts: 10,
      merge_logs: true,
      time: true,
    },
  ],
}
