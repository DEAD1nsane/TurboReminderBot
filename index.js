const express = require('express');
const chrono = require('chrono-node');
const { DateTime } = require('luxon');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
    console.error('Unexpected Postgres pool error:', err);
});

// Bind server immediately so Railway healthcheck passes instantly
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
});

async function initDb() {
    if (!process.env.DATABASE_URL) return;
    const query = `
        CREATE TABLE IF NOT EXISTS user_settings (
            user_id BIGINT PRIMARY KEY,
            timezone TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS reminders (
            id SERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL,
            chat_id BIGINT,
            text TEXT NOT NULL,
            remind_at TIMESTAMP WITH TIME ZONE NOT NULL,
            sent BOOLEAN DEFAULT FALSE
        );
    `;
    try {
        await pool.query(query);
        console.log('Database initialized successfully.');
    } catch (err) {
        console.error('Error initializing database:', err);
    }
}
initDb();

app.get('/', (req, res) => {
    res.status(200).send('OK');
});

async function getUserTimezone(userId) {
    if (!process.env.DATABASE_URL) return null;
    try {
        const res = await pool.query('SELECT timezone FROM user_settings WHERE user_id = $1', [userId]);
        return res.rows.length > 0 ? res.rows[0].timezone : null;
    } catch (err) {
        console.error('Error fetching user timezone:', err);
        return null;
    }
}

function parseFlexibleDate(text, timeZone) {
    let clean = text.trim().replace(/^reminder\s*/i, '');
    const compoundRegex = /^(\d+d)?\s*(\d+h)?\s*(\d+m)?\s*(\d+s)?$/i;
    const match = clean.match(compoundRegex);

    if (match && clean.length > 0) {
        const days = match[1] ? parseInt(match[1], 10) : 0;
        const hours = match[2] ? parseInt(match[2], 10) : 0;
        const minutes = match[3] ? parseInt(match[3], 10) : 0;
        const seconds = match[4] ? parseInt(match[4], 10) : 0;

        if (days > 0 || hours > 0 || minutes > 0 || seconds > 0) {
            let dt = DateTime.now().setZone(timeZone);
            if (days) dt = dt.plus({ days });
            if (hours) dt = dt.plus({ hours });
            if (minutes) dt = dt.plus({ minutes });
            if (seconds) dt = dt.plus({ seconds });
            return dt.toJSDate();
        }
    }

    const nowInZone = DateTime.now().setZone(timeZone).toJSDate();
    return chrono.parseDate(clean, nowInZone);
}

async function sendTelegramMessage(chatId, text, replyMarkup = null) {
    const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
    const payload = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
    if (replyMarkup) payload.reply_markup = replyMarkup;

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!data.ok) console.error('Telegram sendMessage error:', data);
    } catch (err) {
        console.error('Error sending reminder message:', err);
    }
}

async function editTelegramMessage(chatId, messageId, text, replyMarkup = null) {
    const url = `https://api.telegram.org/bot${TOKEN}/editMessageText`;
    const payload = { chat_id: chatId, message_id: messageId, text: text, parse_mode: 'Markdown' };
    if (replyMarkup) payload.reply_markup = replyMarkup;

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!data.ok) console.error('Telegram editMessageText error:', data);
    } catch (err) {
        console.error('Error editing message:', err);
    }
}

async function answerCallbackQuery(callbackQueryId, text = '') {
    const url = `https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`;
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: callbackQueryId, text: text })
        });
    } catch (err) {
        console.error('Error answering callback query:', err);
    }
}

function getRegionMenuKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: '🌎 North America', callback_data: 'menu:na' },
                { text: '🌍 Europe', callback_data: 'menu:eu' }
            ],
            [
                { text: '🌏 Asia', callback_data: 'menu:asia' },
                { text: '🌍 Africa', callback_data: 'menu:af' }
            ],
            [
                { text: '🌎 South America', callback_data: 'menu:sa' },
                { text: '🌏 Oceania / Australia', callback_data: 'menu:oc' }
            ],
            [
                { text: '🌐 UTC', callback_data: 'settz:UTC' }
            ]
        ]
    };
}

