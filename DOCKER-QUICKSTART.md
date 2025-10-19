# Docker Quick Start Guide

Get Sublair 3D running with Docker in 5 minutes!

## Prerequisites

- DigitalOcean Droplet (or any VPS) with Ubuntu 22.04
- 2GB RAM minimum (4GB recommended)
- Domain pointed to your server IP (optional, for SSL)

## Installation

### 1. Connect to Your Server

```bash
ssh root@YOUR_SERVER_IP
```

### 2. Clone the Repository

```bash
cd /opt
git clone https://github.com/YOUR_USERNAME/sublair-3D.git
cd sublair-3D
git checkout docker
```

### 3. Run the Setup Script

```bash
chmod +x docker-setup.sh
./docker-setup.sh
```

The script will:
- ✅ Install Docker and Docker Compose
- ✅ Configure firewall
- ✅ Create necessary directories
- ✅ Start all services

### 4. Configure Environment

The script will prompt you to edit `.env`. Add your Firebase credentials:

```bash
nano .env
```

```env
FIREBASE_PROJECT_ID=your-actual-project-id
FIREBASE_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_DATABASE_URL=https://your-project.firebaseio.com
FIREBASE_API_KEY=your-api-key
```

Save and exit (Ctrl+X, Y, Enter)

### 5. Restart Services

```bash
docker-compose restart
```

## That's It!

Your application is now running at:
- **Website:** `http://YOUR_SERVER_IP`
- **RTMP:** `rtmp://YOUR_SERVER_IP:1935/live`

## Next Steps

1. **Configure SSL** - See [DOCKER.md](DOCKER.md#sslhttps-configuration)
2. **Test RTMP** - Configure OBS and start streaming
3. **Monitor** - Use `docker-compose logs -f` to watch logs

## Common Commands

```bash
# View logs
docker-compose logs -f

# Restart services
docker-compose restart

# Stop services
docker-compose down

# Update application
git pull && docker-compose up -d --build

# Check status
docker-compose ps
```

## Troubleshooting

**Services not starting?**
```bash
docker-compose logs app
```

**Port conflicts?**
```bash
netstat -tlnp | grep -E '(80|443|3000|1935|8888)'
```

**Need help?** See [DOCKER.md](DOCKER.md#troubleshooting) for detailed troubleshooting.

---

## Manual Setup (Without Script)

If you prefer manual setup:

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Install Docker Compose
apt install -y docker-compose

# Configure firewall
ufw allow 22/tcp 80/tcp 443/tcp 1935/tcp
ufw enable

# Set up environment
cp .env.docker .env
nano .env  # Edit with your credentials

# Start services
docker-compose up -d --build
```

---

## OBS Streaming Setup

**In OBS:**
1. Settings → Stream
2. Service: Custom
3. Server: `rtmp://YOUR_SERVER_IP:1935/live`
4. Stream Key: [Your session stream key from the app]
5. Click "Start Streaming"

---

## Project Structure

```
sublair-3D/
├── Dockerfile              # Main application container
├── docker-compose.yml      # Service orchestration
├── .dockerignore          # Files to exclude from build
├── .env                   # Environment variables (create from .env.docker)
├── .env.docker           # Template for environment config
├── nginx/                # Nginx reverse proxy config
│   ├── nginx.conf
│   └── conf.d/
│       └── default.conf
├── certbot/              # SSL certificates (generated)
├── media/                # RTMP stream storage (generated)
├── logs/                 # Application logs (generated)
└── docker-setup.sh       # Automated setup script
```

---

For more detailed documentation, see [DOCKER.md](DOCKER.md).
