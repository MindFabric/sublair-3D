require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fetch = require('node-fetch');
const admin = require('firebase-admin');
const http = require('http');
const WebSocket = require('ws');

// Initialize Firebase Admin (with error handling)
try {
  if (!process.env.FIREBASE_PROJECT_ID) {
    console.warn('⚠️ Firebase credentials not found - some features will be disabled');
  } else {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
      }),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    console.log('✅ Firebase initialized successfully');
  }
} catch (error) {
  console.error('❌ Firebase initialization failed:', error.message);
}

const db = admin.firestore();
const realtimeDb = admin.database();

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (required for Railway)
app.set('trust proxy', 1);

// CORS - Allow all origins
app.use(cors({
  origin: '*' // Allow all origins for now (can restrict later)
}));

// Security Middleware - disabled temporarily to fix redirect loop
// app.use(helmet({
//   contentSecurityPolicy: false,
//   hsts: false,
//   frameguard: false
// }));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs (supports fast polling)
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Chat-specific rate limiting (stricter for spam prevention)
const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Max 10 messages per minute per IP
  message: 'Too many messages, please slow down.'
});

// Body Parser
app.use(express.json());
app.use(express.text({ type: 'text/plain' })); // Support sendBeacon requests

// Serve static files from root directory (for Railway deployment)
const path = require('path');
app.use(express.static(path.join(__dirname, '..')));

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

    // Transform tracks - remove stream_url for security and strip artist info for anonymous tracks
    const tracksArray = Object.entries(tracks).map(([id, track]) => {
      const { stream_url, ...trackWithoutUrl } = track;

      // If track is anonymous, remove artist information
      if (track.isAnon === true) {
        const { user_id, artistName, artistUsername, ...anonTrack } = trackWithoutUrl;
        return {
          id,
          ...anonTrack
        };
      }

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

    // If track is anonymous, remove artist information
    let trackData;
    if (track.isAnon === true) {
      const { user_id, artistName, artistUsername, ...anonTrack } = trackWithoutUrl;
      trackData = { id, ...anonTrack };
    } else {
      trackData = { id, ...trackWithoutUrl };
    }

    console.log(`✅ Returned track: ${track.title || id}${track.isAnon ? ' (anonymous)' : ''}`);
    res.json({
      success: true,
      data: trackData
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

// ========================================
// CHAT ENDPOINTS
// ========================================

// POST /api/v1/chat/messages - Send a chat message
v1Router.post('/chat/messages', chatLimiter, async (req, res) => {
  const { text, idToken } = req.body;
  console.log('💬 POST /api/v1/chat/messages');

  if (!text || !idToken) {
    return res.status(400).json({
      success: false,
      error: 'Message text and auth token required'
    });
  }

  // Validate message length
  if (text.length > 500) {
    return res.status(400).json({
      success: false,
      error: 'Message too long (max 500 characters)'
    });
  }

  try {
    // Verify Firebase token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;

    // Get user data
    const userResponse = await fetch(`${FIREBASE_DB_URL}/users/${uid}.json`);
    const userData = await userResponse.json();

    if (!userData) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Create message document
    const messageData = {
      text: text.trim(),
      username: userData.username || userData.displayName || 'Anonymous',
      uid: uid,
      photoURL: userData.photoURL || null,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: Date.now()
    };

    const docRef = await db.collection('messages').add(messageData);

    console.log(`✅ Message sent by ${messageData.username}`);
    res.json({
      success: true,
      data: {
        id: docRef.id,
        ...messageData,
        timestamp: Date.now()
      }
    });
  } catch (error) {
    console.error('❌ Error sending message:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send message'
    });
  }
});

// DELETE /api/v1/chat/messages/:id - Delete a message
v1Router.delete('/chat/messages/:id', async (req, res) => {
  const { id } = req.params;
  const authHeader = req.headers.authorization;
  console.log(`🗑️ DELETE /api/v1/chat/messages/${id}`);

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'No token provided'
    });
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    // Verify Firebase token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;

    // Get the message to verify ownership
    const messageDoc = await db.collection('messages').doc(id).get();

    if (!messageDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Message not found'
      });
    }

    const messageData = messageDoc.data();

    // Verify the user owns this message
    if (messageData.uid !== uid) {
      return res.status(403).json({
        success: false,
        error: 'You can only delete your own messages'
      });
    }

    // Delete the message
    await db.collection('messages').doc(id).delete();

    console.log(`✅ Message ${id} deleted by ${uid}`);
    res.json({
      success: true,
      message: 'Message deleted'
    });
  } catch (error) {
    console.error('❌ Error deleting message:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete message'
    });
  }
});

// GET /api/v1/chat/messages - Get recent chat messages
v1Router.get('/chat/messages', async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const before = req.query.before ? parseInt(req.query.before) : null;
  console.log(`💬 GET /api/v1/chat/messages (limit: ${limit})`);

  try {
    let query = db.collection('messages')
      .orderBy('createdAt', 'desc')
      .limit(limit);

    if (before) {
      query = query.where('createdAt', '<', before);
    }

    const snapshot = await query.get();
    const messages = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      messages.push({
        id: doc.id,
        ...data
      });
    });

    console.log(`✅ Returned ${messages.length} messages`);
    console.log('📊 Sample message data:', messages.length > 0 ? messages[0] : 'No messages');

    res.json({
      success: true,
      data: messages.reverse() // Oldest first for display
    });
  } catch (error) {
    console.error('❌ Error fetching messages:', error);
    console.error('❌ Error details:', error.message);

    // If Firestore index is missing, return helpful error
    if (error.message && error.message.includes('index')) {
      console.error('⚠️ Firestore index required! Create an index for "messages" collection on "createdAt" field');
      console.error('🔗 Index URL:', error.message.match(/https:\/\/[^\s]+/)?.[0]);
    }

    res.status(500).json({
      success: false,
      error: 'Failed to fetch messages',
      details: error.message
    });
  }
});

