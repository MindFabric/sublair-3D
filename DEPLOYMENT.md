# DigitalOcean Droplet Deployment Guide

## Overview
This guide will help you deploy the entire Sublair 3D application (frontend, backend, RTMP server, WebSocket) on a single DigitalOcean droplet.

## Step 1: Create DigitalOcean Droplet

### Recommended Specs:
- **Size:** Basic ($12/month) or Regular ($18/month)
- **RAM:** 2GB minimum (4GB recommended for streaming)
- **CPU:** 2 vCPUs
- **Storage:** 50GB SSD
- **OS:** Ubuntu 22.04 LTS

### Steps:
1. Go to [DigitalOcean](https://digitalocean.com)
2. Click "Create" → "Droplets"
3. Choose Ubuntu 22.04 LTS
4. Select droplet size (2GB RAM minimum)
5. Add SSH key (or use password)
6. Choose datacenter region (closest to your users)
7. Click "Create Droplet"

**Note the droplet's IP address** (e.g., `164.92.123.45`)

---

## Step 2: Configure DNS

Point your domain to the droplet:

1. Go to your domain registrar (Cloudflare, Namecheap, etc.)
2. Add an **A record**:
   ```
   Type: A
   Name: 3d
   Value: YOUR_DROPLET_IP (e.g., 164.92.123.45)
   TTL: Auto or 300
   ```

This will make `3d.sublair.com` point to your droplet.

**Wait 5-10 minutes for DNS propagation.**

---

## Step 3: Connect to Droplet

```bash
ssh root@YOUR_DROPLET_IP
```

Or if using SSH key:
```bash
ssh -i ~/.ssh/your_key root@YOUR_DROPLET_IP
```

---

## Step 4: Install Dependencies

```bash
# Update system
apt update && apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# Install build tools
apt install -y build-essential git nginx certbot python3-certbot-nginx

# Install ffmpeg (required for RTMP transcoding)
apt install -y ffmpeg

# Verify installations
node --version  # Should show v18.x
npm --version
ffmpeg -version
```

---

## Step 5: Clone and Setup Project

```bash
# Create app directory
mkdir -p /var/www
cd /var/www

# Clone your repository
git clone https://github.com/YOUR_USERNAME/sublair-3D.git
cd sublair-3D

# Install dependencies
npm install

# Build the frontend
export NODE_OPTIONS=--openssl-legacy-provider
npm run build
```

---

## Step 6: Configure Environment Variables

```bash
# Create .env file
nano .env
```

Add your environment variables:
```env
NODE_ENV=production
PORT=3000
RTMP_PORT=1935

# Firebase credentials
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-client-email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_DATABASE_URL=https://your-project.firebaseio.com
FIREBASE_API_KEY=your-api-key

# Add any other environment variables from .env.example
```

Save and exit (Ctrl+X, Y, Enter)

---

## Step 7: Configure Firewall

```bash
# Allow SSH, HTTP, HTTPS, RTMP, and HTTP-FLV
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw allow 3000/tcp  # Node.js app
ufw allow 1935/tcp  # RTMP
ufw allow 8888/tcp  # HTTP-FLV
ufw enable

# Check status
ufw status
```

---

## Step 8: Setup Nginx Reverse Proxy

```bash
# Create nginx configuration
nano /etc/nginx/sites-available/sublair3d
```

Add this configuration:
```nginx
# HTTP server (redirects to HTTPS)
server {
    listen 80;
    server_name 3d.sublair.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

# HTTPS server
server {
    listen 443 ssl http2;
    server_name 3d.sublair.com;

    # SSL certificates (will be added by Certbot)
    ssl_certificate /etc/letsencrypt/live/3d.sublair.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/3d.sublair.com/privkey.pem;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    # Serve static files
    location / {
        root /var/www/sublair-3D;
        try_files $uri $uri/ /index.html;

        # Cache static assets
        location ~* \.(jpg|jpeg|png|gif|ico|css|js|woff|woff2|ttf|svg)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    # Proxy API requests to Node.js
    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket support
    location /ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Proxy HTTP-FLV streams
    location /live {
        proxy_pass http://localhost:8888;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        add_header Access-Control-Allow-Origin *;
    }
}

# RTMP stats page (optional, for debugging)
server {
    listen 8080;
    server_name localhost;

    location /stat {
        proxy_pass http://localhost:8888/stat;
    }
}
```

Enable the site:
```bash
# Create symlink
ln -s /etc/nginx/sites-available/sublair3d /etc/nginx/sites-enabled/

# Remove default site
rm /etc/nginx/sites-enabled/default

# Test nginx configuration
nginx -t

# Don't reload yet (SSL not configured)
```

---

## Step 9: Setup SSL with Let's Encrypt

```bash
# Get SSL certificate
certbot --nginx -d 3d.sublair.com

# Follow the prompts:
# - Enter your email
# - Agree to terms
# - Choose to redirect HTTP to HTTPS (option 2)

# Certbot will automatically update your nginx config

# Test auto-renewal
certbot renew --dry-run

# Reload nginx
systemctl reload nginx
```

---

## Step 10: Create Systemd Service (Auto-restart)

```bash
# Create service file
nano /etc/systemd/system/sublair3d.service
```

Add this configuration:
```ini
[Unit]
Description=Sublair 3D Node.js Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/var/www/sublair-3D
Environment=NODE_ENV=production
Environment=NODE_OPTIONS=--openssl-legacy-provider
ExecStart=/usr/bin/node api/server.js
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=sublair3d

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
# Reload systemd
systemctl daemon-reload

# Enable service (start on boot)
systemctl enable sublair3d

# Start service
systemctl start sublair3d

# Check status
systemctl status sublair3d

# View logs
journalctl -u sublair3d -f
```

---

## Step 11: Test Everything

### Test HTTP/HTTPS:
```bash
curl http://3d.sublair.com
curl https://3d.sublair.com
```

### Test RTMP Port:
```bash
# From another machine
telnet 3d.sublair.com 1935
```

### Test WebSocket:
Open browser console on `https://3d.sublair.com` and check for WebSocket connection.

### Test OBS Streaming:
**OBS Settings:**
```
Server: rtmp://3d.sublair.com:1935/live
Stream Key: 1nq48Otp4TIKUcguYQ9BFgmCZB4cQT7D
```

Click "Start Streaming" in OBS.

---

## Step 12: Monitor and Maintain

### View application logs:
```bash
journalctl -u sublair3d -f
```

### View nginx logs:
```bash
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

### Restart services:
```bash
systemctl restart sublair3d  # Restart Node.js
systemctl restart nginx      # Restart Nginx
```

### Update application:
```bash
cd /var/www/sublair-3D
git pull origin master
npm install
export NODE_OPTIONS=--openssl-legacy-provider
npm run build
systemctl restart sublair3d
```

---

## Port Summary

| Service | Port | Protocol | Purpose |
|---------|------|----------|---------|
| Nginx (HTTP) | 80 | TCP | Redirect to HTTPS |
| Nginx (HTTPS) | 443 | TCP | Main website |
| Node.js | 3000 | TCP | API + WebSocket |
| RTMP | 1935 | TCP | OBS streaming input |
| HTTP-FLV | 8888 | TCP | Stream playback |

---

## Troubleshooting

### Service won't start:
```bash
# Check logs
journalctl -u sublair3d -n 50

# Check if port is in use
netstat -tlnp | grep 3000
```

### RTMP not working:
```bash
# Check if RTMP server is running
netstat -tlnp | grep 1935

# Check firewall
ufw status
```

### SSL not working:
```bash
# Renew certificate
certbot renew --force-renewal

# Check nginx config
nginx -t
```

### Can't connect to droplet:
```bash
# Check if nginx is running
systemctl status nginx

# Check if node app is running
systemctl status sublair3d
```

---

## Performance Optimization (Optional)

### Enable gzip compression in Nginx:
Add to nginx config in `server` block:
```nginx
gzip on;
gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
gzip_min_length 256;
```

### Setup PM2 for better process management:
```bash
npm install -g pm2

# Start app with PM2
pm2 start api/server.js --name sublair3d

# Setup auto-restart on server reboot
pm2 startup
pm2 save
```

---

## Security Checklist

- ✅ Firewall enabled (ufw)
- ✅ SSH key authentication (disable password auth)
- ✅ SSL/HTTPS enabled
- ✅ Regular updates: `apt update && apt upgrade`
- ✅ Non-root user for running services (optional but recommended)
- ✅ Fail2ban installed (optional): `apt install fail2ban`

---

## Cost Estimate

**DigitalOcean Droplet:**
- Basic (2GB RAM, 2 vCPUs): $12/month
- Regular (4GB RAM, 2 vCPUs): $18/month (recommended for streaming)

**Total:** $12-18/month for everything (frontend, backend, RTMP, WebSocket)

---

## Next Steps

1. Create DigitalOcean droplet
2. Follow steps 2-11 above
3. Update your OBS settings to use `rtmp://3d.sublair.com:1935/live`
4. Test streaming!

---

## Support

If you encounter issues:
- Check logs: `journalctl -u sublair3d -f`
- Check nginx: `nginx -t`
- Check ports: `netstat -tlnp`
- Check firewall: `ufw status`