function getSubMenuKeyboard(region) {
    let buttons = [];
    if (region === 'na') {
        buttons = [
            [{ text: '🇺🇸 US Eastern', callback_data: 'settz:America/New_York' }, { text: '🇺🇸 US Central', callback_data: 'settz:America/Chicago' }],
            [{ text: '🇺🇸 US Mountain', callback_data: 'settz:America/Denver' }, { text: '🇺🇸 US Pacific', callback_data: 'settz:America/Los_Angeles' }],
            [{ text: '🇺🇸 Alaska', callback_data: 'settz:America/Anchorage' }, { text: '🇺🇸 Hawaii', callback_data: 'settz:Pacific/Honolulu' }],
            [{ text: '🇨🇦 Canada Eastern', callback_data: 'settz:America/Toronto' }, { text: '🇨🇦 Canada Pacific', callback_data: 'settz:America/Vancouver' }],
            [{ text: '🇲🇽 Mexico City', callback_data: 'settz:America/Mexico_City' }]
        ];
    } else if (region === 'eu') {
        buttons = [
            [{ text: '🇬🇧 London (GMT/BST)', callback_data: 'settz:Europe/London' }, { text: '🇫🇷 Paris (CET)', callback_data: 'settz:Europe/Paris' }],
            [{ text: '🇩🇪 Berlin (CET)', callback_data: 'settz:Europe/Berlin' }, { text: '🇪🇸 Madrid (CET)', callback_data: 'settz:Europe/Madrid' }],
            [{ text: '🇬🇷 Athens (EET)', callback_data: 'settz:Europe/Athens' }, { text: '🇹🇷 Istanbul', callback_data: 'settz:Europe/Istanbul' }],
            [{ text: '🇺🇦 Kyiv (EET)', callback_data: 'settz:Europe/Kyiv' }]
        ];
    } else if (region === 'asia') {
        buttons = [
            [{ text: '🇮🇳 India (IST)', callback_data: 'settz:Asia/Kolkata' }, { text: '🇯🇵 Tokyo (JST)', callback_data: 'settz:Asia/Tokyo' }],
            [{ text: '🇨🇳 Shanghai / Beijing', callback_data: 'settz:Asia/Shanghai' }, { text: '🇸🇬 Singapore / HK', callback_data: 'settz:Asia/Singapore' }],
            [{ text: '🇦🇪 Dubai (GST)', callback_data: 'settz:Asia/Dubai' }, { text: '🇮🇩 Jakarta (WIB)', callback_data: 'settz:Asia/Jakarta' }],
            [{ text: '🇵🇰 Karachi (PKT)', callback_data: 'settz:Asia/Karachi' }, { text: '🇵🇭 Manila (PST)', callback_data: 'settz:Asia/Manila' }]
        ];
    } else if (region === 'af') {
        buttons = [
            [{ text: '🇪🇬 Cairo (EET)', callback_data: 'settz:Africa/Cairo' }, { text: '🇿🇦 Johannesburg', callback_data: 'settz:Africa/Johannesburg' }],
            [{ text: '🇳🇬 Lagos (WAT)', callback_data: 'settz:Africa/Lagos' }, { text: '🇰🇪 Nairobi (EAT)', callback_data: 'settz:Africa/Nairobi' }],
            [{ text: '🇲🇦 Casablanca', callback_data: 'settz:Africa/Casablanca' }]
        ];
    } else if (region === 'sa') {
        buttons = [
            [{ text: '🇧🇷 São Paulo', callback_data: 'settz:America/Sao_Paulo' }, { text: '🇦🇷 Buenos Aires', callback_data: 'settz:America/Argentina/Buenos_Aires' }],
            [{ text: '🇨🇱 Santiago', callback_data: 'settz:America/Santiago' }, { text: '🇨🇴 Bogotá', callback_data: 'settz:America/Bogota' }]
        ];
    } else if (region === 'oc') {
        buttons = [
            [{ text: '🇦🇺 Sydney / Melb', callback_data: 'settz:Australia/Sydney' }, { text: '🇦🇺 Brisbane', callback_data: 'settz:Australia/Brisbane' }],
            [{ text: '🇦🇺 Perth', callback_data: 'settz:Australia/Perth' }, { text: '🇳🇿 Auckland', callback_data: 'settz:Pacific/Auckland' }]
        ];
    }
    buttons.push([{ text: '⬅️ Back to Regions', callback_data: 'menu:main' }]);
    return { inline_keyboard: buttons };
}

