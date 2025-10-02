const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: false });

const events = new Map();
const userStates = new Map();

// Cloudinary setup
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Upload to Cloudinary
async function uploadToCloudinary(fileBuffer, resourceType) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { resource_type: resourceType, folder: 'event-media' },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    ).end(fileBuffer);
  });
}

// Webhook handler - HANDLES BOTH METHODS
app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;
    
    if (update.message) {
      const chatId = update.message.chat.id;
      const text = update.message.text || '';
      
      if (text === '/start') {
        const eventId = 'event-' + Date.now();
        events.set(eventId, { 
          media: [], 
          createdAt: new Date(),
          title: 'Event Gallery' // ADDED: Default title
        });
        userStates.set(chatId, { 
          eventId, 
          state: 'awaiting_title' // CHANGED: Now asks for title first
        });
        
        await bot.sendMessage(chatId, `🎉 New event created!\n\n📝 Please send me the title for your event gallery:\n(What should appear at the top of the page?)`);
      } 
      
      // ADDED: Title handling
      else if (userStates.get(chatId)?.state === 'awaiting_title') {
        const userState = userStates.get(chatId);
        const eventData = events.get(userState.eventId);
        
        // Save the custom title
        eventData.title = text;
        
        // Change state to accept media
        userState.state = 'awaiting_urls';
        
        await bot.sendMessage(chatId, `✅ Title set: "${text}"\n\n📁 Now you can:\n• Send photos/videos directly\n• Or send file URLs from cloud storage\n\n✅ Send /done when finished`);
      }
      
      else if (text === '/done') {
        const userState = userStates.get(chatId);
        if (userState) {
          const eventData = events.get(userState.eventId);
          
          // ADDED: Show final upload summary
          if (userState.uploadCount) {
            await bot.sendMessage(chatId, 
              `📊 Final Upload Summary:\n✅ Successful: ${userState.uploadCount.success}\n❌ Failed: ${userState.uploadCount.failed}`
            );
          }
          
          // UPDATED: Include title in the link
          const eventLink = `${process.env.FRONTEND_URL}?event=${userState.eventId}&title=${encodeURIComponent(eventData.title)}`;
          await bot.sendMessage(chatId, `✅ Your event "${eventData.title}" is ready!\n\n🔗 Share: ${eventLink}`);
          userStates.delete(chatId);
        }
      }
      
      // METHOD 1 & 2 COMBINED: Handle both direct media and URLs with batch confirmation
      else if (update.message.photo || update.message.video || text.startsWith('http')) {
        const userState = userStates.get(chatId);
        
        if (userState && userState.state === 'awaiting_urls') {
          const eventData = events.get(userState.eventId);
          
          // ADDED: Initialize counters if they don't exist
          if (!userState.uploadCount) {
            userState.uploadCount = { success: 0, failed: 0 };
          }
          
          try {
            let fileUrl;
            let mediaType;
            
            // Handle direct media upload
            if (update.message.photo || update.message.video) {
              const fileId = update.message.photo 
                ? update.message.photo[update.message.photo.length - 1].file_id
                : update.message.video.file_id;
              
              const fileLink = await bot.getFileLink(fileId);
              const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
              const fileBuffer = Buffer.from(response.data);
              
              const isPhoto = !!update.message.photo;
              const resourceType = isPhoto ? 'image' : 'video';
              fileUrl = await uploadToCloudinary(fileBuffer, resourceType);
              mediaType = isPhoto ? 'photo' : 'video';
              
              userState.uploadCount.success++;
              
            } 
            // Handle manual URLs
            else if (text.startsWith('http')) {
              // Simple URL validation
              if (text.includes('cloudinary.com') || text.includes('res.cloudinary.com')) {
                const isVideo = text.includes('/video/') || text.includes('.mp4') || text.includes('.mov');
                
                fileUrl = text;
                mediaType = isVideo ? 'video' : 'photo';
                userState.uploadCount.success++;
              } else {
                userState.uploadCount.failed++;
                throw new Error('Invalid Cloudinary URL');
              }
            }
            
            // Add to event
            eventData.media.push({
              type: mediaType,
              file_path: fileUrl,
              timestamp: new Date(),
              source: mediaType === 'manual' ? 'manual' : 'telegram'
            });
            
            // ADDED: Send batch confirmation every 5 files
            const totalProcessed = userState.uploadCount.success + userState.uploadCount.failed;
            if (totalProcessed % 5 === 0) {
              await bot.sendMessage(chatId, 
                `📊 Upload Progress:\n✅ Successful: ${userState.uploadCount.success}\n❌ Failed: ${userState.uploadCount.failed}`
              );
            }
            
          } catch (error) {
            userState.uploadCount.failed++;
            // REMOVED: Individual error messages to reduce spam
          }
        }
      }
    }
    
    res.sendStatus(200);
  } catch (error) {
    res.sendStatus(200);
  }
});

// API endpoint
app.get('/api/event/:eventId', async (req, res) => {
  const eventData = events.get(req.params.eventId);
  if (!eventData) return res.status(404).json({ error: 'Event not found' });
  res.json({ 
    eventId: req.params.eventId, 
    media: eventData.media,
    title: eventData.title // ADDED: Include title in API response
  });
});

app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

app.listen(port, () => {
  console.log(`🚀 Enhanced system running on port ${port}`);
}); 
