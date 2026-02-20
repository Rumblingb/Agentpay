# x402 Payment Server - Deployment Guide

## Pre-Deployment Checklist

### Security Review
- [ ] Recipient address verification enabled
- [ ] API keys are hashed with salt
- [ ] Rate limiting configured
- [ ] CORS properly configured
- [ ] Helmet security headers enabled
- [ ] Environment variables set (no hardcoded secrets)
- [ ] Database SSL enabled in production
- [ ] Logs configured properly

### Testing
- [ ] All tests passing (17+)
- [ ] Security tests passing
- [ ] Load tests performed
- [ ] End-to-end flow tested on testnet
- [ ] Backup/recovery procedures tested

### Infrastructure
- [ ] PostgreSQL 12+ installed
- [ ] Node.js 20+ installed
- [ ] Domain configured
- [ ] SSL certificate obtained
- [ ] Reverse proxy configured (Nginx/Apache)
- [ ] PM2 or systemd configured

## Detailed Deployment Steps

### 1. Production Environment Setup

```bash
# Clone repository
git clone <your-repo> /var/www/agentpay
cd /var/www/agentpay

# Install dependencies
npm install --production

# Build TypeScript
npm run build

# Create .env.production with production values
cat > .env.production << EOF
PORT=3000
NODE_ENV=production
LOG_LEVEL=warn

DATABASE_URL=postgres://user:password@prod-db:5432/agentpay_prod
DB_HOST=prod-db
DB_PORT=5432
DB_NAME=agentpay_prod
DB_USER=agentpay
DB_PASSWORD=<STRONG_PASSWORD>

SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_NETWORK=mainnet-beta
USDC_MINT=EPjFWaLb3odcccccccccccccccccccccccccccccccc

CONFIRMATION_DEPTH=10
PAYMENT_EXPIRY_MINUTES=30

API_KEY_LENGTH=32
JWT_SECRET=<STRONG_SECRET>
SALT_ROUNDS=12
CORS_ORIGIN=https://yourdomain.com

RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
EOF
```

### 2. Database Setup

```bash
# Create database
createdb agentpay_prod -U postgres

# Initialize schema
NODE_ENV=production node dist/db/init.js

# Verify tables
psql agentpay_prod -c "\dt"
```

### 3. PM2 Process Manager

```bash
# Install PM2
npm install -g pm2

# Create ecosystem.config.js
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'x402-payment-server',
    script: './dist/server.js',
    instances: 4,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    max_memory_restart: '1G',
    max_restarts: 10,
    min_uptime: '10s',
    autorestart: true,
    watch: false
  }]
};
EOF

# Start with PM2
pm2 start ecosystem.config.js

# Setup auto-restart on reboot
pm2 startup
pm2 save
```

### 4. Nginx Reverse Proxy

```nginx
upstream x402_backend {
  server localhost:3000;
  server localhost:3001;
  server localhost:3002;
  server localhost:3003;
  keepalive 32;
}

server {
  listen 80;
  server_name api.yourdomain.com;
  
  # Redirect to HTTPS
  return 301 https://$server_name$request_uri;
}

server {
  listen 443 ssl http2;
  server_name api.yourdomain.com;
  
  # SSL Certificates
  ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;
  
  # Security headers
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Frame-Options "DENY" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-XSS-Protection "1; mode=block" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  
  # Rate limiting
  limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
  limit_req zone=api_limit burst=20 nodelay;
  
  location / {
    proxy_pass http://x402_backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_request_buffering off;
  }
  
  # Monitor endpoint
  location /health {
    access_log off;
    proxy_pass http://x402_backend;
  }
}
```

### 5. SSL Certificate with Let's Encrypt

```bash
# Install certbot
apt-get install certbot python3-certbot-nginx

# Obtain certificate
certbot certonly --nginx -d api.yourdomain.com

# Auto-renewal
certbot renew --dry-run
```

### 6. Monitoring & Logging

```bash
# Create log rotation config
cat > /etc/logrotate.d/x402-payment-server << EOF
/var/www/agentpay/logs/*.log {
  daily
  missingok
  rotate 30
  compress
  delaycompress
  notifempty
  create 0640 www-data www-data
  sharedscripts
  postrotate
    pm2 kill
    pm2 start ecosystem.config.js --env production
  endscript
}
EOF
```

### 7. Database Backups

```bash
# Create backup script
cat > /usr/local/bin/backup-agentpay.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/backups/agentpay"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/agentpay_$DATE.sql.gz"

mkdir -p $BACKUP_DIR

pg_dump agentpay_prod | gzip > $BACKUP_FILE

# Keep only last 30 days
find $BACKUP_DIR -name "agentpay_*.sql.gz" -mtime +30 -delete

echo "Backup completed: $BACKUP_FILE"
EOF

chmod +x /usr/local/bin/backup-agentpay.sh

# Add to crontab (daily at 2 AM)
crontab -e
# Add: 0 2 * * * /usr/local/bin/backup-agentpay.sh
```

### 8. Monitoring & Alerts

```bash
# Using Prometheus and Node Exporter for monitoring
# Add metrics endpoint to src/server.ts for Prometheus

# Create Grafana dashboard for:
# - Request latency (target: <100ms)
# - Error rates
# - Payment verification success rate
# - Database connection pool utilization
# - API key usage per merchant
# - Transaction volume per hour
```

## Post-Deployment

### Verification Checklist

```bash
# 1. Check server health
curl https://api.yourdomain.com/health

# 2. Test registration
curl -X POST https://api.yourdomain.com/api/merchants/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Merchant",
    "email": "test@example.com",
    "walletAddress": "9B5X2FWc4PQHqbXkhmr8vgYKHjgP7V8HBzMgMTf8Hkqo"
  }'

# 3. Verify database connection
psql agentpay_prod -c "SELECT COUNT(*) FROM merchants;"

# 4. Check PM2 logs
pm2 logs

# 5. Monitor Nginx
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

### Security Hardening

```bash
# 1. Firewall rules
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw allow 5432/tcp  # PostgreSQL (from app server only)
ufw enable

# 2. Fail2ban for brute force protection
apt-get install fail2ban

# 3. Automatic security updates
apt-get install unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades

# 4. SSH hardening
# Edit /etc/ssh/sshd_config:
# - PermitRootLogin no
# - PasswordAuthentication no
# - PubkeyAuthentication yes
```

## Disaster Recovery

### Database Recovery

```bash
# List available backups
ls -la /backups/agentpay/

# Restore from backup
gunzip < /backups/agentpay/agentpay_20240216_120000.sql.gz | \
  psql agentpay_prod

# Verify recovery
psql agentpay_prod -c "SELECT COUNT(*) FROM merchants;"
```

### Failover Procedures

1. **Database Failover**
   ```bash
   # Switch to replica
   pg_ctl promote -D /var/lib/postgresql/replica_data
   ```

2. **Application Failover**
   ```bash
   # Load balancer automatically reroutes to healthy instances
   # PM2 clustering handles node failures
   pm2 restart all
   ```

## Week 1 Production Readiness

Before moving to Week 2:

- [ ] Production environment deployed
- [ ] Custom domain configured
- [ ] SSL certificate installed
- [ ] Real transaction processed successfully
- [ ] Monitoring configured and alerting working
- [ ] Database backups running
- [ ] All tests passing in production
- [ ] Security audit completed
- [ ] Performance benchmarks documented
- [ ] Support email configured and monitored

---

**Once all items checked, proceed to Week 2: Advanced Features & Scale**
