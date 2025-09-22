const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: false }); // Polling disabled

const events = new Map();
const userStates = new Map();

// FIX 1: Proper file link handling
app.get('/proxy-media', async (req, res) => {
    try {
        const { url, type } = req.query;
        
        if (!url) return res.status(400).json({ error: 'URL parameter required' });
        
        const response = await fetch(url);
        if (!response.ok) return res.status(404).send('Media not found');
        
        type === 'photo' ? res.set('Content-Type', 'image/jpeg') : res.set('Content-Type', 'video/mp4');
        response.body.pipe(res);
        
    } catch (error) {
        res.status(500).send('Error fetching media');
    }
});

// FIX 2: Use ONLY webhook handling (no bot.onText)
app.post('/webhook', async (req, res) => {
    try {
        const update = req.body;
        
        if (update.message) {
            const chatId = update.message.chat.id;
            const text = update.message.text || '';
            
            // Handle commands directly in webhook
            if (text.startsWith('/')) {
                if (text === '/start') {
                    const eventId = 'event-' + Date.now();
                    events.set(eventId, { media: [], createdAt: new Date() });
                    userStates.set(chatId, { eventId, state: 'awaiting_media' });
                    
                    await bot.sendMessage(chatId, `🎉 New event created! Event ID: ${eventId}`);
                } 
                else if (text === '/done') {
                    const userState = userStates.get(chatId);
                    if (userState) {
                        const eventData = events.get(userState.eventId);
                        await bot.sendMessage(chatId, `✅ Event ready with ${eventData.media.length} items`);
                        userStates.delete(chatId);
                    }
                }
            }
            // Handle media
            else if (update.message.photo || update.message.video) {
                const userState = userStates.get(chatId);
                if (userState) {
                    const eventData = events.get(userState.eventId);
                    const fileId = update.message.photo 
                        ? update.message.photo[update.message.photo.length - 1].file_id
                        : update.message.video.file_id;
                    
                    // FIX 1: Proper file link generation
                    const fileLink = await bot.getFileLink(fileId);
                    
                    eventData.media.push({
                        file_id: fileId,
                        file_path: fileLink, // Use fileLink directly (not fileLink.href)
                        type: update.message.photo ? 'photo' : 'video',
                        timestamp: new Date()
                    });
                    
                    await bot.sendMessage(chatId, `✅ Media added!`);
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
    try {
        const eventData = events.get(req.params.eventId);
        if (!eventData) return res.status(404).json({ error: 'Event not found' });
        
        res.json({
            eventId: req.params.eventId,
            media: eventData.media,
            count: eventData.media.length
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/', (req, res) => {
    res.json({ status: 'OK', message: 'Server is running' });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
