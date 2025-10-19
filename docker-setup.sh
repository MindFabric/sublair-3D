#!/bin/bash
# Docker Setup Script for Sublair 3D
# Run this script on your DigitalOcean droplet to automatically set up everything

set -e  # Exit on error

echo "============================================"
echo "Sublair 3D Docker Setup Script"
echo "============================================"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "❌ Please run as root (use sudo)"
  exit 1
fi

# Update system
echo "📦 Updating system packages..."
apt update && apt upgrade -y

# Install Docker
if ! command -v docker &> /dev/null; then
  echo "🐋 Installing Docker..."
  curl -fsSL https://get.docker.com -o get-docker.sh
  sh get-docker.sh
  rm get-docker.sh
else
  echo "✅ Docker already installed"
fi

# Install Docker Compose
if ! command -v docker-compose &> /dev/null; then
  echo "📦 Installing Docker Compose..."
  apt install -y docker-compose
else
  echo "✅ Docker Compose already installed"
fi

# Configure firewall
echo "🔥 Configuring firewall..."
ufw --force enable
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw allow 1935/tcp  # RTMP
echo "✅ Firewall configured"

# Create directories
echo "📁 Creating necessary directories..."
mkdir -p certbot/conf certbot/www
mkdir -p media logs

# Check for .env file
if [ ! -f .env ]; then
  echo "⚠️  No .env file found"
  echo "Creating .env from template..."
  cp .env.docker .env
  echo ""
  echo "❗ IMPORTANT: Edit .env file with your Firebase credentials"
  echo "   Run: nano .env"
  echo ""
  read -p "Press Enter after you've configured .env..."
fi

# Verify .env has required variables
if grep -q "your-project-id" .env; then
  echo "⚠️  WARNING: .env still contains placeholder values!"
  echo "   Please edit .env with your actual Firebase credentials"
  read -p "Press Enter to continue anyway, or Ctrl+C to abort..."
fi

echo ""
echo "🚀 Starting Docker services..."
docker-compose up -d --build

echo ""
echo "⏳ Waiting for services to start..."
sleep 10

# Check if containers are running
if docker-compose ps | grep -q "Up"; then
  echo "✅ Services started successfully!"
else
  echo "❌ Some services failed to start"
  docker-compose ps
  echo ""
  echo "Check logs with: docker-compose logs"
  exit 1
fi

# Get server IP
SERVER_IP=$(curl -s ifconfig.me)

echo ""
echo "============================================"
echo "✅ Setup Complete!"
echo "============================================"
echo ""
echo "Your Sublair 3D application is now running!"
echo ""
echo "🌐 Access your application:"
echo "   Website: http://$SERVER_IP"
echo "   Health Check: http://$SERVER_IP/health"
echo "   API: http://$SERVER_IP/api/v1/tracks"
echo ""
echo "🎥 RTMP Streaming (for OBS):"
echo "   Server: rtmp://$SERVER_IP:1935/live"
echo "   Stream Key: [Use your session stream key]"
echo ""
echo "📊 Management Commands:"
echo "   View logs: docker-compose logs -f"
echo "   Restart: docker-compose restart"
echo "   Stop: docker-compose down"
echo "   Update: git pull && docker-compose up -d --build"
echo ""
echo "📝 Next Steps:"
echo "   1. Configure your domain DNS to point to: $SERVER_IP"
echo "   2. Set up SSL/HTTPS (see DOCKER.md)"
echo "   3. Test RTMP streaming with OBS"
echo ""
echo "📖 For more information, see DOCKER.md"
echo "============================================"
