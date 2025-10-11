# SUBLAIR API v1

Secure REST API for SUBLAIR 3D music player.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file in project root (already done):
```
FIREBASE_API_KEY=your_key
FIREBASE_AUTH_DOMAIN=your_domain
FIREBASE_DATABASE_URL=your_url
FIREBASE_PROJECT_ID=your_project
FIREBASE_STORAGE_BUCKET=your_bucket
FIREBASE_MESSAGING_SENDER_ID=your_sender_id
FIREBASE_APP_ID=your_app_id
PORT=3000
NODE_ENV=development
```

3. Start the API server:
```bash
npm run api
```

For development with auto-reload:
```bash
npm run api:dev
```

## Endpoints

### GET /api/v1/tracks
Get all tracks from Firebase database.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "track_id",
      "title": "Track Title",
      "user": {
        "username": "Artist Name"
      },
      "genre": "Genre",
      "stream_url": "https://...",
      "plays_count": 100,
      "likes_count": 50
    }
  ],
  "count": 42
}
```

### GET /api/v1/tracks/:id
Get a single track by ID.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "track_id",
    "title": "Track Title",
    ...
  }
}
```

### GET /health
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-10-10T..."
}
```

## Security Features

- **Helmet**: Security headers
- **CORS**: Cross-origin resource sharing protection
- **Rate Limiting**: 100 requests per 15 minutes per IP
- **Environment Variables**: Sensitive data stored in .env
- **Error Handling**: Proper error responses without exposing internals

## Production Deployment

1. Set `NODE_ENV=production` in your .env
2. Update CORS origins in `server.js` with your production domain
3. Deploy to your hosting service (Heroku, AWS, DigitalOcean, etc.)
4. Update frontend `API_BASE_URL` with production API URL

## Notes

- Firebase credentials are never exposed to frontend
- All database queries go through the API
- Rate limiting prevents abuse
- Automatic fallback to direct Firebase in case of API failure
