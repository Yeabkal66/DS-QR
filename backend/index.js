const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: false });

// MongoDB connection
const mongoUri = process.env.MONGODB_URI;
const client = new MongoClient(mongoUri);
let db, eventsCollection, userStatesCollection;

// Cloudinary setup
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ========== PING SETUP ==========
// Health check endpoint for pinging
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    dbConnected: !!db
  });
});

// Self-ping function to prevent Render spin-down
async function selfPing() {
  try {
    const response = await fetch(`http://localhost:${port}/health`);
    console.log(`✅ [${new Date().toISOString()}] Self-ping successful - Status: ${response.status}`);
  } catch (error) {
    console.log(`❌ [${new Date().toISOString()}] Self-ping failed: ${error.message}`);
  }
}

// Start self-pinging every 10 minutes
let pingInterval;
function startPingService() {
  selfPing();
  pingInterval = setInterval(selfPing, 10 * 60 * 1000);
  console.log(`🔄 Ping service started - will ping every 10 minutes`);
}

function stopPingService() {
  if (pingInterval) {
    clearInterval(pingInterval);
    console.log('🛑 Ping service stopped');
  }
}
// ========== END PING SETUP ==========

// Upload to Cloudinary with high quality
async function uploadToCloudinary(fileBuffer, resourceType) {
  return new Promise((resolve, reject) => {
    const uploadOptions = {
      resource_type: resourceType,
      folder: 'event-media',
      quality: 'auto:best', // High quality
      fetch_format: 'auto' // Best format
    };

    // Additional options for images
    if (resourceType === 'image') {
      uploadOptions.quality = 'auto:best';
      uploadOptions.fetch_format = 'auto';
    }

    // Additional options for videos
    if (resourceType === 'video') {
      uploadOptions.quality = 'auto:best';
      uploadOptions.fetch_format = 'mp4';
    }

    cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    ).end(fileBuffer);
  });
}