setInterval(async () => {
    if (!process.env.DATABASE_URL) return;
    try {
        const res = await pool.query('SELECT * FROM reminders WHERE remind_at <= NOW() AND sent = FALSE');
        for (const reminder of res.rows) {
            await sendTelegramMessage(reminder.chat_id || reminder.user_id, `⏰ **REMINDER:** ${reminder.text}`);
            await pool.query('UPDATE reminders SET sent = TRUE WHERE id = $1', [reminder.id]);
        }
    } catch (err) {
        console.error('Error checking scheduled reminders:', err);
    }
}, 10000);

app.post('/webhook', async (req, res) => {
    try {
        const message = req.body.message;
        const inlineQuery = req.body.inline_query;
        const chosenResult = req.body.chosen_inline_result;
        const callbackQuery = req.body.callback_query;

        if (message && message.text) {
            const text = message.text.trim();
            const userId = message.from.id;
            const chatId = message.chat.id;

            if (text.startsWith('/tz') || text.startsWith('/start')) {
                const tzInput = text.replace(/\/tz|\/start/, '').trim();
                if (!tzInput || tzInput === 'tz') {
                    await sendTelegramMessage(chatId, '⚙️ **Select your region below, or type `/tz Continent/City` (e.g. `/tz Europe/London`):**', getRegionMenuKeyboard());
                } else {
                    const validTz = DateTime.now().setZone(tzInput).isValid;
                    if (validTz && process.env.DATABASE_URL) {
                        try {
                            await pool.query(
                                'INSERT INTO user_settings (user_id, timezone) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET timezone = $2',
                                [userId, tzInput]
                            );
                            await sendTelegramMessage(chatId, `✅ Timezone saved as **${tzInput}**! You can now use inline reminders.`);
                        } catch (err) {
                            console.error('Error setting timezone via text:', err);
                        }
                    } else {
                        await sendTelegramMessage(chatId, '❌ Invalid timezone. Select a region below or search using `/tz Continent/City` (e.g. `/tz Asia/Tokyo`).', getRegionMenuKeyboard());
                    }
                }
            }
        }

        if (callbackQuery) {
            const userId = callbackQuery.from.id;
            const chatId = callbackQuery.message.chat.id;
            const messageId = callbackQuery.message.message_id;
            const data = callbackQuery.data;

            await answerCallbackQuery(callbackQuery.id);

            if (data.startsWith('menu:')) {
                const region = data.replace('menu:', '');
                if (region === 'main') {
                    await editTelegramMessage(chatId, messageId, '⚙️ **Select your region below, or type `/tz Continent/City`:**', getRegionMenuKeyboard());
                } else {
                    await editTelegramMessage(chatId, messageId, '📍 **Select your timezone:**', getSubMenuKeyboard(region));
                }
            } else if (data.startsWith('settz:')) {
                const tz = data.replace('settz:', '');
                if (process.env.DATABASE_URL) {
                    try {
                        await pool.query(
                            'INSERT INTO user_settings (user_id, timezone) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET timezone = $2',
                            [userId, tz]
                        );
                        await editTelegramMessage(chatId, messageId, `✅ Timezone saved as **${tz}**! You can now use inline reminders.`);
                    } catch (err) {
                        console.error('Error saving user timezone via callback:', err);
                        await sendTelegramMessage(chatId, `⚠️ Could not save timezone right now. Please try again.`);
                    }
                }
            }
        }

        if (inlineQuery) {
            const userId = inlineQuery.from.id;
            const userTz = await getUserTimezone(userId);
            const queryId = inlineQuery.id;
            const queryText = inlineQuery.query.trim();
            let results = [];

            if (!userTz) {
                results.push({
                    type: 'article',
                    id: 'set_tz_required',
                    title: '⚠️ Setup Required: Set Your Timezone',
                    description: 'Tap here to pick your region from a button menu.',
                    input_message_content: {
                        message_text: '⚠️ You must set your timezone before creating reminders!'
                    },
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: '⚙️ Set Timezone Now',
                                    url: 'https://t.me/TurbosRbot?start=tz'
                                }
                            ]
                        ]
                    }
                });
            } else {
                if (queryText.length > 0) {
                    const parsedDate = parseFlexibleDate(queryText, userTz);
                    if (parsedDate) {
                        const dt = DateTime.fromJSDate(parsedDate).setZone(userTz);
                        results.push({
                            type: 'article',
                            id: `custom:${parsedDate.getTime()}:${queryText}`,
                            title: `🔔 Remind: "${queryText}"`,
                            description: `Scheduled for: ${dt.toFormat('ff')}`,
                            input_message_content: {
                                message_text: `🔔 Reminder set for: **${queryText}** (${dt.toFormat('ff')})`
                            }
                        });
                    }
                }

                const presets = [
                    { id: 'in_5m', title: '5 Minutes', time: 'in 5 minutes' },
                    { id: 'in_15m', title: '15 Minutes', time: 'in 15 minutes' },
                    { id: 'in_1h', title: '1 Hour', time: 'in 1 hour' },
                    { id: 'in_1d', title: '1 Day', time: 'in 1 day' }
                ];

                presets.forEach(p => {
                    const parsedDate = chrono.parseDate(p.time, new Date());
                    const dt = DateTime.fromJSDate(parsedDate).setZone(userTz);
                    results.push({
                        type: 'article',
                        id: `${p.id}:${parsedDate.getTime()}:Reminder`,
                        title: `Quick Preset: ${p.title}`,
                        description: `${dt.toFormat('ff')}`,
                        input_message_content: {
                            message_text: `🔔 Reminder set for ${p.title} (${dt.toFormat('ff')})`
                        }
                    });
                });
            }

            try {
                await fetch(`https://api.telegram.org/bot${TOKEN}/answerInlineQuery`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        inline_query_id: queryId,
                        results: results,
                        cache_time: 0
                    })
                });
            } catch (err) {
                console.error('Error answering inline query:', err);
            }
        }

        if (chosenResult) {
            const userId = chosenResult.from.id;
            const resultId = chosenResult.result_id;
            const parts = resultId.split(':');

            if (parts.length >= 2 && parts[0] !== 'set_tz_required') {
                const timestamp = parseInt(parts[1], 10);
                const text = parts.slice(2).join(':') || 'Reminder';
                const remindAt = new Date(timestamp);

                if (process.env.DATABASE_URL) {
                    try {
                        await pool.query(
                            'INSERT INTO reminders (user_id, text, remind_at) VALUES ($1, $2, $3)',
                            [userId, text, remindAt]
                        );
                        console.log(`Saved reminder for user ${userId} at ${remindAt.toISOString()}`);
                    } catch (err) {
                        console.error('Error saving reminder to database:', err);
                    }
                }
            }
        }
    } catch (globalErr) {
        console.error('Unhandled webhook execution error:', globalErr);
    }

    res.sendStatus(200);
});
