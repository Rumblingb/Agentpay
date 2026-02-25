# Agentpay V1 - Production Setup Guide

This guide will help you set up Agentpay V1 in a production environment.

## Prerequisites

- **Node.js**: 20.0.0 or higher
- **PostgreSQL**: 12 or higher (or use a managed database like Supabase, Render, Railway)
- **Solana RPC**: Access to Solana mainnet or devnet RPC endpoint
- **Server**: Linux server with at least 1GB RAM (2GB+ recommended)

## Quick Production Deployment Checklist

- [ ] Set up PostgreSQL database
- [ ] Configure environment variables
- [ ] Initialize database schema
- [ ] Build TypeScript code
- [ ] Set up process manager (PM2)
- [ ] Configure reverse proxy (Nginx)
- [ ] Set up SSL/TLS certificates
- [ ] Configure firewall
- [ ] Set up monitoring and logging
- [ ] Test all endpoints
- [ ] Set up backup strategy

---

## Step 1: Database Setup

### Option A: Using a Managed Database (Recommended)

**Supabase (Free Tier Available):**
1. Create account at https://supabase.com
2. Create a new project
3. Copy the connection string (DATABASE_URL)
4. Note: Supabase provides automatic backups

**Render PostgreSQL:**
1. Create account at https://render.com
2. Create a new PostgreSQL instance
3. Copy the connection string

**Railway:**
1. Create account at https://railway.app
2. Add PostgreSQL plugin
3. Copy the connection string

### Option B: Self-Hosted PostgreSQL

```bash
# Install PostgreSQL
sudo apt update
sudo apt install postgresql postgresql-contrib

# Create database and user
sudo -u postgres psql
CREATE DATABASE agentpay_production;
CREATE USER agentpay WITH ENCRYPTED PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE agentpay_production TO agentpay;
\q
```

---

## Step 2: Environment Configuration

Create a `.env` file in the project root:

```bash
# Server Configuration
PORT=3001
NODE_ENV=production
LOG_LEVEL=info

# Database (Use your actual database connection string)
DATABASE_URL=postgresql://username:password@host:5432/database

# Solana Configuration
# For mainnet: https://api.mainnet-beta.solana.com
# For devnet: https://api.devnet.solana.com
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_NETWORK=mainnet-beta
CONFIRMATION_DEPTH=2

# Payment Settings
PAYMENT_EXPIRY_MINUTES=30

# Security Configuration
# Add your frontend domain
CORS_ORIGIN=https://yourdomain.com
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Webhook Configuration
# Generate a secure random string (32+ characters)
WEBHOOK_SECRET=$(openssl rand -hex 32)
```

### Generate Secure Webhook Secret

```bash
# Generate a secure random secret
openssl rand -hex 32
```

---

## Step 3: Install Dependencies and Build

```bash
# Clone repository (if not already done)
git clone https://github.com/Rumblingb/Agentpay.git
cd Agentpay

# Install dependencies
npm install

# Build TypeScript code
npm run build

# Verify build succeeded
ls -la dist/
```

---

## Step 4: Initialize Database

```bash
# Create database tables
npm run db:create

# Run migrations
npm run db:migrate

# Verify tables were created
# Connect to your database and check:
psql $DATABASE_URL -c "\dt"
```

Expected tables:
- merchants
- transactions
- api_logs
- rate_limit_counters
- payment_verifications
- webhook_events
- payment_audit_log

---

## Step 5: Test the Application

```bash
# Start the server in production mode
NODE_ENV=production npm start

# In another terminal, test health endpoint
curl http://localhost:3001/health

# Expected response:
# {"status":"active","timestamp":"2024-XX-XXTXX:XX:XX.XXXZ"}
```

---

## Step 6: Set Up Process Manager (PM2)

PM2 ensures your application stays running and automatically restarts on failure.

```bash
# Install PM2 globally
npm install -g pm2

# Start application with PM2
pm2 start dist/server.js --name agentpay \
  --instances 2 \
  --exec-mode cluster \
  --max-memory-restart 1G

# Save PM2 configuration
pm2 save

# Set up PM2 to start on system boot
pm2 startup
# Follow the instructions provided

# Monitor application
pm2 status
pm2 logs agentpay
pm2 monit
```

