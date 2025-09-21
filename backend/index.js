const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Telegram Bot
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: false });

// In-memory storage (only store file IDs, not files!)
const events = new Map();
const userStates = new Map();

// Webhook handler
app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;
    
    if (update.message) {
      const chatId = update.message.chat.id;
      const text = update.message.text || '';
      
      // Handle commands
      if (text.startsWith('/')) {
        await handleCommand(chatId, text);
      } 
      // Handle media - STORE ONLY FILE ID, NOT THE FILE
      else if (update.message.photo || update.message.video) {
        await handleMedia(chatId, update.message);
      }
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(200);
  }
});

// Handle /start command
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const eventId = 'event-' + Date.now();
  events.set(eventId, { media: [], createdAt: new Date() });
  userStates.set(chatId, { eventId, state: 'awaiting_media' });
  
  await bot.sendMessage(chatId, `🎉 New event created! 
Event ID: ${eventId}
Send me photos and videos now. When you're done, send /done to get your shareable link.`);
});

// Handle media - STORE ONLY FILE ID
bot.on('message', async (msg) => {
  if (msg.photo || msg.video) {
    const chatId = msg.chat.id;
    const userState = userStates.get(chatId);
    
    if (!userState) return;
    
    const eventData = events.get(userState.eventId);
    let fileId;
    
    if (msg.photo) {
      fileId = msg.photo[msg.photo.length - 1].file_id;
    } else if (msg.video) {
      fileId = msg.video.file_id;
    }
    
    if (fileId) {
      eventData.media.push({
        file_id: fileId,
        type: msg.photo ? 'photo' : 'video',
        timestamp: new Date()
      });
      
      await bot.sendMessage(chatId, `✅ Media added to your event!`);
    }
  }
});

// Handle /done command
bot.onText(/\/done/, async (msg) => {
  const chatId = msg.chat.id;
  const userState = userStates.get(chatId);
  
  if (!userState) return;
  
  const eventData = events.get(userState.eventId);
  const eventLink = `${process.env.FRONTEND_URL}?event=${userState.eventId}`;
  
  await bot.sendMessage(chatId, `✅ Your event is ready!
Share this link with your guests: ${eventLink}
They'll be able to view all ${eventData.media.length} media items.`);
  
  userStates.delete(chatId);
});

// API to get event media - GENERATE FRESH LINKS EACH TIME
app.get('/api/event/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const eventData = events.get(eventId);
    
    if (!eventData) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Generate fresh download links for each media item
    const mediaWithFreshLinks = await Promise.all(
      eventData.media.map(async (item) => {
        try {
          const fileLink = await bot.getFileLink(item.file_id);
          return {
            type: item.type,
            file_path: fileLink.href, // Fresh link that won't 404
            timestamp: item.timestamp
          };
        } catch (error) {
          console.error('Error generating file link:', error);
          return null;
        }
      })
    );
    
    // Filter out any failed items
    const validMedia = mediaWithFreshLinks.filter(item => item !== null);
    
    res.json({
      eventId,
      media: validMedia,
      count: validMedia.length
    });
    
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is running',
    events: events.size
  });
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
