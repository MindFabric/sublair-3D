# Docker Deployment Guide for Sublair 3D

This guide will help you deploy the entire Sublair 3D application using Docker and Docker Compose on DigitalOcean (or any VPS).

## Table of Contents
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Detailed Setup](#detailed-setup)
- [SSL/HTTPS Configuration](#sslhttps-configuration)
- [RTMP Streaming Setup](#rtmp-streaming-setup)
- [Troubleshooting](#troubleshooting)
- [Maintenance](#maintenance)

---

## Prerequisites

### On Your Local Machine:
- Git installed
- Docker and Docker Compose installed (optional, for local testing)

### On Your Server (DigitalOcean Droplet):
- Ubuntu 22.04 LTS (or similar)
- Minimum 2GB RAM (4GB recommended for streaming)
- 2 vCPUs
- Docker and Docker Compose installed
- Domain pointed to server IP

---

## Quick Start

### 1. Server Setup (DigitalOcean)

**Create a Droplet:**
```bash
# Choose:
# - Ubuntu 22.04 LTS
# - 2GB RAM minimum (4GB recommended)
# - Datacenter closest to your users
```

**Connect to your server:**
```bash
ssh root@YOUR_SERVER_IP
```

**Install Docker and Docker Compose:**
```bash
# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
apt install -y docker-compose

# Verify installations
docker --version
docker-compose --version
```

### 2. Clone and Configure

```bash
# Clone your repository
cd /opt
git clone https://github.com/YOUR_USERNAME/sublair-3D.git
cd sublair-3D

# Checkout docker branch
git checkout docker
```

### 3. Configure Environment

```bash
# Copy environment template
cp .env.docker .env

# Edit environment file
nano .env
```

**Fill in your Firebase credentials:**
```env
NODE_ENV=production
PORT=3000
RTMP_PORT=1935

FIREBASE_PROJECT_ID=your-actual-project-id
FIREBASE_CLIENT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_ACTUAL_KEY\n-----END PRIVATE KEY-----\n"
FIREBASE_DATABASE_URL=https://your-project.firebaseio.com
FIREBASE_API_KEY=your-web-api-key

DOMAIN=3d.sublair.com
```

Save and exit (Ctrl+X, Y, Enter)

### 4. Configure Firewall

```bash
# Allow necessary ports
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw allow 1935/tcp  # RTMP
ufw enable

# Verify
ufw status
```

### 5. Start the Application

```bash
# Build and start all services
docker-compose up -d --build

# View logs
docker-compose logs -f

# Check status
docker-compose ps
```

**Your application should now be running!**

- Website: `http://YOUR_SERVER_IP`
- API: `http://YOUR_SERVER_IP/api/v1/tracks`
- RTMP: `rtmp://YOUR_SERVER_IP:1935/live`
- Health Check: `http://YOUR_SERVER_IP/health`

---

## Detailed Setup

### Docker Services Overview

The `docker-compose.yml` defines 3 services:

1. **app** - Main Node.js application
   - Express API + WebSocket
   - RTMP server (port 1935)
   - HTTP-FLV server (port 8888)
   - Frontend build included

2. **nginx** - Reverse proxy
   - Routes traffic to app
   - Serves static files
   - SSL/TLS termination
   - WebSocket proxy

3. **certbot** - SSL certificate management
   - Automatic certificate renewal
   - Let's Encrypt integration

### Port Mapping

| Service | Internal Port | External Port | Purpose |
|---------|--------------|---------------|---------|
| Nginx | 80 | 80 | HTTP (redirects to HTTPS) |
| Nginx | 443 | 443 | HTTPS |
| App | 3000 | 3000 | API + WebSocket |
| App | 1935 | 1935 | RTMP streaming input |
| App | 8888 | 8888 | HTTP-FLV streaming output |
| Nginx Stats | 8080 | 8080 | RTMP stats (optional) |

---

## SSL/HTTPS Configuration

### Initial Setup (HTTP Only)

For initial testing, the application will run on HTTP. The Nginx config has HTTPS sections commented out.

### Enable HTTPS with Let's Encrypt

Once your domain is pointing to your server:

**1. Update Nginx configuration:**
```bash
nano nginx/conf.d/default.conf
```

**2. Uncomment the HTTPS redirect in the HTTP server block:**
```nginx
# Change this:
# location / {
#     return 301 https://$server_name$request_uri;
# }

# To this:
location / {
    return 301 https://$server_name$request_uri;
}
```

**3. Uncomment the entire HTTPS server block** (starting with `server { listen 443 ssl http2;`)

**4. Create certbot directories:**
```bash
mkdir -p certbot/conf certbot/www
```

**5. Get initial certificate:**
```bash
# Stop nginx temporarily
docker-compose stop nginx

# Run certbot
docker-compose run --rm certbot certonly --standalone \
  -d 3d.sublair.com \
  --email your-email@example.com \
  --agree-tos \
  --no-eff-email

# Restart all services
docker-compose up -d
```

**6. Test certificate renewal:**
```bash
docker-compose run --rm certbot renew --dry-run
```

The certbot service will automatically renew certificates every 12 hours.

---

## RTMP Streaming Setup

### OBS Configuration

**Stream Settings:**
```
Service: Custom
Server: rtmp://3d.sublair.com:1935/live
Stream Key: [Your 32-character session stream key]
```

**Recommended OBS Settings for 1080p 60fps (The Sphere Quality!):**
```
Video:
  Base Resolution: 1920x1080
  Output Resolution: 1920x1080
  FPS: 60

Output:
  Encoder: x264 (CPU) or NVENC H.264 (NVIDIA GPU recommended)
  Rate Control: CBR
  Bitrate: 6000-8000 Kbps (6000 for standard, 8000 for high quality)
  Keyframe Interval: 2
  CPU Usage Preset: veryfast (x264) or P4/P5 (NVENC)
  Profile: high
  Tune: (none)

Audio:
  Audio Bitrate: 192 Kbps
  Sample Rate: 48 kHz
```

**For 720p 60fps (Lower Bandwidth):**
```
  Output Resolution: 1280x720
  Bitrate: 4500 Kbps
```

**For 1080p 30fps (Balanced):**
```
  Output Resolution: 1920x1080
  FPS: 30
  Bitrate: 4500 Kbps
```

### How It Works

1. **RTMP Input** → OBS streams to `rtmp://your-domain:1935/live/{streamKey}`
2. **Node Media Server** → Receives RTMP stream, transcodes if needed
3. **HTTP-FLV Output** → Clients play from `http://your-domain:8888/live/{streamKey}.flv`
4. **WebSocket Sync** → Host/spectator session management

### Testing RTMP

```bash
# Check if RTMP port is open
telnet YOUR_SERVER_IP 1935

# View RTMP stats
curl http://YOUR_SERVER_IP:8080/stat

# Check logs for RTMP events
docker-compose logs -f app | grep RTMP
```

---

## Troubleshooting

### Container Issues

```bash
# Check container status
docker-compose ps

# View logs for specific service
docker-compose logs app
docker-compose logs nginx
docker-compose logs certbot

# Follow logs in real-time
docker-compose logs -f

# Restart a specific service
docker-compose restart app
docker-compose restart nginx

# Restart all services
docker-compose restart

# Rebuild and restart
docker-compose up -d --build
```

### Application Not Starting

```bash
# Check app logs
docker-compose logs app

# Common issues:
# - Missing environment variables
# - Firebase credentials incorrect
# - Port already in use

# Enter container for debugging
docker-compose exec app sh

# Inside container:
node --version
ls -la
cat /app/api/server.js
```

### RTMP Not Working

```bash
# Check if port is open
netstat -tlnp | grep 1935

# Check firewall
ufw status

# Check app logs for RTMP errors
docker-compose logs app | grep -i rtmp

# Check if node-media-server is running
docker-compose exec app ps aux | grep node
```

### Nginx Configuration Errors

```bash
# Test nginx configuration
docker-compose exec nginx nginx -t

# If error, check config syntax
nano nginx/conf.d/default.conf

# Restart nginx after fixing
docker-compose restart nginx
```

### SSL Certificate Issues

```bash
# Check certificate status
docker-compose run --rm certbot certificates

# Force renewal
docker-compose run --rm certbot renew --force-renewal

# Check certbot logs
docker-compose logs certbot
```

### Performance Issues

```bash
# Check resource usage
docker stats

# Check server resources
htop
df -h

# If memory is low, consider upgrading droplet
# or reducing concurrent connections
```

---

## Maintenance

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f app
docker-compose logs -f nginx

# Last 100 lines
docker-compose logs --tail=100 app
```

### Update Application

```bash
cd /opt/sublair-3D

# Pull latest changes
git pull origin docker

# Rebuild and restart
docker-compose down
docker-compose up -d --build

# Verify
docker-compose ps
curl http://localhost/health
```

### Backup

**Backup important data:**
```bash
# Create backup directory
mkdir -p ~/backups

# Backup environment file
cp .env ~/backups/env-$(date +%Y%m%d).backup

# Backup volumes
docker run --rm \
  -v sublair-3d_media:/source \
  -v ~/backups:/backup \
  alpine tar -czf /backup/media-$(date +%Y%m%d).tar.gz -C /source .

# Backup Nginx config
tar -czf ~/backups/nginx-$(date +%Y%m%d).tar.gz nginx/

# Backup SSL certificates
tar -czf ~/backups/certbot-$(date +%Y%m%d).tar.gz certbot/
```

### Clean Up

```bash
# Remove stopped containers
docker-compose down

# Remove unused images
docker image prune -a

# Remove unused volumes (CAUTION: This will delete data!)
docker volume prune

# Complete cleanup (CAUTION!)
docker system prune -a --volumes
```

### Monitor Resources

```bash
# Real-time container stats
docker stats

# Disk usage
docker system df

# Check logs size
du -sh /var/lib/docker/containers/*/*-json.log

# Rotate logs if they're too large
truncate -s 0 /var/lib/docker/containers/*/*-json.log
```

---

## Docker Commands Reference

### Starting and Stopping

```bash
# Start all services in background
docker-compose up -d

# Start with build
docker-compose up -d --build

# Stop all services
docker-compose down

# Stop and remove volumes (CAUTION!)
docker-compose down -v

# Restart all services
docker-compose restart

# Restart specific service
docker-compose restart app
```

### Viewing Information

```bash
# List running containers
docker-compose ps

# View logs
docker-compose logs

# Follow logs
docker-compose logs -f

# View resource usage
docker stats
```

### Debugging

```bash
# Execute command in running container
docker-compose exec app sh

# Run one-off command
docker-compose run --rm app node --version

# Inspect container
docker inspect sublair3d-app

# View container IP
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' sublair3d-app
```

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | Yes | Set to `production` |
| `PORT` | Yes | Express server port (3000) |
| `RTMP_PORT` | Yes | RTMP server port (1935) |
| `FIREBASE_PROJECT_ID` | Yes | Firebase project ID |
| `FIREBASE_CLIENT_EMAIL` | Yes | Service account email |
| `FIREBASE_PRIVATE_KEY` | Yes | Service account private key |
| `FIREBASE_DATABASE_URL` | Yes | Realtime Database URL |
| `FIREBASE_API_KEY` | Yes | Web API key |
| `DOMAIN` | No | Your domain name |

---

## Security Best Practices

1. **Use strong passwords** for all accounts
2. **Enable SSH key authentication** and disable password auth
3. **Keep system updated**: `apt update && apt upgrade`
4. **Use firewall**: Only expose necessary ports
5. **Monitor logs** regularly for suspicious activity
6. **Backup regularly**: Automate backups
7. **Use HTTPS**: Always enable SSL/TLS
8. **Rotate secrets**: Change API keys periodically
9. **Limit access**: Use non-root users when possible
10. **Monitor resources**: Set up alerts for high CPU/memory usage

---

## Cost Estimation

**DigitalOcean Droplet:**
- Basic (2GB RAM): $12/month
- Regular (4GB RAM): $18/month ⭐ Recommended

**Total Cost:** $12-18/month for complete infrastructure

---

## Support

If you encounter issues:

1. Check logs: `docker-compose logs -f`
2. Check container status: `docker-compose ps`
3. Verify firewall: `ufw status`
4. Test connectivity: `curl http://localhost/health`
5. Check resources: `docker stats`

---

## Next Steps

After successful deployment:

1. ✅ Configure DNS to point to your server
2. ✅ Enable HTTPS with Let's Encrypt
3. ✅ Test RTMP streaming with OBS
4. ✅ Set up automated backups
5. ✅ Configure monitoring (optional)
6. ✅ Set up CI/CD for automatic updates (optional)

---

## Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Let's Encrypt Documentation](https://letsencrypt.org/docs/)
- [Node Media Server](https://github.com/illuspas/Node-Media-Server)
- [OBS Studio](https://obsproject.com/)