### PM2 Commands

```bash
pm2 list              # List all processes
pm2 logs agentpay     # View logs
pm2 restart agentpay  # Restart application
pm2 stop agentpay     # Stop application
pm2 delete agentpay   # Remove from PM2
```

---

## Step 7: Configure Nginx Reverse Proxy

### Install Nginx

```bash
sudo apt update
sudo apt install nginx
```

### Configure Nginx

Create `/etc/nginx/sites-available/agentpay`:

```nginx
upstream agentpay_backend {
    least_conn;
    server localhost:3001;
}

server {
    listen 80;
    server_name yourdomain.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    # SSL Configuration (will be filled by Certbot)
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # SSL Security Settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Increase timeouts for blockchain verification
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;

    # Request size limits
    client_max_body_size 10M;

    location / {
        proxy_pass http://agentpay_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Health check endpoint
    location /health {
        proxy_pass http://agentpay_backend;
        access_log off;
    }
}
```

### Enable Configuration

```bash
# Create symbolic link
sudo ln -s /etc/nginx/sites-available/agentpay /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

---

## Step 8: Set Up SSL/TLS with Let's Encrypt

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Obtain SSL certificate
sudo certbot --nginx -d yourdomain.com

# Certbot will automatically:
# 1. Obtain certificate
# 2. Update Nginx configuration
# 3. Set up automatic renewal

# Test automatic renewal
sudo certbot renew --dry-run
```

---

## Step 9: Configure Firewall

```bash
# Install UFW (if not already installed)
sudo apt install ufw

# Allow SSH (IMPORTANT: Do this first!)
sudo ufw allow 22/tcp

# Allow HTTP and HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status
```

---

## Step 10: Set Up Monitoring and Logging

### Log Rotation

Create `/etc/logrotate.d/agentpay`:

```
/home/your-user/.pm2/logs/agentpay-*.log {
    daily
    rotate 14
    compress
    delaycompress
    notifempty
    missingok
    create 0644 your-user your-user
}
```

### Monitor Disk Space

```bash
# Check disk usage
df -h

# Check large files
sudo du -sh /var/log/*
```

### Set Up Basic Monitoring Script

Create `/home/your-user/monitor-agentpay.sh`:

```bash
#!/bin/bash

# Check if application is running
if ! pm2 list | grep -q "agentpay.*online"; then
    echo "$(date): AgentPay is not running! Restarting..." >> /var/log/agentpay-monitor.log
    pm2 restart agentpay
fi

# Check health endpoint
HEALTH=$(curl -s http://localhost:3001/health | grep -c "active")
if [ "$HEALTH" -eq 0 ]; then
    echo "$(date): Health check failed! Restarting..." >> /var/log/agentpay-monitor.log
    pm2 restart agentpay
fi
```

Add to crontab:

```bash
chmod +x /home/your-user/monitor-agentpay.sh

# Edit crontab
crontab -e

# Add this line to check every 5 minutes:
*/5 * * * * /home/your-user/monitor-agentpay.sh
```

---

## Step 11: Database Backup Strategy

### Automated PostgreSQL Backups

Create `/home/your-user/backup-db.sh`:

```bash
#!/bin/bash

BACKUP_DIR="/home/your-user/backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/agentpay_backup_$DATE.sql"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Perform backup
pg_dump "$DATABASE_URL" > "$BACKUP_FILE"

# Compress backup
gzip "$BACKUP_FILE"

# Delete backups older than 30 days
find "$BACKUP_DIR" -name "agentpay_backup_*.sql.gz" -mtime +30 -delete

echo "$(date): Backup completed: $BACKUP_FILE.gz" >> /var/log/agentpay-backup.log
```

Make executable and add to crontab:

```bash
chmod +x /home/your-user/backup-db.sh

# Edit crontab
crontab -e

# Add this line for daily backups at 2 AM:
0 2 * * * /home/your-user/backup-db.sh
```

---

## Step 12: Security Hardening

### 1. Secure SSH

Edit `/etc/ssh/sshd_config`:

```
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
```

Restart SSH:

```bash
sudo systemctl restart sshd
```

### 2. Install Fail2Ban

