/**
 * PM2 Ecosystem File — Production clustering configuration.
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 restart agentpay
 *   pm2 logs agentpay
 *
 * PRODUCTION FIX — ADDED BY COPILOT
 */

module.exports = {
  apps: [
    {
      name: 'agentpay',
      script: 'dist/server.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3001,
      },
      max_memory_restart: '512M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/agentpay-error.log',
      out_file: './logs/agentpay-out.log',
      merge_logs: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};