// POST /api/v1/chat/presence - Update user presence (online status)
v1Router.post('/chat/presence', async (req, res) => {
  // Handle both JSON and sendBeacon (text/plain) requests
  let idToken, status;

  if (typeof req.body === 'string') {
    // sendBeacon sends as text/plain
    try {
      const parsed = JSON.parse(req.body);
      idToken = parsed.idToken;
      status = parsed.status;
    } catch (e) {
      return res.status(400).json({ success: false, error: 'Invalid request format' });
    }
  } else {
    // Normal JSON request
    idToken = req.body.idToken;
    status = req.body.status;
  }

  console.log('👤 POST /api/v1/chat/presence -', status || 'online');

  if (!idToken) {
    return res.status(400).json({
      success: false,
      error: 'Auth token required'
    });
  }

  try {
    // Verify Firebase token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;

    // Get user data
    const userResponse = await fetch(`${FIREBASE_DB_URL}/users/${uid}.json`);
    const userData = await userResponse.json();

    if (!userData) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Update presence in Realtime Database (better for presence)
    const presenceData = {
      username: userData.username || userData.displayName || 'Anonymous',
      uid: uid,
      photoURL: userData.photoURL || null,
      status: status || 'online',
      lastSeen: Date.now()
    };

    await realtimeDb.ref(`presence/${uid}`).set(presenceData);

    // Set up disconnect handler to mark offline
    await realtimeDb.ref(`presence/${uid}`).onDisconnect().update({
      status: 'offline',
      lastSeen: Date.now()
    });

    console.log(`✅ Presence updated for ${presenceData.username}`);
    res.json({
      success: true,
      data: presenceData
    });
  } catch (error) {
    console.error('❌ Error updating presence:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update presence'
    });
  }
});

