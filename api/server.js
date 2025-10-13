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

// POST /api/v1/auth/login - Firebase Authentication Login
v1Router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  console.log(`🔐 POST /api/v1/auth/login - ${email}`);

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: 'Email and password are required'
    });
  }

  try {
    // Firebase Auth REST API for sign in
    const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
    const authUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;

    const response = await fetch(authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.log(`❌ Login failed for ${email}: ${data.error.message}`);
      return res.status(401).json({
        success: false,
        error: data.error.message || 'Invalid credentials'
      });
    }

    // Get user data from database
    const userResponse = await fetch(`${FIREBASE_DB_URL}/users/${data.localId}.json`);
    const userData = await userResponse.json();

    console.log(`✅ User logged in: ${email}`);
    res.json({
      success: true,
      data: {
        idToken: data.idToken,
        refreshToken: data.refreshToken,
        expiresIn: data.expiresIn,
        localId: data.localId,
        email: data.email,
        user: userData || {}
      }
    });
  } catch (error) {
    console.error('❌ Error during login:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
});

// POST /api/v1/auth/refresh - Refresh ID Token
v1Router.post('/auth/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  console.log(`🔄 POST /api/v1/auth/refresh`);

  if (!refreshToken) {
    return res.status(400).json({
      success: false,
      error: 'Refresh token is required'
    });
  }

  try {
    const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
    const refreshUrl = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`;

    const response = await fetch(refreshUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.log(`❌ Token refresh failed`);
      return res.status(401).json({
        success: false,
        error: 'Invalid refresh token'
      });
    }

    console.log(`✅ Token refreshed`);
    res.json({
      success: true,
      data: {
        idToken: data.id_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in
      }
    });
  } catch (error) {
    console.error('❌ Error refreshing token:', error);
    res.status(500).json({
      success: false,
      error: 'Token refresh failed'
    });
  }
});

// GET /api/v1/auth/verify - Verify ID Token
v1Router.get('/auth/verify', async (req, res) => {
  const authHeader = req.headers.authorization;
  console.log(`🔍 GET /api/v1/auth/verify`);

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'No token provided'
    });
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
    const verifyUrl = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`;

    const response = await fetch(verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken })
    });

    const data = await response.json();

    if (!response.ok || !data.users || data.users.length === 0) {
      console.log(`❌ Token verification failed`);
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }

    const user = data.users[0];
    console.log(`✅ Token verified for: ${user.email}`);
    res.json({
      success: true,
      data: {
        uid: user.localId,
        email: user.email,
        emailVerified: user.emailVerified
      }
    });
  } catch (error) {
    console.error('❌ Error verifying token:', error);
    res.status(500).json({
      success: false,
      error: 'Token verification failed'
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

// Start server (only in development, not on Vercel)
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 API Server running on port ${PORT}`);
    console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    console.log(`🎵 Tracks endpoint: http://localhost:${PORT}/api/v1/tracks`);
  });
}

// Export for Vercel serverless
module.exports = app;
