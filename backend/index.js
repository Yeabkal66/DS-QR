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

// In-memory storage (use a database in production)
const events = new Map();
const userStates = new Map();

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

// Webhook handler (Telegram will send updates here)
app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;
    
    if (update.message) {
      const chatId = update.message.chat.id;
      const text = update.message.text || '';
      const messageId = update.message.message_id;
      
      // Handle commands
      if (text.startsWith('/')) {
        await handleCommand(chatId, text);
      } 
      // Handle media
      else if (update.message.photo || update.message.video) {
        await handleMedia(chatId, update.message);
      }
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(200); // Always acknowledge webhook to prevent retries
  }
});

// Handle bot commands
async function handleCommand(chatId, command) {
  try {
    if (command === '/start' || command === '/start@yourbottoken') {
      // Create new event
      const eventId = 'event-' + Date.now();
      events.set(eventId, { media: [], createdAt: new Date() });
      userStates.set(chatId, { eventId, state: 'awaiting_media' });
      
      await bot.sendMessage(chatId, `🎉 New event created! 
Event ID: ${eventId}
Send me photos and videos now. When you're done, send /done to get your shareable link.`);
    } 
    else if (command === '/done' || command === '/done@yourbottoken') {
      const userState = userStates.get(chatId);
      
      if (!userState || !userState.eventId) {
        await bot.sendMessage(chatId, 'Please start an event first with /start');
        return;
      }
      
      const eventData = events.get(userState.eventId);
      const eventLink = `${process.env.FRONTEND_URL}/gallery.html?event=${userState.eventId}`;
      
      await bot.sendMessage(chatId, `✅ Your event is ready!
Share this link with your guests: ${eventLink}

They'll be able to view all ${eventData.media.length} media items you've uploaded.`);
      
      // Reset user state
      userStates.delete(chatId);
    }
    else if (command === '/help' || command === '/help@yourbottoken') {
      await bot.sendMessage(chatId, `🤖 Event Media Bot Help:
/start - Create a new event
/done - Finish uploading and get your shareable link
/help - Show this help message

Simply send photos or videos after starting an event, and they'll be added to your gallery automatically.`);
    }
  } catch (error) {
    console.error('Command handling error:', error);
    await bot.sendMessage(chatId, 'Sorry, something went wrong. Please try again.');
  }
}

// Handle media messages
async function handleMedia(chatId, message) {
  try {
    const userState = userStates.get(chatId);
    
    if (!userState || userState.state !== 'awaiting_media') {
      await bot.sendMessage(chatId, 'Please start an event first with /start');
      return;
    }
    
    const eventData = events.get(userState.eventId);
    let mediaInfo;
    
    if (message.photo) {
      // Get the highest resolution photo
      const photo = message.photo[message.photo.length - 1];
      const fileLink = await bot.getFileLink(photo.file_id);
      
      mediaInfo = {
        type: 'photo',
        file_id: photo.file_id,
        file_path: fileLink.href,
        timestamp: new Date()
      };
    } 
    else if (message.video) {
      const fileLink = await bot.getFileLink(message.video.file_id);
      
      mediaInfo = {
        type: 'video',
        file_id: message.video.file_id,
        file_path: fileLink.href,
        timestamp: new Date()
      };
    }
    
    if (mediaInfo) {
      eventData.media.push(mediaInfo);
      events.set(userState.eventId, eventData);
      
      await bot.sendMessage(chatId, `✅ ${mediaInfo.type === 'photo' ? 'Photo' : 'Video'} added to your event!
Send more media or /done when finished.`);
    }
  } catch (error) {
    console.error('Media handling error:', error);
    await bot.sendMessage(chatId, 'Sorry, I couldn\'t process that media. Please try again.');
  }
}

// API to get event media
app.get('/api/event/:eventId', (req, res) => {
  const { eventId } = req.params;
  const eventData = events.get(eventId);
  
  if (!eventData) {
    return res.status(404).json({ error: 'Event not found' });
  }
  
  res.json(eventData);
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Event Media Bot Backend is running',
    events: events.size
  });
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Set your Telegram webhook to: ${process.env.RENDER_URL}/webhook`);
});