// GET /api/v1/chat/presence - Get online users
v1Router.get('/chat/presence', async (req, res) => {
  console.log('👥 GET /api/v1/chat/presence');

  try {
    const snapshot = await realtimeDb.ref('presence').once('value');
    const presence = snapshot.val() || {};

    // Filter online users (last seen within 10 seconds for fast polling)
    const now = Date.now();
    const onlineUsers = Object.entries(presence)
      .filter(([uid, data]) => {
        return data.status === 'online' && (now - data.lastSeen) < 10000;
      })
      .map(([uid, data]) => data);

    console.log(`✅ Returned ${onlineUsers.length} online users`);
    res.json({
      success: true,
      data: onlineUsers
    });
  } catch (error) {
    console.error('❌ Error fetching presence:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch presence'
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
    let userData = await userResponse.json();

    console.log(`📊 User data for ${data.localId}:`, userData);

    // Initialize oms field if it doesn't exist
    if (userData) {
      if (typeof userData.oms === 'undefined') {
        console.log(`🎮 Initializing oms for user: ${data.localId}`);
        userData.oms = 0;
        // Update user in database
        const updateResponse = await fetch(`${FIREBASE_DB_URL}/users/${data.localId}.json`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oms: 0 })
        });
        const updateResult = await updateResponse.json();
        console.log(`✅ oms initialized in Firebase:`, updateResult);
      } else {
        console.log(`✅ User already has oms: ${userData.oms}`);
      }
    } else {
      console.log(`⚠️ No user data found for ${data.localId}, creating minimal user object`);
      userData = { oms: 0 };
      const createResponse = await fetch(`${FIREBASE_DB_URL}/users/${data.localId}.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oms: 0 })
      });
      const createResult = await createResponse.json();
      console.log(`✅ Created user with oms:`, createResult);
    }

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

// ========================================
// DEEPWAVES FILE SYSTEM ENDPOINTS
// ========================================

// GET /api/v1/files - Get root projects or specific project versions
v1Router.get('/files', async (req, res) => {
  const { projectId, uid } = req.query;
  console.log(`📁 GET /api/v1/files${projectId ? `?projectId=${projectId}` : ' (root)'}${uid ? ` uid=${uid}` : ''}`);

  try {
    // If no projectId, return root level (all projects as folders)
    if (!projectId) {
      const response = await fetch(`${FIREBASE_DB_URL}/projects.json`);
      const projects = await response.json();

      if (!projects) {
        return res.json({
          success: true,
          data: {
            path: ['C:', 'DEEPWAVES'],
            folders: [],
            files: []
          }
        });
      }

      // Filter projects by owner_uid if provided
      let filteredProjects = Object.entries(projects);
      if (uid) {
        filteredProjects = filteredProjects.filter(([id, project]) => project.owner_uid === uid);
        console.log(`🔒 Filtering projects for user: ${uid}`);
      }

      // Transform projects into folders
      const folders = filteredProjects.map(([id, project]) => ({
        id: id,
        name: project.name || 'Untitled Project',
        itemCount: project.version_count || (project.versions ? project.versions.length : 0),
        created_at: project.created_at,
        owner_uid: project.owner_uid
      }));

      console.log(`✅ Returned ${folders.length} projects${uid ? ' (user filtered)' : ''}`);
      res.json({
        success: true,
        data: {
          path: ['C:', 'DEEPWAVES'],
          folders: folders,
          files: []
        }
      });
    } else {
      // Return specific project's versions as files
      const response = await fetch(`${FIREBASE_DB_URL}/projects/${projectId}.json`);
      const project = await response.json();

      if (!project) {
        return res.status(404).json({
          success: false,
          error: 'Project not found'
        });
      }

      // Verify ownership if uid is provided
      if (uid && project.owner_uid !== uid) {
        console.log(`🚫 Access denied: Project ${projectId} does not belong to user ${uid}`);
        return res.status(403).json({
          success: false,
          error: 'Access denied: You do not own this project'
        });
      }

      // Transform versions into files
      const files = [];
      if (project.versions && Array.isArray(project.versions)) {
        project.versions.forEach((version, index) => {
          if (version.files?.preview_track) {
            files.push({
              id: `${projectId}_${version.version_id}`,
              name: `${project.name} - ${version.version_number || `v${index + 1}`}`,
              type: 'audio/wav',
              size: version.files.project_zip?.size || 0,
              previewUrl: version.files.preview_track.url,
              downloadUrl: version.files.project_zip?.url,
              createdAt: version.committed_at,
              description: version.commit_message || 'No description',
              metadata: {
                bpm: version.metadata?.bpm,
                key: version.metadata?.key,
                genre: version.metadata?.genre,
                vibe: version.metadata?.vibe,
                commit_type: version.commit_type,
                version_number: version.version_number
              }
            });
          }
        });
      }

      console.log(`✅ Returned ${files.length} versions for project: ${project.name}`);
      res.json({
        success: true,
        data: {
          path: ['C:', 'DEEPWAVES', project.name || 'Untitled'],
          folders: [],
          files: files
        }
      });
    }
  } catch (error) {
    console.error('❌ Error fetching files:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch files'
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

// POST /api/v1/tracks/:trackId/play - Increment play count for a track
v1Router.post('/tracks/:trackId/play', async (req, res) => {
  const { trackId } = req.params;
  const { uid } = req.body; // Optional: user ID to award OMs
  console.log(`🎵 POST /api/v1/tracks/${trackId}/play${uid ? ` (user: ${uid})` : ''}`);

  if (!trackId) {
    return res.status(400).json({
      success: false,
      error: 'Track ID is required'
    });
  }

  try {
    // Get current track data
    const trackRef = realtimeDb.ref(`tracks/${trackId}`);
    const snapshot = await trackRef.once('value');
    const track = snapshot.val();

    if (!track) {
      return res.status(404).json({
        success: false,
        error: 'Track not found'
      });
    }

    // Increment listens_count
    const currentListens = track.listens_count || 0;
    const newListens = currentListens + 1;

    await trackRef.update({
      listens_count: newListens,
      last_played_at: Date.now()
    });

    // Award OMs to listener if uid is provided (triggered after 30 seconds of play)
    let newOms = null;
    if (uid) {
      const userRef = realtimeDb.ref(`users/${uid}`);
      const userSnapshot = await userRef.once('value');
      const userData = userSnapshot.val();

      if (userData) {
        const currentOms = userData.oms || 0;
        newOms = currentOms + 33; // Award 33 OMs per 30 seconds played

        await userRef.update({
          oms: newOms
        });

        console.log(`🎮 Awarded 33 OMs to listener ${uid}: ${currentOms} -> ${newOms}`);
      }
    }

    // Award OMs to artist (track owner)
    let artistNewOms = null;
    if (track.user_id) {
      const artistRef = realtimeDb.ref(`users/${track.user_id}`);
      const artistSnapshot = await artistRef.once('value');
      const artistData = artistSnapshot.val();

      if (artistData) {
        const artistCurrentOms = artistData.oms || 0;
        artistNewOms = artistCurrentOms + 10; // Award 10 OMs to artist per listen

        await artistRef.update({
          oms: artistNewOms
        });

        console.log(`🎨 Awarded 10 OMs to artist ${track.user_id}: ${artistCurrentOms} -> ${artistNewOms}`);
      }
    }

    console.log(`✅ Incremented listen count for track ${trackId}: ${currentListens} -> ${newListens}`);
    res.json({
      success: true,
      data: {
        trackId: trackId,
        listens_count: newListens,
        oms: newOms,
        artistOms: artistNewOms
      }
    });
  } catch (error) {
    console.error('❌ Error incrementing play count:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to increment play count'
    });
  }
});

// GET /api/v1/multiplayer/sessions - Get all active multiplayer sessions
v1Router.get('/multiplayer/sessions', (req, res) => {
  console.log('🎮 GET /api/v1/multiplayer/sessions');

  try {
    // Access the sessions Map from the WebSocket server (defined below)
    // We need to make sessions accessible, so we'll use a global reference
    const activeSessions = [];

    if (typeof global.multiplayerSessions !== 'undefined') {
      global.multiplayerSessions.forEach((session, sessionCode) => {
        // Only include active sessions with valid hosts
        if (session.host && session.host.readyState === 1) { // 1 = WebSocket.OPEN
          activeSessions.push({
            sessionCode: sessionCode,
            hostUsername: session.hostData?.username || 'Host',
            playerCount: session.players ? session.players.length + 1 : 1, // +1 for host
            hasStream: session.streamKey && global.activeDJStreams && global.activeDJStreams.has(session.streamKey),
            createdAt: session.createdAt || Date.now()
          });
        }
      });
    }

    console.log(`✅ Returned ${activeSessions.length} active sessions`);
    res.json({
      success: true,
      data: activeSessions,
      count: activeSessions.length
    });
  } catch (error) {
    console.error('❌ Error fetching sessions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sessions'
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
// ==========================================
// FLOATY GAME HIGH SCORES
// ==========================================

// Get high scores
app.get('/api/v1/floaty/highscores', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    const highscoresRef = realtimeDb.ref('3d/floaty/highscores');
    const snapshot = await highscoresRef.orderByChild('score').limitToLast(limit).once('value');

    const highscores = [];
    snapshot.forEach((child) => {
      highscores.push({
        id: child.key,
        ...child.val()
      });
    });

    // Sort descending by score
    highscores.sort((a, b) => b.score - a.score);

    res.json({
      success: true,
      data: highscores
    });
  } catch (error) {
    console.error('Error fetching high scores:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch high scores'
    });
  }
});

// Submit high score
app.post('/api/v1/floaty/highscores', async (req, res) => {
  try {
    const { score, idToken } = req.body;

    if (!idToken) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    if (typeof score !== 'number' || score < 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid score required'
      });
    }

    // Verify the user
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;

    // Get user data from Realtime Database
    const userSnapshot = await realtimeDb.ref(`users/${uid}`).once('value');
    const userData = userSnapshot.val();
    const username = userData?.username || userData?.displayName || 'Anonymous';
    const photoURL = userData?.photoURL || '';

    // Check if user already has a high score
    const userHighscoreRef = realtimeDb.ref(`3d/floaty/highscores/${uid}`);
    const existingSnapshot = await userHighscoreRef.once('value');
    const existingScore = existingSnapshot.val();

    const isNewHighScore = !existingScore || score > existingScore.score;

    // Always update with new score (to update timestamp)
    await userHighscoreRef.set({
      username: username,
      photoURL: photoURL,
      score: isNewHighScore ? score : existingScore.score, // Keep highest score
      timestamp: Date.now(),
      uid: uid
    });

    res.json({
      success: true,
      data: {
        score: isNewHighScore ? score : existingScore.score,
        isNewHighScore: isNewHighScore
      }
    });
  } catch (error) {
    console.error('Error submitting high score:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit high score'
    });
  }
});

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

// ==========================================
// OBS AUDIO STREAMING VIA RTMP + WEBSOCKET
// ==========================================
const NodeMediaServer = require('node-media-server');

// Determine if we're in production (Railway) or development (localhost)
const isProduction = process.env.NODE_ENV === 'production';
const RTMP_PORT = isProduction ? (parseInt(process.env.RTMP_PORT) || 1935) : 1935;
const HTTP_FLV_PORT = isProduction ? parseInt(PORT) + 1 : 8888; // Parse PORT as int before adding

const nmsConfig = {
  rtmp: {
    port: RTMP_PORT,
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60
  },
  http: {
    port: HTTP_FLV_PORT,
    allow_origin: '*',
    mediaroot: './media' // Store temporary media files
  },
  trans: {
    ffmpeg: '/usr/bin/ffmpeg', // Path to ffmpeg (Railway should have this)
    tasks: [
      {
        app: 'live',
        hls: true,
        hlsFlags: '[hls_time=2:hls_list_size=3:hls_flags=delete_segments]',
        dash: false
      }
    ]
  }
};

const nms = new NodeMediaServer(nmsConfig);
nms.run();

console.log(`📹 RTMP Server running on port ${RTMP_PORT}`);
console.log(`🔑 OBS Stream URL: rtmp://${isProduction ? '3d.sublair.com' : 'localhost'}:${RTMP_PORT}/live`);
console.log('🔑 Stream Key: Use your session code (e.g., ABC123)');
console.log(`🎥 HTTP-FLV available on port ${isProduction ? (HTTP_FLV_PORT + 1) : 8888}`);

// Store active DJ streams
const activeDJStreams = new Map(); // { sessionCode: { active: true, listeners: [] } }
// Make activeDJStreams globally accessible for REST API
global.activeDJStreams = activeDJStreams;

// Handle RTMP stream events
nms.on('prePublish', (id, StreamPath, args) => {
  // Extract streamPath from session object
  const streamPath = id.streamPath;

  if (!streamPath) {
    console.log('⚠️ prePublish event received without streamPath');
    return;
  }

  const streamKey = streamPath.split('/').pop();
  console.log('📹 OBS stream starting with key:', streamKey);

  // Verify stream key matches active session
  if (streamKeyToSession.has(streamKey)) {
    const sessionCode = streamKeyToSession.get(streamKey);
    const session = sessions.get(sessionCode);

    if (session) {
      console.log(`✅ Valid stream key - mapped to session: ${sessionCode}`);
      activeDJStreams.set(streamKey, { active: true, startTime: Date.now(), sessionCode: sessionCode });

      // Notify all players that DJ stream is live
      const liveMessage = JSON.stringify({
        type: 'dj_stream_live',
        sessionCode: sessionCode,
        streamKey: streamKey // Include stream key for FLV URL
      });

      // Notify host
      if (session.host.readyState === WebSocket.OPEN) {
        session.host.send(liveMessage);
      }

      // Notify all spectators
      session.players.forEach(player => {
        if (player.readyState === WebSocket.OPEN) {
          player.send(liveMessage);
        }
      });

      console.log('🎧 Notified session about DJ stream');
    } else {
      console.log('❌ Session not found for stream key - rejecting stream');
      id.reject();
    }
  } else {
    console.log('❌ Invalid stream key - rejecting stream');
    id.reject();
  }
});

// postPublish fires AFTER stream is established (has StreamPath)
nms.on('postPublish', (id, StreamPath, args) => {
  // Extract streamPath from session object
  const streamPath = id.streamPath;

  if (!streamPath) {
    console.log('⚠️ postPublish event received without streamPath');
    return;
  }

  const streamKey = streamPath.split('/').pop();
  console.log('📹 OBS stream connected with key:', streamKey);

  // Verify stream key matches active session
  if (streamKeyToSession.has(streamKey)) {
    const sessionCode = streamKeyToSession.get(streamKey);
    const session = sessions.get(sessionCode);

    if (session) {
      console.log(`✅ Valid stream key - mapped to session: ${sessionCode}`);
      activeDJStreams.set(streamKey, { active: true, startTime: Date.now(), sessionCode: sessionCode });

      // Notify all players that DJ stream is live
      const liveMessage = JSON.stringify({
        type: 'dj_stream_live',
        sessionCode: sessionCode,
        streamKey: streamKey // Include stream key for FLV URL
      });

      // Notify host
      if (session.host.readyState === WebSocket.OPEN) {
        session.host.send(liveMessage);
      }

      // Notify all spectators
      session.players.forEach(player => {
        if (player.readyState === WebSocket.OPEN) {
          player.send(liveMessage);
        }
      });

      console.log('🎧 Notified session about DJ stream');
    }
  }
});

nms.on('donePublish', (id, StreamPath, args) => {
  // Extract streamPath from session object
  const streamPath = id.streamPath;

  if (!streamPath) {
    console.log('⚠️ donePublish event received without streamPath');
    return;
  }

  const streamKey = streamPath.split('/').pop();
  console.log('📹 OBS stream ended:', streamKey);

  // Get session code from stream key
  const sessionCode = streamKeyToSession.get(streamKey);
  activeDJStreams.delete(streamKey);

  // Notify session that stream ended
  if (sessionCode && sessions.has(sessionCode)) {
    const session = sessions.get(sessionCode);
    const endMessage = JSON.stringify({
      type: 'dj_stream_ended',
      sessionCode: sessionCode
    });

    if (session.host.readyState === WebSocket.OPEN) {
      session.host.send(endMessage);
    }

    session.players.forEach(player => {
      if (player.readyState === WebSocket.OPEN) {
        player.send(endMessage);
      }
    });

    console.log(`🛑 Notified session ${sessionCode} that DJ stream ended`);
  }
});

// Note: HTTP-FLV streaming handled by node-media-server on port 8888
// Clients will connect directly to http://localhost:8888/live/{streamKey}.flv
// WebSocket only used for signaling (stream start/end notifications)

// Start server (only in development, not on Vercel)
// Create HTTP server
const server = http.createServer(app);

// WebSocket server for multiplayer
const wss = new WebSocket.Server({ server });

// Store active sessions: { sessionCode: { host: ws, players: [ws], hostData: {}, createdAt: timestamp } }
const sessions = new Map();
// Make sessions globally accessible for REST API
global.multiplayerSessions = sessions;

// Generate random 6-character session code
function generateSessionCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Generate random stream key (longer and more secure than session code)
function generateStreamKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = '';
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

// Map stream keys to session codes
const streamKeyToSession = new Map();

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log('🌐 New WebSocket connection from:', clientIp);
  console.log('🔗 Connection URL:', req.url);

  ws.sessionCode = null;
  ws.isHost = false;
  ws.playerData = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      // Only log non-frequent messages (exclude position updates)
      if (data.type !== 'position_update' && data.type !== 'spectator_position') {
        console.log('📨 Received message:', data.type);
      }

      switch (data.type) {
        case 'host':
          // Generate unique session code
          let sessionCode;
          do {
            sessionCode = generateSessionCode();
          } while (sessions.has(sessionCode));

          // Generate unique stream key
          let streamKey;
          do {
            streamKey = generateStreamKey();
          } while (streamKeyToSession.has(streamKey));

          ws.sessionCode = sessionCode;
          ws.isHost = true;
          ws.playerData = data.playerData || {};
          ws.customization = data.customization || {}; // Store host customization

          // Store session with stream key and creation timestamp
          sessions.set(sessionCode, {
            host: ws,
            players: [],
            hostData: ws.playerData,
            customization: ws.customization, // Include in session data
            streamKey: streamKey, // Store stream key in session
            createdAt: Date.now() // Track session creation time
          });

          // Map stream key to session code
          streamKeyToSession.set(streamKey, sessionCode);

          console.log(`🎮 Session created: ${sessionCode}`);
          console.log(`🔑 Stream key generated: ${streamKey}`);
          ws.send(JSON.stringify({
            type: 'session_created',
            sessionCode: sessionCode,
            streamKey: streamKey // Send stream key to host
          }));
          break;

        case 'join':
          const joinCode = data.sessionCode;
          if (!sessions.has(joinCode)) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Session not found'
            }));
            console.log(`❌ Failed join attempt: ${joinCode} not found`);
            break;
          }

          const session = sessions.get(joinCode);
          ws.sessionCode = joinCode;
          ws.isHost = false;
          ws.playerData = data.playerData || {};

          // Generate unique spectator ID (using socket internal ID or timestamp-based)
          ws.spectatorId = `spectator_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

          session.players.push(ws);

          console.log(`👻 Player joined session: ${joinCode} (${session.players.length} spectators) - ID: ${ws.spectatorId}`);

          ws.send(JSON.stringify({
            type: 'joined',
            sessionCode: joinCode,
            spectatorId: ws.spectatorId,
            hostData: session.hostData,
            customization: session.customization // Send host's customization to spectator
          }));

          // Notify host of new spectator
          if (session.host.readyState === WebSocket.OPEN) {
            session.host.send(JSON.stringify({
              type: 'player_joined',
              playerData: ws.playerData,
              playerId: ws.spectatorId, // Add playerId for voice chat
              spectatorId: ws.spectatorId,
              playerCount: session.players.length
            }));
          }

          // Check if there's an active DJ stream for this session
          // If so, notify the late joiner
          if (session.streamKey) {
            // Check if this stream key has an active stream
            if (activeDJStreams.has(session.streamKey)) {
              const streamInfo = activeDJStreams.get(session.streamKey);
              if (streamInfo.active) {
                console.log(`🎧 Late joiner detected - sending DJ stream info to ${ws.spectatorId}`);
                ws.send(JSON.stringify({
                  type: 'dj_stream_live',
                  sessionCode: joinCode,
                  streamKey: session.streamKey
                }));
              }
            }
          }

          // Notify new player about existing players for WebRTC setup
          // Tell the new player about the host
          ws.send(JSON.stringify({
            type: 'webrtc_peer_joined',
            playerId: 'host'
          }));

          // Tell the new player about all existing spectators
          session.players.forEach(player => {
            if (player !== ws && player.spectatorId) {
              ws.send(JSON.stringify({
                type: 'webrtc_peer_joined',
                playerId: player.spectatorId
              }));
            }
          });

          // Notify all existing players about the new player
          const newPlayerMessage = JSON.stringify({
            type: 'webrtc_peer_joined',
            playerId: ws.spectatorId
          });

          // Notify host
          if (session.host.readyState === WebSocket.OPEN) {
            session.host.send(newPlayerMessage);
          }

          // Notify all other spectators
          session.players.forEach(player => {
            if (player !== ws && player.readyState === WebSocket.OPEN) {
              player.send(newPlayerMessage);
            }
          });

          // Broadcast complete player list to everyone (host + all spectators)
          broadcastPlayerList(session);
          break;

        case 'position_update':
          // Broadcast position updates from host to all spectators
          if (ws.isHost && ws.sessionCode) {
            const hostSession = sessions.get(ws.sessionCode);
            if (hostSession) {
              // Debug: Log animation state occasionally
              if (Math.random() < 0.01) { // 1% of updates
                console.log('🎬 Server forwarding animation:', data.animationState);
              }

              // Forward ALL data from host to spectators (including car data)
              const hostPositionData = JSON.stringify({
                type: 'host_position',
                timestamp: data.timestamp,
                position: data.position,
                rotation: data.rotation,
                animationState: data.animationState,  // ✅ Include animation state
                velocity: data.velocity,               // ✅ Include velocity for extrapolation
                car: data.car                          // ✅ Include car position/rotation
              });

              hostSession.players.forEach(player => {
                if (player.readyState === WebSocket.OPEN) {
                  player.send(hostPositionData);
                }
              });
            }
          }
          break;

        case 'spectator_character':
          // Broadcast spectator CHARACTER (full boxman with animations) to host AND all other spectators
          if (!ws.isHost && ws.sessionCode) {
            const session = sessions.get(ws.sessionCode);
            if (session) {
              const characterData = JSON.stringify({
                type: 'spectator_character',
                position: data.position,
                rotation: data.rotation,
                animationState: data.animationState,
                animations: data.animations, // NEW: Animation blend data
                velocity: data.velocity,
                customization: data.customization, // NEW: Spectator skin colors and username
                timestamp: data.timestamp,
                playerId: ws.spectatorId || ws.playerData?.username || 'Spectator',
                username: ws.playerData?.username || 'Spectator'
              });

              // Send to host
              if (session.host.readyState === WebSocket.OPEN) {
                session.host.send(characterData);
              }

              // Send to all other spectators (not yourself)
              session.players.forEach(player => {
                if (player !== ws && player.readyState === WebSocket.OPEN) {
                  player.send(characterData);
                }
              });
            }
          }
          break;

        case 'spectator_position':
          // DEPRECATED: Old ghost system - keeping for backwards compatibility
          // Broadcast spectator position to host AND all other spectators
          if (!ws.isHost && ws.sessionCode) {
            const session = sessions.get(ws.sessionCode);
            if (session) {
              const positionData = JSON.stringify({
                type: 'spectator_position',
                position: data.position,
                rotation: data.rotation,
                lookDirection: data.lookDirection,
                cameraOperator: data.cameraOperator,
                playerId: ws.spectatorId || ws.playerData?.username || 'Spectator',
                username: ws.playerData?.username || 'Spectator'
              });

              // Send to host
              if (session.host.readyState === WebSocket.OPEN) {
                session.host.send(positionData);
              }

              // Send to all other spectators (not yourself)
              session.players.forEach(player => {
                if (player !== ws && player.readyState === WebSocket.OPEN) {
                  player.send(positionData);
                }
              });
            }
          }
          break;

        case 'customization_update':
          // Broadcast customization changes from host to all spectators
          if (ws.isHost && ws.sessionCode && data.customization) {
            const session = sessions.get(ws.sessionCode);
            if (session) {
              // Update session's stored customization
              session.customization = data.customization;

              const customizationData = JSON.stringify({
                type: 'customization_update',
                customization: data.customization
              });

              // Broadcast to all spectators
              session.players.forEach(player => {
                if (player.readyState === WebSocket.OPEN) {
                  player.send(customizationData);
                }
              });

              console.log(`🎨 Broadcasting customization update to ${session.players.length} spectators`);
            }
          }
          break;

        case 'audio_sync':
          // Broadcast audio sync from host to all spectators
          if (ws.isHost && ws.sessionCode) {
            const session = sessions.get(ws.sessionCode);
            if (session) {
              const audioSyncData = JSON.stringify({
                type: 'audio_sync',
                action: data.action,
                trackData: data.trackData,
                trackIndex: data.trackIndex,
                audioOutput: data.audioOutput,
                currentTime: data.currentTime,
                timestamp: data.timestamp
              });

              session.players.forEach(player => {
                if (player.readyState === WebSocket.OPEN) {
                  player.send(audioSyncData);
                }
              });

              console.log(`🎵 Broadcasting audio ${data.action} to ${session.players.length} spectators`);
            }
          }
          break;

        case 'track_info':
          // Broadcast track info from host to all spectators
          if (ws.isHost && ws.sessionCode && data.trackData) {
            const session = sessions.get(ws.sessionCode);
            if (session) {
              const trackInfoData = JSON.stringify({
                type: 'track_info',
                trackData: data.trackData
              });

              session.players.forEach(player => {
                if (player.readyState === WebSocket.OPEN) {
                  player.send(trackInfoData);
                }
              });

              console.log(`🎵 Broadcasting track info to ${session.players.length} spectators: ${data.trackData.title}`);
            }
          }
          break;

        case 'eq_update':
          // Broadcast EQ update from host to all spectators
          if (ws.isHost && ws.sessionCode && data.band && typeof data.value === 'number') {
            const session = sessions.get(ws.sessionCode);
            if (session) {
              const eqData = JSON.stringify({
                type: 'eq_update',
                band: data.band,
                value: data.value
              });

              session.players.forEach(player => {
                if (player.readyState === WebSocket.OPEN) {
                  player.send(eqData);
                }
              });

              console.log(`🎚️ Broadcasting EQ update to ${session.players.length} spectators: ${data.band} = ${data.value}`);
            }
          }
          break;

        case 'eq_reset':
          // Broadcast EQ reset from host to all spectators
          if (ws.isHost && ws.sessionCode) {
            const session = sessions.get(ws.sessionCode);
            if (session) {
              const eqResetData = JSON.stringify({
                type: 'eq_reset'
              });

              session.players.forEach(player => {
                if (player.readyState === WebSocket.OPEN) {
                  player.send(eqResetData);
                }
              });

              console.log(`🎚️ Broadcasting EQ reset to ${session.players.length} spectators`);
            }
          }
          break;

        case 'chat_message':
          // Broadcast chat message to all players in session
          if (ws.sessionCode && data.message) {
            const session = sessions.get(ws.sessionCode);
            if (session) {
              // Use username from client (includes Firebase auth username) or fallback
              const username = data.username || ws.playerData?.username || (ws.isHost ? 'Host' : 'Spectator');
              const chatData = {
                type: 'chat_message',
                username: username,
                message: data.message
              };

              // Send to host
              if (session.host.readyState === WebSocket.OPEN) {
                session.host.send(JSON.stringify(chatData));
              }

              // Send to all spectators
              session.players.forEach(player => {
                if (player.readyState === WebSocket.OPEN) {
                  player.send(JSON.stringify(chatData));
                }
              });

              console.log(`💬 Chat message from ${username}: ${data.message}`);
            }
          }
          break;

        case 'audio_play':
          // Broadcast audio track from host to all spectators
          if (ws.isHost && ws.sessionCode && data.track) {
            const session = sessions.get(ws.sessionCode);
            if (session) {
              const audioPlayData = JSON.stringify({
                type: 'audio_play',
                track: data.track,
                startTime: data.startTime // Pass through start time for sync
              });

              session.players.forEach(player => {
                if (player.readyState === WebSocket.OPEN) {
                  player.send(audioPlayData);
                }
              });

              console.log(`🎵 Broadcasting track "${data.track.title}" to ${session.players.length} spectators`);
            }
          }
          break;

        case 'audio_pause':
          // Broadcast audio pause from host to all spectators
          if (ws.isHost && ws.sessionCode) {
            const session = sessions.get(ws.sessionCode);
            if (session) {
              const audioPauseData = JSON.stringify({
                type: 'audio_pause'
              });

              session.players.forEach(player => {
                if (player.readyState === WebSocket.OPEN) {
                  player.send(audioPauseData);
                }
              });

              console.log(`🎵 Broadcasting pause to ${session.players.length} spectators`);
            }
          }
          break;

        case 'audio_resume':
          // Broadcast audio resume from host to all spectators
          if (ws.isHost && ws.sessionCode) {
            const session = sessions.get(ws.sessionCode);
            if (session) {
              const audioResumeData = JSON.stringify({
                type: 'audio_resume'
              });

              session.players.forEach(player => {
                if (player.readyState === WebSocket.OPEN) {
                  player.send(audioResumeData);
                }
              });

              console.log(`🎵 Broadcasting resume to ${session.players.length} spectators`);
            }
          }
          break;

        case 'audio_stop':
          // Broadcast audio stop from host to all spectators
          if (ws.isHost && ws.sessionCode) {
            const session = sessions.get(ws.sessionCode);
            if (session) {
              const audioStopData = JSON.stringify({
                type: 'audio_stop'
              });

              session.players.forEach(player => {
                if (player.readyState === WebSocket.OPEN) {
                  player.send(audioStopData);
                }
              });

              console.log(`🎵 Broadcasting stop to ${session.players.length} spectators`);
            }
          }
          break;

        case 'audio_preload':
          // Broadcast preload from host to all spectators
          if (ws.isHost && ws.sessionCode && data.track) {
            const session = sessions.get(ws.sessionCode);
            if (session) {
              const preloadData = JSON.stringify({
                type: 'audio_preload',
                track: data.track
              });

              session.players.forEach(player => {
                if (player.readyState === WebSocket.OPEN) {
                  player.send(preloadData);
                }
              });

              console.log(`🎵 Broadcasting preload to ${session.players.length} spectators`);
            }
          }
          break;

        case 'audio_ready':
          // Relay ready signal from spectator to host
          if (!ws.isHost && ws.sessionCode && data.spectatorId) {
            const session = sessions.get(ws.sessionCode);
            if (session && session.host.readyState === WebSocket.OPEN) {
              session.host.send(JSON.stringify({
                type: 'audio_ready',
                spectatorId: data.spectatorId
              }));
              console.log(`✅ Spectator ${data.spectatorId} ready, notifying host`);
            }
          }
          break;

        case 'audio_play_sync':
          // Broadcast synchronized play command to all spectators
          if (ws.isHost && ws.sessionCode) {
            const session = sessions.get(ws.sessionCode);
            if (session) {
              const playSyncData = JSON.stringify({
                type: 'audio_play_sync',
                startTime: data.startTime
              });

              session.players.forEach(player => {
                if (player.readyState === WebSocket.OPEN) {
                  player.send(playSyncData);
                }
              });

              console.log(`🎵 Broadcasting synchronized play to ${session.players.length} spectators`);
            }
          }
          break;

        case 'ping':
          // Respond to ping with pong for latency measurement
          if (data.timestamp) {
            ws.send(JSON.stringify({
              type: 'pong',
              timestamp: data.timestamp,
              playerId: ws.isHost ? 'host' : ws.spectatorId
            }));
          }
          break;

        case 'latency_update':
          // Receive latency measurement from client and broadcast to everyone
          if (ws.sessionCode && typeof data.latency === 'number') {
            const session = sessions.get(ws.sessionCode);
            if (session) {
              const playerId = ws.isHost ? 'host' : ws.spectatorId;

              // Store latency on the websocket
              ws.latency = data.latency;

              // Build latency map for all players
              const latencies = {};

              // Add host latency
              if (session.host.latency !== undefined) {
                latencies['host'] = session.host.latency;
              }

              // Add all spectator latencies
              session.players.forEach(player => {
                if (player.spectatorId && player.latency !== undefined) {
                  latencies[player.spectatorId] = player.latency;
                }
              });

              const latencyUpdate = JSON.stringify({
                type: 'latencies_update',
                latencies: latencies
              });

              // Broadcast to host
              if (session.host.readyState === WebSocket.OPEN) {
                session.host.send(latencyUpdate);
              }

              // Broadcast to all spectators
              session.players.forEach(player => {
                if (player.readyState === WebSocket.OPEN) {
                  player.send(latencyUpdate);
                }
              });
            }
          }
          break;

        case 'webrtc_offer':
          // Forward WebRTC offer to target peer for voice chat
          if (ws.sessionCode && data.targetId) {
            const session = sessions.get(ws.sessionCode);
            if (session) {
              const targetPlayer = [session.host, ...session.players].find(
                p => (p.isHost && data.targetId === 'host') || p.spectatorId === data.targetId
              );
              if (targetPlayer && targetPlayer !== ws && targetPlayer.readyState === WebSocket.OPEN) {
                targetPlayer.send(JSON.stringify({
                  type: 'webrtc_offer',
                  offer: data.offer,
                  fromId: ws.isHost ? 'host' : ws.spectatorId
                }));
                console.log(`📞 Forwarded WebRTC offer from ${ws.isHost ? 'host' : ws.spectatorId} to ${data.targetId}`);
              }
            }
          }
          break;

        case 'webrtc_answer':
          // Forward WebRTC answer to target peer for voice chat
          if (ws.sessionCode && data.targetId) {
            const session = sessions.get(ws.sessionCode);
            if (session) {
              const targetPlayer = [session.host, ...session.players].find(
                p => (p.isHost && data.targetId === 'host') || p.spectatorId === data.targetId
              );
              if (targetPlayer && targetPlayer !== ws && targetPlayer.readyState === WebSocket.OPEN) {
                targetPlayer.send(JSON.stringify({
                  type: 'webrtc_answer',
                  answer: data.answer,
                  fromId: ws.isHost ? 'host' : ws.spectatorId
                }));
                console.log(`📞 Forwarded WebRTC answer from ${ws.isHost ? 'host' : ws.spectatorId} to ${data.targetId}`);
              }
            }
          }
          break;

        case 'webrtc_ice_candidate':
          // Forward ICE candidate to target peer for voice chat
          if (ws.sessionCode && data.targetId) {
            const session = sessions.get(ws.sessionCode);
            if (session) {
              const targetPlayer = [session.host, ...session.players].find(
                p => (p.isHost && data.targetId === 'host') || p.spectatorId === data.targetId
              );
              if (targetPlayer && targetPlayer !== ws && targetPlayer.readyState === WebSocket.OPEN) {
                targetPlayer.send(JSON.stringify({
                  type: 'webrtc_ice_candidate',
                  candidate: data.candidate,
                  fromId: ws.isHost ? 'host' : ws.spectatorId
                }));
                console.log(`🧊 Forwarded ICE candidate from ${ws.isHost ? 'host' : ws.spectatorId} to ${data.targetId}`);
              }
            }
          }
          break;

        case 'disconnect':
          handleDisconnect(ws);
          break;
      }
    } catch (error) {
      console.error('❌ WebSocket message error:', error);
    }
  });

  ws.on('close', () => {
    console.log('🔌 WebSocket disconnected');
    handleDisconnect(ws);
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
  });
});

function handleDisconnect(ws) {
  if (!ws.sessionCode) return;

  const session = sessions.get(ws.sessionCode);
  if (!session) return;

  if (ws.isHost) {
    // Host disconnected, notify all players and close session
    console.log(`🛑 Host disconnected, closing session: ${ws.sessionCode}`);
    session.players.forEach(player => {
      if (player.readyState === WebSocket.OPEN) {
        player.send(JSON.stringify({
          type: 'session_closed',
          message: 'Host disconnected'
        }));
        player.close();
      }
    });

    // Clean up stream key mapping
    if (session.streamKey) {
      streamKeyToSession.delete(session.streamKey);
      console.log(`🔑 Cleaned up stream key mapping for session: ${ws.sessionCode}`);
    }

    sessions.delete(ws.sessionCode);
  } else {
    // Player disconnected
    const index = session.players.indexOf(ws);
    if (index > -1) {
      session.players.splice(index, 1);
      console.log(`👻 Spectator left session: ${ws.sessionCode} (${session.players.length} remaining) - ID: ${ws.spectatorId}`);

      // Notify host to remove specific ghost
      if (session.host.readyState === WebSocket.OPEN) {
        session.host.send(JSON.stringify({
          type: 'player_left',
          spectatorId: ws.spectatorId,
          playerCount: session.players.length
        }));
      }

      // Broadcast updated player list to everyone
      broadcastPlayerList(session);
    }
  }
}

// Helper function to broadcast complete player list to all players in session
function broadcastPlayerList(session) {
  if (!session) return;

  // Build player list: host + all spectators
  const players = [];

  // Add host
  players.push({
    id: 'host',
    username: session.hostData?.username || 'Host',
    isHost: true,
    customization: session.customization
  });

  // Add all spectators with their playerData
  session.players.forEach(player => {
    if (player.spectatorId && player.readyState === WebSocket.OPEN) {
      players.push({
        id: player.spectatorId,
        username: player.playerData?.username || 'Spectator',
        isHost: false,
        customization: player.customization || null
      });
    }
  });

  const playerListMessage = JSON.stringify({
    type: 'players_update',
    players: players
  });

  // Send to host
  if (session.host.readyState === WebSocket.OPEN) {
    session.host.send(playerListMessage);
  }

  // Send to all spectators
  session.players.forEach(player => {
    if (player.readyState === WebSocket.OPEN) {
      player.send(playerListMessage);
    }
  });

  console.log(`📋 Broadcasted player list: ${players.length} players total`);
}

// Start server (works for both development and Railway)
console.log('🔄 Starting server...');
console.log(`📍 PORT: ${PORT}`);
console.log(`📍 NODE_ENV: ${process.env.NODE_ENV || 'development'}`);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 API Server running on port ${PORT}`);
  console.log(`🌐 WebSocket Server running on port ${PORT}`);
  console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Server is listening on 0.0.0.0:${PORT}`);
  console.log(`✅ WebSocket ready for connections`);
}).on('error', (err) => {
  console.error('❌ Server failed to start:', err);
  process.exit(1);
});

// Export for Vercel serverless (API routes only, not WebSocket)
module.exports = app;
