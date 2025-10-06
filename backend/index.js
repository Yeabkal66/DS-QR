const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const cors = require('cors');
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
let db, eventsCollection;

async function connectDB() {
    try {
        await client.connect();
        db = client.db('eventbot');
        eventsCollection = db.collection('events');
        console.log('✅ Connected to MongoDB');
    } catch (error) {
        console.error('❌ MongoDB connection failed:', error);
    }
}

connectDB();

const userStates = new Map();

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
                    title: 'Event Gallery',
                    media: [],
                    createdAt: new Date(),
                    chatId: chatId
                };
                
                // Save to MongoDB
                await eventsCollection.insertOne(eventData);
                userStates.set(chatId, { 
                    eventId, 
                    state: 'awaiting_title',
                    uploadCount: { success: 0, failed: 0 }
                });
                
                await bot.sendMessage(chatId, `🎉 New event created!\n\n📝 Please send me the title for your event gallery:`);
            } 
            
            else if (userStates.get(chatId)?.state === 'awaiting_title') {
                const userState = userStates.get(chatId);
                
                // Update title in MongoDB
                await eventsCollection.updateOne(
                    { _id: userState.eventId },
                    { $set: { title: text } }
                );
                
                userState.state = 'awaiting_urls';
                await bot.sendMessage(chatId, `✅ Title set: "${text}"\n\n📁 Now send me photos/videos or URLs!`);
            }
            
            else if (text === '/done') {
                const userState = userStates.get(chatId);
                if (userState) {
                    const eventData = await eventsCollection.findOne({ _id: userState.eventId });
                    
                    if (userState.uploadCount) {
                        await bot.sendMessage(chatId, 
                            `📊 Final Upload Summary:\n✅ Successful: ${userState.uploadCount.success}\n❌ Failed: ${userState.uploadCount.failed}`
                        );
                    }
                    
                    const eventLink = `${process.env.FRONTEND_URL}?event=${userState.eventId}&title=${encodeURIComponent(eventData.title)}`;
                    await bot.sendMessage(chatId, `✅ Your event "${eventData.title}" is ready!\n\n🔗 Share: ${eventLink}`);
                    userStates.delete(chatId);
                }
            }
            
            else if (update.message.photo || update.message.video || text.startsWith('http')) {
                const userState = userStates.get(chatId);
                
                if (userState && userState.state === 'awaiting_urls') {
                    try {
                        let fileUrl;
                        let mediaType;
                        
                        if (update.message.photo || update.message.video) {
                            const fileId = update.message.photo 
                                ? update.message.photo[update.message.photo.length - 1].file_id
                                : update.message.video.file_id;
                            
                            const fileLink = await bot.getFileLink(fileId);
                            fileUrl = fileLink;
                            mediaType = update.message.photo ? 'photo' : 'video';
                            userState.uploadCount.success++;
                            
                        } else if (text.startsWith('http')) {
                            const isVideo = text.match(/\.(mp4|mov|avi|mkv|webm)$/i);
                            const isImage = text.match(/\.(jpg|jpeg|png|gif|bmp|webp)$/i);
                            
                            if (isVideo || isImage) {
                                fileUrl = text;
                                mediaType = isVideo ? 'video' : 'photo';
                                userState.uploadCount.success++;
                            } else {
                                userState.uploadCount.failed++;
                                throw new Error('Invalid file type');
                            }
                        }
                        
                        // Add media to MongoDB
                        await eventsCollection.updateOne(
                            { _id: userState.eventId },
                            { $push: { 
                                media: {
                                    type: mediaType,
                                    file_path: fileUrl,
                                    timestamp: new Date()
                                }
                            }}
                        );
                        
                        // Progress every 5 files
                        const totalProcessed = userState.uploadCount.success + userState.uploadCount.failed;
                        if (totalProcessed % 5 === 0) {
                            await bot.sendMessage(chatId, 
                                `📊 Upload Progress:\n✅ Successful: ${userState.uploadCount.success}\n❌ Failed: ${userState.uploadCount.failed}`
                            );
                        }
                        
                    } catch (error) {
                        userState.uploadCount.failed++;
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

// API endpoint - GET FROM MONGODB
app.get('/api/event/:eventId', async (req, res) => {
    try {
        const eventData = await eventsCollection.findOne({ _id: req.params.eventId });
        if (!eventData) return res.status(404).json({ error: 'Event not found' });
        res.json({ 
            eventId: eventData._id, 
            media: eventData.media,
            title: eventData.title
        });
    } catch (error) {
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/', (req, res) => {
    res.json({ status: 'OK', message: 'Server is running with MongoDB' });
});

app.listen(port, () => {
    console.log(`🚀 Server with MongoDB running on port ${port}`);
});
