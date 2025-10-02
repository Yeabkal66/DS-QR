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
        events.set(eventId, { media: [], createdAt: new Date() });
        userStates.set(chatId, { eventId, state: 'awaiting_media' });
        
        await bot.sendMessage(chatId, `🎉 New event created!

📝 Event ID: ${eventId}

You can now:
📤 Send photos/videos directly to me (for files <50MB)
🔗 OR send Cloudinary URLs (for large files >50MB)

✅ When finished, send /done to get your gallery link`);
      } 
      else if (text === '/done') {
        const userState = userStates.get(chatId);
        if (userState) {
          const eventData = events.get(userState.eventId);
          const eventLink = `${process.env.FRONTEND_URL}?event=${userState.eventId}`;
          await bot.sendMessage(chatId, `✅ Your event is ready!

📊 Total media: ${eventData.media.length} items
🔗 Share this link with guests:
${eventLink}

They can view all your uploaded media!`);
          userStates.delete(chatId);
        }
      }
      // METHOD 1: Handle direct media uploads (<50MB)
      else if (update.message.photo || update.message.video) {
        const userState = userStates.get(chatId);
        if (userState) {
          const eventData = events.get(userState.eventId);
          
          try {
            const fileId = update.message.photo 
              ? update.message.photo[update.message.photo.length - 1].file_id
              : update.message.video.file_id;
            
            const fileLink = await bot.getFileLink(fileId);
            const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
            const fileBuffer = Buffer.from(response.data);
            
            const isPhoto = !!update.message.photo;
            const resourceType = isPhoto ? 'image' : 'video';
            const cloudinaryUrl = await uploadToCloudinary(fileBuffer, resourceType);
            
            eventData.media.push({
              type: isPhoto ? 'photo' : 'video',
              file_path: cloudinaryUrl,
              timestamp: new Date(),
              source: 'telegram'
            });
            
            await bot.sendMessage(chatId, `✅ Media uploaded via Telegram!`);
            
          } catch (error) {
            await bot.sendMessage(chatId, '❌ Failed to process media. Try manual upload for large files.');
          }
        }
      }
      // METHOD 2: Handle manual Cloudinary URLs (>50MB)
      else if (text.startsWith('http')) {
        const userState = userStates.get(chatId);
        if (userState) {
          const eventData = events.get(userState.eventId);
          
          // Simple URL validation
          if (text.includes('cloudinary.com') || text.includes('res.cloudinary.com')) {
            const isVideo = text.includes('/video/') || text.includes('.mp4') || text.includes('.mov');
            
            eventData.media.push({
              type: isVideo ? 'video' : 'photo',
              file_path: text,
              timestamp: new Date(),
              source: 'manual'
            });
            
            await bot.sendMessage(chatId, `✅ Manual Cloudinary URL added!`);
          } else {
            await bot.sendMessage(chatId, '❌ Please send a valid Cloudinary URL');
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
  res.json({ eventId: req.params.eventId, media: eventData.media });
});

app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

app.listen(port, () => {
  console.log(`🚀 Hybrid system running on port ${port}`);
});
