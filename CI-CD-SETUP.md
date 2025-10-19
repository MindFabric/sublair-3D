# CI/CD Setup Guide - GitHub Actions Auto-Deploy

This guide will set up automatic deployment to DigitalOcean whenever you push to GitHub.

## How It Works

1. You push code to `docker` or `master` branch
2. GitHub Actions automatically triggers
3. Connects to your DigitalOcean droplet via SSH
4. Pulls latest code
5. Rebuilds Docker containers
6. Deploys automatically

**Just like Vercel/Railway!**

---

## Setup Instructions

### Step 1: Generate SSH Key for GitHub Actions

On your **DigitalOcean droplet**, run:

```bash
# Generate a dedicated SSH key for GitHub Actions
ssh-keygen -t ed25519 -C "github-actions" -f ~/.ssh/github-actions -N ""

# Add it to authorized keys
cat ~/.ssh/github-actions.pub >> ~/.ssh/authorized_keys

# Display the PRIVATE key (you'll need this for GitHub)
cat ~/.ssh/github-actions
```

**Copy the ENTIRE private key output** (including `-----BEGIN` and `-----END` lines)

---

### Step 2: Add Secrets to GitHub

1. **Go to your GitHub repository**: `https://github.com/YOUR_USERNAME/sublair-3D`

2. **Click**: Settings → Secrets and variables → Actions

3. **Click**: "New repository secret"

4. **Add these 3 secrets**:

#### Secret 1: DROPLET_IP
- **Name**: `DROPLET_IP`
- **Value**: `68.183.162.45` (your droplet IP)

#### Secret 2: DROPLET_USER
- **Name**: `DROPLET_USER`
- **Value**: `root`

#### Secret 3: DROPLET_SSH_KEY
- **Name**: `DROPLET_SSH_KEY`
- **Value**: Paste the ENTIRE private key from Step 1 (the output of `cat ~/.ssh/github-actions`)

---

### Step 3: Push the Workflow File

```bash
# Add the workflow file
git add .github/workflows/deploy.yml
git commit -m "Add GitHub Actions CI/CD pipeline"
git push origin docker
```

---

### Step 4: Test the Deployment

**Option A: Push a change**
```bash
# Make any small change
echo "# CI/CD Test" >> README.md
git add README.md
git commit -m "Test CI/CD deployment"
git push origin docker
```

**Option B: Manual trigger**
1. Go to: `https://github.com/YOUR_USERNAME/sublair-3D/actions`
2. Click "Deploy to DigitalOcean"
3. Click "Run workflow" → Select branch → "Run workflow"

---

### Step 5: Watch the Deployment

1. **Go to**: `https://github.com/YOUR_USERNAME/sublair-3D/actions`
2. **Click** on the running workflow
3. **Watch** the live deployment logs

You'll see:
```
🚀 Starting deployment...
📥 Pulling latest code...
🔨 Building Docker containers...
⏳ Waiting for services to start...
✅ Checking container status...
🏥 Checking health endpoint...
🧹 Cleaning up old Docker images...
✅ Deployment complete!
🌐 Application available at https://3d.sublair.com
```

---

## How to Use CI/CD

### Every Time You Want to Deploy:

**Before** (Manual):
```bash
# On your droplet
cd /opt/sublair-3D
git pull origin docker
docker-compose down
docker-compose up -d --build
```

**Now** (Automatic):
```bash
# On your local machine
git add .
git commit -m "Update feature"
git push origin docker

# That's it! Auto-deploys in ~2 minutes
```

---

## Workflow Features

✅ **Automatic deployment** on push to `docker` or `master` branch
✅ **Manual deployment** via GitHub UI
✅ **Health check** - Deployment fails if app doesn't start
✅ **Docker cleanup** - Removes old images to save disk space
✅ **Live logs** - Watch deployment progress in real-time
✅ **Rollback support** - Just revert commit and push

---

## Deployment Timeline

- **Code push**: 0 seconds
- **GitHub Actions start**: ~5 seconds
- **SSH connection**: ~3 seconds
- **Git pull**: ~5 seconds
- **Docker build**: ~30-60 seconds (cached builds are faster)
- **Container restart**: ~10 seconds
- **Health check**: ~5 seconds

**Total**: ~1-2 minutes from push to live!

---

## Advanced Features

### Deploy to Multiple Environments

Create separate workflows for staging/production:

```yaml
# .github/workflows/deploy-staging.yml
on:
  push:
    branches:
      - develop

# .github/workflows/deploy-production.yml
on:
  push:
    branches:
      - master
```

### Add Slack/Discord Notifications

Add to your workflow:

```yaml
- name: Send notification
  uses: 8398a7/action-slack@v3
  with:
    status: ${{ job.status }}
    webhook_url: ${{ secrets.SLACK_WEBHOOK }}
```

### Run Tests Before Deploy

```yaml
- name: Run tests
  run: |
    npm install
    npm test
```

---

## Troubleshooting

### Deployment fails with "Permission denied"
**Solution**: Make sure you added the SSH key correctly to GitHub Secrets

### Deployment fails with "Connection refused"
**Solution**: Check that your droplet IP is correct in GitHub Secrets

### Containers fail to start
**Solution**: SSH into droplet and check logs:
```bash
cd /opt/sublair-3D
docker-compose logs
```

### Old deployments not cleaning up
**Solution**: Manually clean up:
```bash
docker system prune -af
```

---

## Monitoring Deployments

### View All Deployments:
`https://github.com/YOUR_USERNAME/sublair-3D/actions`

### Check Deployment Status:
```bash
# On your droplet
docker-compose ps
docker-compose logs -f
```

### View Deployment History:
GitHub Actions keeps logs for 90 days

---

## Security Best Practices

✅ **Dedicated SSH key** - Not using your main SSH key
✅ **Minimal permissions** - Key only has access to deployment
✅ **Secret environment variables** - Never commit secrets to git
✅ **Health checks** - Deployment fails if app doesn't respond

---

## Cost

**GitHub Actions is FREE for:**
- Public repositories: Unlimited
- Private repositories: 2,000 minutes/month

Your deployments take ~1-2 minutes each, so you get **~1000 free deployments/month**!

---

## Next Steps

1. ✅ Set up GitHub Secrets (Step 2)
2. ✅ Push workflow file (Step 3)
3. ✅ Test deployment (Step 4)
4. 🎉 Enjoy automatic deployments!

---

**Questions?** Check the GitHub Actions logs or SSH into your droplet to debug.