```bash
# Install fail2ban
sudo apt install fail2ban

# Enable and start
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

### 3. Enable Automatic Security Updates

```bash
sudo apt install unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

### 4. Secure Environment Variables

```bash
# Ensure .env file has proper permissions
chmod 600 .env

# Add .env to .gitignore (already done)
```

---

## Step 13: Testing in Production

### Test All Endpoints

```bash
# 1. Health check
curl https://yourdomain.com/health

# 2. Register a merchant
curl -X POST https://yourdomain.com/api/merchants/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Merchant",
    "email": "test@example.com",
    "walletAddress": "YOUR_SOLANA_WALLET"
  }'

# Save the returned API key

# 3. Get merchant profile
curl https://yourdomain.com/api/merchants/profile \
  -H "Authorization: Bearer YOUR_API_KEY"

# 4. Create payment request
curl -X POST https://yourdomain.com/api/merchants/payments \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 1.00,
    "metadata": {"test": true}
  }'

# 5. Test rate limiting (make 101 requests quickly)
for i in {1..101}; do
  curl https://yourdomain.com/health
done
# Should see 429 Too Many Requests after 100 requests
```

---

## Step 14: Performance Optimization

### 1. Database Optimization

```sql
-- Check for missing indexes
SELECT schemaname, tablename, attname, n_distinct, correlation
FROM pg_stats
WHERE schemaname = 'public'
ORDER BY abs(correlation) DESC;

-- Vacuum and analyze regularly
VACUUM ANALYZE;
```

### 2. Node.js Performance

```bash
# Use cluster mode with PM2 (already configured)
pm2 start dist/server.js --instances max

# Monitor memory usage
pm2 monit

# Set memory limit per process
pm2 start dist/server.js --max-memory-restart 1G
```

---

## Monitoring Checklist

Daily:
- [ ] Check PM2 status: `pm2 status`
- [ ] Check logs: `pm2 logs agentpay --lines 100`
- [ ] Check disk space: `df -h`

Weekly:
- [ ] Review error logs
- [ ] Check database size: `psql $DATABASE_URL -c "SELECT pg_size_pretty(pg_database_size('your_db'));"`
- [ ] Review API usage patterns
- [ ] Check SSL certificate expiry

Monthly:
- [ ] Review and update dependencies: `npm audit`
- [ ] Test backup restoration
- [ ] Review security logs
- [ ] Check for Node.js updates

---

## Troubleshooting

### Application Won't Start

```bash
# Check logs
pm2 logs agentpay

# Check environment variables
pm2 env 0

# Rebuild application
npm run build

# Restart PM2
pm2 restart all
```

### Database Connection Issues

```bash
# Test database connection
psql $DATABASE_URL -c "SELECT 1;"

# Check if tables exist
psql $DATABASE_URL -c "\dt"

# Re-initialize database
npm run db:create
npm run db:migrate
```

### High Memory Usage

```bash
# Check memory usage
pm2 monit

# Reduce number of instances
pm2 scale agentpay 2

# Set memory limit
pm2 restart agentpay --max-memory-restart 500M
```

### SSL Certificate Issues

```bash
# Check certificate status
sudo certbot certificates

# Renew certificate manually
sudo certbot renew

# Restart Nginx
sudo systemctl restart nginx
```

---

## Support and Resources

- **Documentation**: See README.md, DEPLOYMENT.md, START_HERE.md
- **Issues**: https://github.com/Rumblingb/Agentpay/issues
- **Solana Docs**: https://docs.solana.com
- **PM2 Docs**: https://pm2.keymetrics.io/docs
- **Nginx Docs**: https://nginx.org/en/docs/

---

## Production Deployment Checklist

Before going live, ensure you have:

- [x] All tests passing (`npm test`)
- [x] Production database set up
- [x] Environment variables configured
- [x] Database schema initialized
- [x] Application built (`npm run build`)
- [x] PM2 process manager configured
- [x] Nginx reverse proxy set up
- [x] SSL/TLS certificates installed
- [x] Firewall configured
- [x] Monitoring scripts set up
- [x] Backup strategy implemented
- [x] All endpoints tested
- [x] Rate limiting verified
- [x] Security headers configured
- [x] Log rotation configured
- [x] Error alerting set up

**Your Agentpay V1 is now production-ready! 🚀**
