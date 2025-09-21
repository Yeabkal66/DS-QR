const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from the 'public' directory
app.use('/media', express.static(path.join(__dirname, 'public')));

// Initialize Telegram Bot
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: false });

// In-memory storage (only store file IDs, not files!)
const events = new Map();
const userStates = new Map();

// ADD PROXY ENDPOINT RIGHT HERE - AFTER MIDDLEWARE, BEFORE WEBHOOK
app.get('/proxy', async (req, res) => {
  try {
    const { url, type } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL parameter required' });
    }
    
    // Fetch the media from Telegram
    const response = await fetch(url);
    
    if (!response.ok) {
      return res.status(404).send('Media not found');
    }
    
    // Set appropriate content type
    if (type === 'photo') {
      res.set('Content-Type', 'image/jpeg');
    } else if (type === 'video') {
      res.set('Content-Type', 'video/mp4');
    }
    
    // Stream the media through your server
    response.body.pipe(res);
    
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).send('Error fetching media');
  }
});

// Webhook handler
app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;
    console.log('Webhook received:', JSON.stringify(update));
    
    if (update.message) {
      const chatId = update.message.chat.id;
      const text = update.message.text || '';
      
      // Handle commands directly
      if (text.startsWith('/')) {
        if (text === '/start' || text === '/start@yourbottoken') {
          // Create new event
          const eventId = 'event-' + Date.now();
          events.set(eventId, { media: [], createdAt: new Date() });
          userStates.set(chatId, { eventId, state: 'awaiting_media' });
          
          await bot.sendMessage(chatId, `🎉 New event created! 
Event ID: ${eventId}
Send me photos and videos now. When you're done, send /done to get your shareable link.`);
        } 
        else if (text === '/done' || text === '/done@yourbottoken') {
          const userState = userStates.get(chatId);
          
          if (!userState || !userState.eventId) {
            await bot.sendMessage(chatId, 'Please start an event first with /start');
          } else {
            const eventData = events.get(userState.eventId);
            const eventLink = `${process.env.FRONTEND_URL}?event=${userState.eventId}`;
            
            await bot.sendMessage(chatId, `✅ Your event is ready!
Share this link with your guests: ${eventLink}
They'll be able to view all ${eventData.media.length} media items.`);
            
            userStates.delete(chatId);
          }
        }
        else if (text === '/help' || text === '/help@yourbottoken') {
          await bot.sendMessage(chatId, `🤖 Event Media Bot Help:
/start - Create a new event
/done - Finish uploading and get your shareable link
/help - Show this help message

Simply send photos or videos after starting an event, and they'll be added to your gallery automatically.`);
        }
      } 
      // Handle media
      else if (update.message.photo || update.message.video) {
        const userState = userStates.get(chatId);
        
        if (!userState) {
          await bot.sendMessage(chatId, 'Please start an event first with /start');
        } else {
          const eventData = events.get(userState.eventId);
          let fileId;
          
          if (update.message.photo) {
            fileId = update.message.photo[update.message.photo.length - 1].file_id;
          } else if (update.message.video) {
            fileId = update.message.video.file_id;
          }
          
          if (fileId) {
            eventData.media.push({
              file_id: fileId,
              type: update.message.photo ? 'photo' : 'video',
              timestamp: new Date()
            });
            
            await bot.sendMessage(chatId, `✅ Media added to your event!`);
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
            file_path: fileLink.href, // This is the Telegram CDN link
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

// Set webhook route
app.post('/set-webhook', async (req, res) => {
  try {
    const webhookUrl = `${process.env.RENDER_URL}/webhook`;
    await bot.setWebHook(webhookUrl);
    res.json({ success: true, message: `Webhook set to ${webhookUrl}` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  // Create public directory if it doesn't exist
  if (!fs.existsSync(path.join(__dirname, 'public'))) {
    fs.mkdirSync(path.join(__dirname, 'public'), { recursive: true });
  }
});