// Initialize MongoDB
async function initMongoDB() {
  try {
    await client.connect();
    db = client.db('eventBot');
    eventsCollection = db.collection('events');
    userStatesCollection = db.collection('userStates');
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
}

// Webhook handler
app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;
    
    if (update.message) {
      const chatId = update.message.chat.id;
      const text = update.message.text || '';
      
      if (text === '/start') {
        const eventId = 'event-' + Date.now();
        const eventData = { 
          _id: eventId,
          media: [], 
          createdAt: new Date(),
          title: 'Event Gallery',
          description: ''
        };
        
        await eventsCollection.insertOne(eventData);
        await userStatesCollection.updateOne(
          { chatId },
          { 
            $set: { 
              eventId, 
              state: 'awaiting_title',
              updatedAt: new Date()
            } 
          },
          { upsert: true }
        );
        
        await bot.sendMessage(chatId, `🎉 New event created!\n\n📝 Please send me the title for your event gallery:\n(What should appear at the top of the page?)`);
      } 
      
      else if (text === '/done') {
        const userState = await userStatesCollection.findOne({ chatId });
        if (userState) {
          const eventData = await eventsCollection.findOne({ _id: userState.eventId });
          
          if (userState.uploadCount) {
            await bot.sendMessage(chatId, 
              `📊 Final Upload Summary:\n✅ Successful: ${userState.uploadCount.success}\n❌ Failed: ${userState.uploadCount.failed}`
            );
          }
          
          const eventLink = `${process.env.FRONTEND_URL}?event=${userState.eventId}&title=${encodeURIComponent(eventData.title)}&description=${encodeURIComponent(eventData.description || '')}`;
          await bot.sendMessage(chatId, `✅ Your event "${eventData.title}" is ready!\n\n🔗 Share: ${eventLink}`);
          await userStatesCollection.deleteOne({ chatId });
        }
      }
      
      // Handle title and description input
      else {
        const userState = await userStatesCollection.findOne({ chatId });
        
        if (userState && userState.state === 'awaiting_title') {
          // Update event with title and ask for description
          await eventsCollection.updateOne(
            { _id: userState.eventId },
            { $set: { title: text } }
          );
          
          await userStatesCollection.updateOne(
            { chatId },
            { 
              $set: { 
                state: 'awaiting_description'
              } 
            }
          );
          
          await bot.sendMessage(chatId, `✅ Title set: "${text}"\n\n📄 Now please send me a description for your event:\n(What should appear below the title?)`);
        }
        
        // Handle description input
        else if (userState && userState.state === 'awaiting_description') {
          // Update event with description and change state to accept media
          await eventsCollection.updateOne(
            { _id: userState.eventId },
            { $set: { description: text } }
          );
          
          await userStatesCollection.updateOne(
            { chatId },
            { 
              $set: { 
                state: 'awaiting_urls',
                uploadCount: { success: 0, failed: 0 }
              } 
            }
          );
          
          await bot.sendMessage(chatId, `✅ Description set!\n\n📁 Now you can:\n• Send photos/videos directly (high quality)\n• Send documents (files) for best quality\n• Or send file URLs from cloud storage\n\n✅ Send /done when finished`);
        }
        
        // Handle media uploads (including documents/files)
        else if (userState && userState.state === 'awaiting_urls' && 
                (update.message.photo || update.message.video || update.message.document || text.startsWith('http'))) {
          try {
            let fileUrl;
            let mediaType;
            
            // Handle document/files (highest quality)
            if (update.message.document) {
              const fileId = update.message.document.file_id;
              const fileLink = await bot.getFileLink(fileId);
              const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
              const fileBuffer = Buffer.from(response.data);
              
              // Determine file type from MIME type or file name
              const mimeType = update.message.document.mime_type;
              const fileName = update.message.document.file_name;
              
              let resourceType = 'auto';
              if (mimeType && mimeType.startsWith('image/')) {
                resourceType = 'image';
                mediaType = 'photo';
              } else if (mimeType && mimeType.startsWith('video/')) {
                resourceType = 'video';
                mediaType = 'video';
              } else if (fileName) {
                // Fallback to file extension
                const ext = fileName.split('.').pop().toLowerCase();
                if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
                  resourceType = 'image';
                  mediaType = 'photo';
                } else if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) {
                  resourceType = 'video';
                  mediaType = 'video';
                }
              }
              
              fileUrl = await uploadToCloudinary(fileBuffer, resourceType);
              await userStatesCollection.updateOne(
                { chatId },
                { $inc: { 'uploadCount.success': 1 } }
              );
            }
            
            // Handle direct photo upload
            else if (update.message.photo) {
              const fileId = update.message.photo[update.message.photo.length - 1].file_id;
              const fileLink = await bot.getFileLink(fileId);
              const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
              const fileBuffer = Buffer.from(response.data);
              
              fileUrl = await uploadToCloudinary(fileBuffer, 'image');
              mediaType = 'photo';
              
              await userStatesCollection.updateOne(
                { chatId },
                { $inc: { 'uploadCount.success': 1 } }
              );
            } 
            
            // Handle direct video upload
            else if (update.message.video) {
              const fileId = update.message.video.file_id;
              const fileLink = await bot.getFileLink(fileId);
              const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
              const fileBuffer = Buffer.from(response.data);
              
              fileUrl = await uploadToCloudinary(fileBuffer, 'video');
              mediaType = 'video';
              
              await userStatesCollection.updateOne(
                { chatId },
                { $inc: { 'uploadCount.success': 1 } }
              );
            }
            
            // Handle manual URLs
            else if (text.startsWith('http')) {
              if (text.includes('cloudinary.com') || text.includes('res.cloudinary.com')) {
                const isVideo = text.includes('/video/') || text.includes('.mp4') || text.includes('.mov');
                fileUrl = text;
                mediaType = isVideo ? 'video' : 'photo';
                
                await userStatesCollection.updateOne(
                  { chatId },
                  { $inc: { 'uploadCount.success': 1 } }
                );
              } else {
                await userStatesCollection.updateOne(
                  { chatId },
                  { $inc: { 'uploadCount.failed': 1 } }
                );
                throw new Error('Invalid Cloudinary URL');
              }
            }
            
            // Add media to event
            if (fileUrl && mediaType) {
              await eventsCollection.updateOne(
                { _id: userState.eventId },
                { 
                  $push: { 
                    media: {
                      type: mediaType,
                      file_path: fileUrl,
                      timestamp: new Date(),
                      source: text.startsWith('http') ? 'manual' : 
                             update.message.document ? 'document' : 'telegram'
                    }
                  } 
                }
              );
              
              // Send progress update every 5 files
              const updatedState = await userStatesCollection.findOne({ chatId });
              const totalProcessed = updatedState.uploadCount.success + updatedState.uploadCount.failed;
              if (totalProcessed % 5 === 0) {
                await bot.sendMessage(chatId, 
                  `📊 Upload Progress:\n✅ Successful: ${updatedState.uploadCount.success}\n❌ Failed: ${updatedState.uploadCount.failed}`
                );
              }
            }
            
          } catch (error) {
            console.error('Upload error:', error);
            await userStatesCollection.updateOne(
              { chatId },
              { $inc: { 'uploadCount.failed': 1 } }
            );
          }
        }
      }
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(200);
  }
});

// API endpoint
app.get('/api/event/:eventId', async (req, res) => {
  try {
    const eventData = await eventsCollection.findOne({ _id: req.params.eventId });
    if (!eventData) return res.status(404).json({ error: 'Event not found' });
    res.json({ 
      eventId: req.params.eventId, 
      media: eventData.media,
      title: eventData.title,
      description: eventData.description || ''
    });
  } catch (error) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is running',
    pingEndpoint: '/health',
    database: db ? 'Connected' : 'Disconnected'
  });
});

// Start server
async function startServer() {
  await initMongoDB();
  app.listen(port, () => {
    console.log(`🚀 Enhanced system running on port ${port}`);
    startPingService();
  });
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down gracefully...');
  stopPingService();
  await client.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🛑 Received SIGTERM, shutting down...');
  stopPingService();
  await client.close();
  process.exit(0);
});

startServer();
