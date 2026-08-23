const chrono = require('chrono-node');
const crypto = require('crypto');
const pendingInlineEdits = new Set();
const inlineQueryCache = new Map();
const express = require('express');
const { Telegraf } = require('telegraf');
const { Pool } = require('pg');
const { DateTime } = require('luxon');
const { formatRepeatText, getTimezonePickerKeyboard, getEditMenuKeyboard, getUnitMenuKeyboard, getNumberMenuKeyboard, getLimitMenuKeyboard, getDowMenuKeyboard } = require('./keyboards');
const { sendTelegramMessage, editTelegramMessage, deleteTelegramMessage, answerCallbackQuery } = require('./telegram');

const activityTimers = new Map();

// MODIFICATION 1: Added delay parameter defaulting to 30000
function resetMenuTimer(key, action, delay = 30000) {
    if (activityTimers.has(key)) clearTimeout(activityTimers.get(key));
    activityTimers.set(key, setTimeout(() => {
        activityTimers.delete(key);
        action();
    }, delay));
}

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OWNER_ID = process.env.OWNER_ID ? parseInt(process.env.OWNER_ID, 10) : 6293437261;

if (!TOKEN || !process.env.DATABASE_URL) {
    console.error('CRITICAL: Missing TELEGRAM_BOT_TOKEN or DATABASE_URL');
    process.exit(1);
}

app.get('/', (req, res) => res.status(200).send('OK'));
app.listen(PORT, '0.0.0.0', () => console.log(`Server listening on port ${PORT}`));

const isInternalHost = process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway.internal');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isInternalHost ? false : (process.env.DATABASE_URL ? { rejectUnauthorized: false } : false),
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000
});

pool.on('error', (err) => console.error('Unexpected Postgres pool error:', err));

async function initDb() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS user_settings ( user_id BIGINT PRIMARY KEY, timezone TEXT NOT NULL DEFAULT 'America/Chicago', pending_edit TEXT DEFAULT NULL, trigger_msg_id BIGINT DEFAULT NULL, active_menu_msg_id BIGINT DEFAULT NULL, collapse_at TIMESTAMPTZ DEFAULT NULL );`);
    } catch (e) { console.error(e); } // Restored catch block
}
initDb();

setInterval(async () => {
    try {
        const res = await pool.query(`SELECT * FROM reminders WHERE (remind_at <= NOW() AND sent = FALSE) OR (early_offset IS NOT NULL AND early_alert_sent = FALSE AND remind_at - (early_offset * INTERVAL '1 minute') <= NOW())`);
        for (const r of res.rows) {
            const now = new Date();
        }
    } catch (e) { console.error(e); } // Restored catch block
}, 30000);

async function getUserTimezone(userId) {
    if (!process.env.DATABASE_URL) return 'America/Chicago';
    try {
        const res = await pool.query('SELECT timezone FROM user_settings WHERE user_id = $1', [userId]);
        return res.rows.length > 0 ? res.rows[0].timezone : 'America/Chicago';
    } catch (err) {
        return 'America/Chicago';
    }
}

async function setUserTimezone(userId, tz) {
    if (!process.env.DATABASE_URL) return;
    try {
        await pool.query(`INSERT INTO user_settings (user_id, timezone) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET timezone = $2`, [userId, tz]);
    } catch (err) {
        console.error('Error saving user timezone:', err);
    }
}

async function getActiveMenuMsgId(userId) {
    if (!process.env.DATABASE_URL) return null;
    try {
        const res = await pool.query('SELECT active_menu_msg_id FROM user_settings WHERE user_id = $1', [userId]);
        return (res.rows.length > 0 && res.rows[0].active_menu_msg_id) ? res.rows[0].active_menu_msg_id : null;
    } catch (err) {
        return null;
    }
}

async function setActiveMenuMsgId(userId, msgId, triggerMsgId = null) {
    if (!process.env.DATABASE_URL) return;
    try {
        const collapseAt = msgId ? new Date(Date.now() + 30000) : null;
        await pool.query(`INSERT INTO user_settings (user_id, active_menu_msg_id, trigger_msg_id, collapse_at, timezone) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id) DO UPDATE SET active_menu_msg_id = $2, trigger_msg_id = COALESCE($3, user_settings.trigger_msg_id), collapse_at = $4, timezone = COALESCE(user_settings.timezone, EXCLUDED.timezone)`, [userId, msgId, triggerMsgId, collapseAt, 'America/Chicago']);
    } catch (err) {
        console.error('Error setting active menu msg id:', err);
    }
}

async function getPendingEdit(userId) {
    if (!process.env.DATABASE_URL) return null;
    try {
        const res = await pool.query('SELECT pending_edit FROM user_settings WHERE user_id = $1', [userId]);
        return res.rows.length > 0 ? res.rows[0].pending_edit : null;
    } catch (err) {
        return null;
    }
}

async function setPendingEdit(userId, pendingStr) {
    if (!process.env.DATABASE_URL) return;
    try {
        await pool.query(`INSERT INTO user_settings (user_id, pending_edit) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET pending_edit = $2`, [userId, pendingStr]);
    } catch (err) {
        console.error('Error setting pending edit:', err);
    }
}

function calculateNextOccurrence(currentDate, recurringStr, timeZone) {
    let dt = DateTime.fromJSDate(currentDate).setZone(timeZone);
    const parts = recurringStr.split(':');
    const type = parts[0];
    const interval = parseInt(parts[1] || '1', 10);
}

function parseFlexibleDate(text, timeZone) {
    let clean = text.trim().replace(/^reminder\s*/i, '');
    const cleanNoEmoji = clean.replace(/^(?:(?:\p{Extended_Pictographic})(?:\uFE0F|\u200D(?:\p{Extended_Pictographic})) *(?:\s|$))+/u, '').replace(/^(?:[\p{Extended_Pictographic}\uFE0F\u200D]+\s* )+/u, '').trim();
    let dateInput = cleanNoEmoji || clean;
    const nowInZone = DateTime.now().setZone(timeZone);
}

async function getRemindersDashboardData(userId, userTz, passedName = null) {
    try {
        let uName = passedName || 'Your';
        let titleName = uName === 'Your' ? 'Your' : `${uName}'s`;
    } catch (e) { console.error(e); }
}

async function sendOrUpdateDashboard(userId, text, markup, triggerMsgId = null) {
    const existingMsgId = await getActiveMenuMsgId(userId);
    let targetMsgId = null;
}

app.post('/webhook', async (req, res) => {
    if (process.env.WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== process.env.WEBHOOK_SECRET) {
        return res.sendStatus(403);
    }
    try {
        const { message, callback_query: callbackQuery, inline_query: inlineQuery, chosen_inline_result: chosenResult } = req.body;
        
        // MODIFICATION 2: Added 10-second inline collapse logic here
        if (chosenResult && chosenResult.inline_message_id) {
            const iMsgId = chosenResult.inline_message_id;
            
            resetMenuTimer(`collapse_inline_${iMsgId}`, async () => {
                try {
                    await fetch(`https://api.telegram.org/bot${TOKEN}/editMessageText`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            inline_message_id: iMsgId,
                            text: `<b>🍟 Ding! Fries are done.</b>`,
                            parse_mode: 'HTML'
                        })
                    });
                } catch (err) {
                    console.error('Inline collapse failed:', err);
                }
            }, 10000);
        }
        
        res.sendStatus(200); // Close the webhook request
    } catch (e) {
        console.error(e);
        res.sendStatus(500);
    }
});