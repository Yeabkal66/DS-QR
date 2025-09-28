const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const cors = require('cors');
const { google } = require('googleapis');
const fs = require('fs');
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
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEYFILE,
    scopes: ['https://www.googleapis.com/auth/drive.file']
});

const drive = google.drive({ version: 'v3', auth });

// Upload to Google Drive
async function uploadToDrive(fileBuffer, fileName, mimeType) {
    try {
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
            fields: 'id, webViewLink, webContentLink'
        });

        // Make file publicly accessible
        await drive.permissions.create({
            fileId: response.data.id,
            requestBody: {
                role: 'reader',
                type: 'anyone'
            }
        });

        return response.data.webContentLink; // Public download URL
    } catch (error) {
        console.error('Google Drive upload error:', error);
        throw error;
    }
}

// Webhook handler
app.post('/webhook', async (req, res) => {
    try {
        const update = req.body;
        
        if (update.message) {
            const chatId = update.message.chat.id;
            const text = update.message.text || '';
            
            if (text === '/start' || text === '/start@yourbottoken') {
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
            else if (update.message.photo || update.message.video) {
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
                        
                        // Download file from Telegram
                        const response = await fetch(fileLink);
                        const fileBuffer = await response.buffer();
                        
                        // Determine file type and name
                        const isPhoto = update.message.photo ? true : false;
                        const fileExtension = isPhoto ? 'jpg' : 'mp4';
                        const mimeType = isPhoto ? 'image/jpeg' : 'video/mp4';
                        const fileName = `event-${userState.eventId}-${Date.now()}.${fileExtension}`;
                        
                        // Upload to Google Drive
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
        }
        
        res.sendStatus(200);
    } catch (error) {
        console.error('Webhook error:', error);
        res.sendStatus(200);
    }
});

// API to get event media
app.get('/api/event/:eventId', async (req, res) => {
    try {
        const { eventId } = req.params;
        const eventData = events.get(eventId);
        
        if (!eventData) {
            return res.status(404).json({ error: 'Event not found' });
        }
        
        res.json({
            eventId,
            media: eventData.media,
            count: eventData.media.length
        });
        
    } catch (error) {
        console.error('API error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/', (req, res) => {
    res.json({ status: 'OK', message: 'Server is running', events: events.size });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
