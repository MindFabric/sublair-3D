require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fetch = require('node-fetch');

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;

// Security Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://yourdomain.com'] // Update with your production domain
    : ['http://localhost:8080', 'http://localhost:3000', 'http://127.0.0.1:8080']
}));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Body Parser
app.use(express.json());

// Firebase Database URL
const FIREBASE_DB_URL = process.env.FIREBASE_DATABASE_URL;

// API Routes
const v1Router = express.Router();

// GET /api/v1/tracks - Get all tracks (without stream URLs)
v1Router.get('/tracks', async (req, res) => {
  console.log('📥 GET /api/v1/tracks');
  try {
    const response = await fetch(`${FIREBASE_DB_URL}/tracks.json`);
    const tracks = await response.json();

    if (!tracks) {
      console.log('❌ No tracks found');
      return res.status(404).json({ error: 'No tracks found' });
    }

    // Transform tracks - remove stream_url for security
    const tracksArray = Object.entries(tracks).map(([id, track]) => {
      const { stream_url, ...trackWithoutUrl } = track;
      return {
        id,
        ...trackWithoutUrl
      };
    });

    console.log(`✅ Returned ${tracksArray.length} tracks`);
    res.json({
      success: true,
      data: tracksArray,
      count: tracksArray.length
    });
  } catch (error) {
    console.error('❌ Error fetching tracks:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch tracks'
    });
  }
});

// GET /api/v1/tracks/:id - Get single track (without stream URL)
v1Router.get('/tracks/:id', async (req, res) => {
  const { id } = req.params;
  console.log(`📥 GET /api/v1/tracks/${id}`);
  try {
    const response = await fetch(`${FIREBASE_DB_URL}/tracks/${id}.json`);
    const track = await response.json();

    if (!track) {
      console.log(`❌ Track ${id} not found`);
      return res.status(404).json({
        success: false,
        error: 'Track not found'
      });
    }

    const { stream_url, ...trackWithoutUrl } = track;
    console.log(`✅ Returned track: ${track.title || id}`);
    res.json({
      success: true,
      data: { id, ...trackWithoutUrl }
    });
  } catch (error) {
    console.error('❌ Error fetching track:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch track'
    });
  }
});

// GET /api/v1/users - Get all users
v1Router.get('/users', async (req, res) => {
  console.log('📥 GET /api/v1/users');
  try {
    const response = await fetch(`${FIREBASE_DB_URL}/users.json`);
    const users = await response.json();

    if (!users) {
      console.log('❌ No users found');
      return res.status(404).json({ error: 'No users found' });
    }

    const userCount = Object.keys(users).length;
    console.log(`✅ Returned ${userCount} users`);
    res.json({
      success: true,
      data: users
    });
  } catch (error) {
    console.error('❌ Error fetching users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users'
    });
  }
});

// GET /api/v1/users/:uid - Get single user by UID
v1Router.get('/users/:uid', async (req, res) => {
  const { uid } = req.params;
  console.log(`📥 GET /api/v1/users/${uid}`);
  try {
    const response = await fetch(`${FIREBASE_DB_URL}/users/${uid}.json`);
    const user = await response.json();

    if (!user) {
      console.log(`❌ User ${uid} not found`);
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    console.log(`✅ Returned user: ${user.username || user.displayName || uid}`);
    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('❌ Error fetching user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user'
    });
  }
});

// GET /api/v1/stream/:id - Proxy stream for a track (secure)
v1Router.get('/stream/:id', async (req, res) => {
  const { id } = req.params;
  console.log(`🎵 GET /api/v1/stream/${id}`);
  try {
    const response = await fetch(`${FIREBASE_DB_URL}/tracks/${id}.json`);
    const track = await response.json();

    if (!track || !track.stream_url) {
      console.log(`❌ Stream for track ${id} not found`);
      return res.status(404).json({
        success: false,
        error: 'Track or stream not found'
      });
    }

    console.log(`✅ Redirecting to stream for: ${track.title || id}`);
    // Redirect to the actual stream URL
    // The URL is never exposed to the client
    res.redirect(track.stream_url);
  } catch (error) {
    console.error('❌ Error streaming track:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to stream track'
    });
  }
});

// Mount v1 router
app.use('/api/v1', v1Router);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 API Server running on port ${PORT}`);
  console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`🎵 Tracks endpoint: http://localhost:${PORT}/api/v1/tracks`);
});

module.exports = app;
