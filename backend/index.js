const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const cors = require('cors');
const { google } = require('googleapis');
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

// Google Drive Setup
const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEYFILE),
    scopes: ['https://www.googleapis.com/auth/drive.file']
});

const drive = google.drive({ version: 'v3', auth });

// Upload to Google Drive
async function uploadToDrive(fileBuffer, fileName, mimeType) {
    const fileMetadata = {
        name: fileName,
        parents: [process.env.GOOGLE_DRIVE_FOLDER_ID]
    };

    const media = {
        mimeType: mimeType,
        body: fileBuffer
    };

    const response = await drive.files.create({
        resource: fileMetadata,
        media: media,
        fields: 'id, webContentLink'
    });

    await drive.permissions.create({
        fileId: response.data.id,
        requestBody: {
            role: 'reader',
            type: 'anyone'
        }
    });

    return response.data.webContentLink;
}

// Webhook handler - FIXED
app.post('/webhook', async (req, res) => {
    try {
        const update = req.body;
        
        if (update.message && (update.message.photo || update.message.video)) {
            const chatId = update.message.chat.id;
            const userState = userStates.get(chatId);
            
            if (!userState) {
                await bot.sendMessage(chatId, 'Please start an event first with /start');
            } else {
                const eventData = events.get(userState.eventId);
                
                try {
                    // Get file from Telegram
                    const fileId = update.message.photo 
                        ? update.message.photo[update.message.photo.length - 1].file_id
                        : update.message.video.file_id;
                    
                    const fileLink = await bot.getFileLink(fileId);
                    
                    // FIX: Use axios to download file
                    const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
                    const fileBuffer = Buffer.from(response.data);
                    
                    // Upload to Google Drive
                    const isPhoto = !!update.message.photo;
                    const fileExtension = isPhoto ? 'jpg' : 'mp4';
                    const mimeType = isPhoto ? 'image/jpeg' : 'video/mp4';
                    const fileName = `event-${userState.eventId}-${Date.now()}.${fileExtension}`;
                    
                    const driveUrl = await uploadToDrive(fileBuffer, fileName, mimeType);
                    
                    // Store Google Drive URL
                    eventData.media.push({
                        type: isPhoto ? 'photo' : 'video',
                        file_path: driveUrl,
                        timestamp: new Date()
                    });
                    
                    await bot.sendMessage(chatId, `✅ Media added to your event!`);
                    
                } catch (error) {
                    console.error('Media processing error:', error);
                    await bot.sendMessage(chatId, '❌ Failed to process media. Please try again.');
                }
            }
        }
        
        res.sendStatus(200);
    } catch (error) {
        console.error('Webhook error:', error);
        res.sendStatus(200);
    }
});

// Add command handlers
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
                await bot.sendMessage(chatId, `🎉 New event created! Event ID: ${eventId}`);
            } 
            else if (text === '/done') {
                const userState = userStates.get(chatId);
                if (userState) {
                    const eventData = events.get(userState.eventId);
                    const eventLink = `${process.env.FRONTEND_URL}?event=${userState.eventId}`;
                    await bot.sendMessage(chatId, `✅ Event ready! Share: ${eventLink}`);
                    userStates.delete(chatId);
                }
            }
        }
        
        res.sendStatus(200);
    } catch (error) {
        res.sendStatus(200);
    }
});

// Keep other endpoints same
app.get('/api/event/:eventId', async (req, res) => {
    try {
        const eventData = events.get(req.params.eventId);
        if (!eventData) return res.status(404).json({ error: 'Event not found' });
        res.json({ eventId: req.params.eventId, media: eventData.media });
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
