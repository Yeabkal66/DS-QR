import express from "express";
import bodyParser from "body-parser";
import TelegramBot from "node-telegram-bot-api";
import cors from "cors";

// ================== CONFIG ==================
const app = express();
const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID; // Your Telegram ID
const FRONTEND_URL = process.env.FRONTEND_URL;   // e.g. https://your-frontend.vercel.app

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN is missing in environment variables.");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
app.use(cors());
app.use(bodyParser.json());

// ================== STORAGE ==================
const events = {}; // { eventId: { media: [] } }
let currentEventId = null;

// ================== TELEGRAM HANDLERS ==================
bot.onText(/\/newevent (.+)/, (msg, match) => {
  if (msg.chat.id.toString() !== ADMIN_CHAT_ID) {
    bot.sendMessage(msg.chat.id, "❌ You are not authorized to create events.");
    return;
  }

  const eventId = match[1].trim();
  if (events[eventId]) {
    bot.sendMessage(msg.chat.id, `⚠️ Event "${eventId}" already exists.`);
    return;
  }

  events[eventId] = { media: [] };
  currentEventId = eventId;
  bot.sendMessage(
    msg.chat.id,
    `✅ New event created: *${eventId}*\nNow send photos/videos.`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/done/, (msg) => {
  if (msg.chat.id.toString() !== ADMIN_CHAT_ID) return;

  if (!currentEventId) {
    bot.sendMessage(msg.chat.id, "⚠️ No active event. Use /newevent <id> first.");
    return;
  }

  const link = `${FRONTEND_URL}?event=${currentEventId}`;
  bot.sendMessage(
    msg.chat.id,
    `✅ Event *${currentEventId}* is finished!\nShare this link:\n${link}`,
    { parse_mode: "Markdown" }
  );

  currentEventId = null;
});

async function handleMedia(message) {
  if (!currentEventId) return;

  let mediaInfo = null;

  try {
    if (message.photo) {
      // Pick highest quality photo
      const photo = message.photo[message.photo.length - 1];
      const fileLink = await bot.getFileLink(photo.file_id);

      mediaInfo = {
        type: "photo",
        file_id: photo.file_id,
        file_path: fileLink,   // ✅ FIXED (was fileLink.href)
        timestamp: new Date(),
      };
    } else if (message.video) {
      const fileLink = await bot.getFileLink(message.video.file_id);

      mediaInfo = {
        type: "video",
        file_id: message.video.file_id,
        file_path: fileLink,   // ✅ FIXED (was fileLink.href)
        timestamp: new Date(),
      };
    }

    if (mediaInfo) {
      events[currentEventId].media.push(mediaInfo);
      console.log(`✅ Media saved for ${currentEventId}: ${mediaInfo.file_path}`);
    }
  } catch (err) {
    console.error("❌ Error saving media:", err.message);
  }
}

bot.on("photo", handleMedia);
bot.on("video", handleMedia);

// ================== EXPRESS ROUTES ==================
app.get("/", (req, res) => {
  res.send("✅ Telegram Event Gallery Backend is running.");
});

app.get("/api/event/:id", (req, res) => {
  const { id } = req.params;
  if (!events[id]) {
    return res.status(404).json({ error: "Event not found" });
  }
  res.json(events[id]);
});

// ================== START SERVER ==================
app.listen(PORT, () => {
  console.log(`🚀 Backend running on http://localhost:${PORT}`);
});


