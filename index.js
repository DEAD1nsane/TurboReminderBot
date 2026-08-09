const express = require('express');
const chrono = require('chrono-node');
const { DateTime } = require('luxon');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OWNER_ID = 6293437261;

app.get('/', (req, res) => {
    res.status(200).send('OK');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
});

const isInternalHost = process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway.internal');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isInternalHost ? false : (process.env.DATABASE_URL ? { rejectUnauthorized: false } : false),
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
    console.error('Unexpected Postgres pool error:', err);
});

async function initDb() {
    if (!process.env.DATABASE_URL) {
        console.warn('DATABASE_URL is missing!');
        return;
    }
    const query = `
        CREATE TABLE IF NOT EXISTS user_settings (
            user_id BIGINT PRIMARY KEY,
            timezone TEXT NOT NULL DEFAULT 'UTC',
            active_menu_msg_id BIGINT DEFAULT NULL
        );
        ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS active_menu_msg_id BIGINT DEFAULT NULL;
        CREATE TABLE IF NOT EXISTS reminders (
            id SERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL,
            chat_id BIGINT,
            text TEXT NOT NULL,
            remind_at TIMESTAMP WITH TIME ZONE NOT NULL,
            sent BOOLEAN DEFAULT FALSE,
            recurring TEXT DEFAULT NULL,
            total_occurrences INT DEFAULT NULL,
            current_occurrence INT DEFAULT 0
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

async function setUserTimezone(userId, tz) {
    if (!process.env.DATABASE_URL) return;
    try {
        await pool.query(
            `INSERT INTO user_settings (user_id, timezone) 
             VALUES ($1, $2) 
             ON CONFLICT (user_id) DO UPDATE SET timezone = $2`,
            [userId, tz]
        );
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

async function setActiveMenuMsgId(userId, msgId) {
    if (!process.env.DATABASE_URL) return;
    try {
        await pool.query(
            `INSERT INTO user_settings (user_id, timezone, active_menu_msg_id) 
             VALUES ($1, 'UTC', $2) 
             ON CONFLICT (user_id) DO UPDATE SET active_menu_msg_id = $2`,
            [userId, msgId]
        );
    } catch (err) {
        console.error('Error setting active menu msg id:', err);
    }
}

function formatRepeatText(rec) {
    if (!rec) return 'None';
    const [type, num] = rec.split(':');
    if (type === 'daily' || type === 'days') return num === '1' ? 'Daily' : `Every ${num} Days`;
    if (type === 'weekly' || type === 'weeks') return num === '1' ? 'Weekly' : `Every ${num} Weeks`;
    if (type === 'monthly' || type === 'months') return num === '1' ? 'Monthly' : `Every ${num} Months`;
    if (type === 'hourly' || type === 'hours') return num === '1' ? 'Hourly' : `Every ${num} Hours`;
    return `${type} ${num}`;
}

function calculateNextOccurrence(currentDate, recurringStr, timeZone) {
    let dt = DateTime.fromJSDate(currentDate).setZone(timeZone);
    const parts = recurringStr.split(':');
    const type = parts[0];
    const interval = parseInt(parts[1] || '1', 10);

    if (type === 'daily' || type === 'days') dt = dt.plus({ days: interval });
    else if (type === 'weekly' || type === 'weeks') dt = dt.plus({ weeks: interval });
    else if (type === 'monthly' || type === 'months') dt = dt.plus({ months: interval });
    else if (type === 'hourly' || type === 'hours') dt = dt.plus({ hours: interval });

    return dt.toJSDate();
}

function parseFlexibleDate(text, timeZone) {
    let clean = text.trim().replace(/^reminder\s*/i, '');
    const nowInZone = DateTime.now().setZone(timeZone);

    let wantRepeatMenu = false;
    if (/\brepeat\b$/i.test(clean)) {
        wantRepeatMenu = true;
        clean = clean.replace(/\brepeat\b$/i, '').trim();
    }

    const compoundRegex = /^((?:\d+d)?\s*(?:\d+h)?\s*(?:\d+m)?\s*(?:\d+s)?)\s+(.+)$/i;
    const match = clean.match(compoundRegex);

    if (match && match[1].trim().length > 0) {
        const timePart = match[1];
        const days = (timePart.match(/(\d+)d/i) || [])[1] ? parseInt(RegExp.$1, 10) : 0;
        const hours = (timePart.match(/(\d+)h/i) || [])[1] ? parseInt(RegExp.$1, 10) : 0;
        const minutes = (timePart.match(/(\d+)m/i) || [])[1] ? parseInt(RegExp.$1, 10) : 0;
        const seconds = (timePart.match(/(\d+)s/i) || [])[1] ? parseInt(RegExp.$1, 10) : 0;

        if (days > 0 || hours > 0 || minutes > 0 || seconds > 0) {
            let dt = nowInZone;
            if (days) dt = dt.plus({ days });
            if (hours) dt = dt.plus({ hours });
            if (minutes) dt = dt.plus({ minutes });
            if (seconds) dt = dt.plus({ seconds });

            if (dt <= nowInZone.plus({ seconds: 59 })) return null;
            return { date: dt.toJSDate(), reminderText: match[2].trim(), wantRepeatMenu };
        }
    }

    const parsed = chrono.parse(clean, nowInZone.toJSDate(), { forwardDate: true });
    if (parsed.length > 0) {
        const parsedResult = parsed[0];
        const parsedComp = parsedResult.start;

        let dt = nowInZone.set({
            hour: parsedComp.get('hour') !== null ? parsedComp.get('hour') : nowInZone.hour,
            minute: parsedComp.get('minute') !== null ? parsedComp.get('minute') : 0,
            second: 0,
            millisecond: 0
        });

        if (parsedComp.get('day') !== null) {
            dt = dt.set({
                year: parsedComp.get('year') || nowInZone.year,
                month: parsedComp.get('month'),
                day: parsedComp.get('day')
            });
        }

        if (dt <= nowInZone) {
            dt = dt.plus({ days: 1 });
        }

        const reminderText = clean.replace(parsedResult.text, '').trim() || clean;
        return { date: dt.toJSDate(), reminderText: reminderText, wantRepeatMenu };
    }
    return null;
}

async function sendTelegramMessage(chatId, text, replyMarkup = null, autoDeleteMs = null) {
    const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
    const payload = { chat_id: chatId, text: text, parse_mode: 'HTML' };
    if (replyMarkup) payload.reply_markup = replyMarkup;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        
        if (data.ok && data.result) {
            const messageId = data.result.message_id;
            if (autoDeleteMs) {
                setTimeout(() => {
                    deleteTelegramMessage(chatId, messageId);
                }, autoDeleteMs);
            }
            return data.result;
        }
    } catch (err) {
        console.error('Error sending message:', err);
    }
    return null;
}

async function editTelegramMessage(chatId, messageId, text, replyMarkup = null) {
    const url = `https://api.telegram.org/bot${TOKEN}/editMessageText`;
    const payload = { chat_id: chatId, message_id: messageId, text: text, parse_mode: 'HTML' };
    if (replyMarkup !== undefined) payload.reply_markup = replyMarkup;

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        return data.ok;
    } catch (err) {
        console.error('Error editing message:', err);
        return false;
    }
}

async function deleteTelegramMessage(chatId, messageId) {
    const url = `https://api.telegram.org/bot${TOKEN}/deleteMessage`;
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, message_id: messageId })
        });
    } catch (err) {
        console.error('Error deleting message:', err);
    }
}

async function answerCallbackQuery(callbackQueryId, text = '', showAlert = false) {
    const url = `https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`;
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: callbackQueryId, text: text, show_alert: showAlert })
        });
    } catch (err) {
        console.error('Error answering callback query:', err);
    }
}

async function getRemindersDashboardData(userId, userTz) {
    try {
        const res = await pool.query('SELECT id, text, remind_at, recurring, total_occurrences FROM reminders WHERE user_id = $1 AND sent = FALSE ORDER BY remind_at ASC', [userId]);
        if (res.rows.length === 0) {
            return {
                text: '📋 <b>Your Active Reminders:</b>\n━━━━━━━━━━━━━━━━━━\n\n<i>📭 No active reminders found.</i>',
                keyboard: { inline_keyboard: [[{ text: '📭 No active reminders', callback_data: 'noop' }]] }
            };
        }

        let bodyLines = ['📋 <b>Your Active Reminders:</b>', '━━━━━━━━━━━━━━━━━━'];
        let buttonRows = [];
        let currentRow = [];

        res.rows.forEach((r, idx) => {
            const num = idx + 1;
            const dt = DateTime.fromJSDate(new Date(r.remind_at)).setZone(userTz);
            const timeShort = dt.toFormat('MM/dd h:mm a');

            let repeatIcon = '';
            if (r.recurring) {
                repeatIcon = r.total_occurrences ? ' 🔢' : ' 🔄';
            }

            bodyLines.push(`${num}. <b>${r.text}</b>${repeatIcon} <i>(${timeShort})</i>`);

            currentRow.push({ text: `⚙️ Manage #${num}`, callback_data: `manage:${r.id}:${num}` });

            if (currentRow.length === 2 || idx === res.rows.length - 1) {
                buttonRows.push(currentRow);
                currentRow = [];
            }
        });

        return {
            text: bodyLines.join('\n'),
            keyboard: { inline_keyboard: buttonRows }
        };
    } catch (err) {
        console.error('Error fetching reminders for dashboard:', err);
        return {
            text: '⚠️ Error loading reminders.',
            keyboard: { inline_keyboard: [[{ text: '⚠️ Error loading reminders', callback_data: 'noop' }]] }
        };
    }
}

function getTimezonePickerKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: '🇺🇸 Eastern (EST/EDT)', callback_data: 'settz:America/New_York' },
                { text: '🇺🇸 Central (CST/CDT)', callback_data: 'settz:America/Chicago' }
            ],
            [
                { text: '🇺🇸 Mountain (MST/MDT)', callback_data: 'settz:America/Denver' },
                { text: '🇺🇸 Pacific (PST/PDT)', callback_data: 'settz:America/Los_Angeles' }
            ],
            [
                { text: '🇬🇧 London (GMT/BST)', callback_data: 'settz:Europe/London' },
                { text: '🇪🇺 Central Europe (CET)', callback_data: 'settz:Europe/Paris' }
            ],
            [
                { text: '🌐 UTC', callback_data: 'settz:UTC' }
            ]
        ]
    };
}

function getEditMenuKeyboard(reminderId, currentRecurring, totalOccurrences) {
    const recType = formatRepeatText(currentRecurring);
    const limitLabel = totalOccurrences ? `${totalOccurrences}x` : 'Forever';

    return {
        inline_keyboard: [
            [
                { text: currentRecurring === null ? '✅ None' : 'None', callback_data: `setrec:${reminderId}:none` },
                { text: currentRecurring === 'daily:1' ? '✅ Daily' : 'Daily', callback_data: `setrec:${reminderId}:daily:1` }
            ],
            [
                { text: currentRecurring === 'weekly:1' ? '✅ Weekly' : 'Weekly', callback_data: `setrec:${reminderId}:weekly:1` },
                { text: currentRecurring === 'monthly:1' ? '✅ Monthly' : 'Monthly', callback_data: `setrec:${reminderId}:monthly:1` }
            ],
            [
                { text: `⚙️ Custom Interval (${recType})`, callback_data: `unitmenu:${reminderId}` },
                { text: `🔁 Repeat Limit (${limitLabel})`, callback_data: `limitmenu:${reminderId}` }
            ],
            [
                { text: '⬅️ Back to Reminders', callback_data: 'menu:list' }
            ]
        ]
    };
}

function getUnitMenuKeyboard(reminderId) {
    return {
        inline_keyboard: [
            [
                { text: '⏱️ Hours', callback_data: `nummenu:${reminderId}:hours` },
                { text: '📅 Days', callback_data: `nummenu:${reminderId}:days` }
            ],
            [
                { text: '🗓️ Weeks', callback_data: `nummenu:${reminderId}:weeks` },
                { text: '📆 Months', callback_data: `nummenu:${reminderId}:months` }
            ],
            [
                { text: '⬅️ Back to Edit', callback_data: `edit:${reminderId}` }
            ]
        ]
    };
}

function getNumberMenuKeyboard(reminderId, unit) {
    const nums = [2, 3, 4, 5, 6, 8, 10, 12, 14, 21, 30];
    let buttons = [];
    let row = [];

    nums.forEach((n, idx) => {
        row.push({ text: `${n}`, callback_data: `setrec:${reminderId}:${unit}:${n}` });
        if (row.length === 4 || idx === nums.length - 1) {
            buttons.push(row);
            row = [];
        }
    });

    buttons.push([{ text: '⬅️ Back to Units', callback_data: `unitmenu:${reminderId}` }]);
    return { inline_keyboard: buttons };
}

function getLimitMenuKeyboard(reminderId, totalOccurrences) {
    const current = totalOccurrences || 0;
    const limits = [0, 2, 3, 5, 10, 15, 20, 30, 50, 100];
    let buttons = [];
    let row = [];

    limits.forEach((val, idx) => {
        const label = val === 0 ? 'Forever' : `${val}x`;
        const activeTag = current === val ? `✅ ${label}` : label;
        row.push({ text: activeTag, callback_data: `setlimit:${reminderId}:${val}` });
        if (row.length === 3 || idx === limits.length - 1) {
            buttons.push(row);
            row = [];
        }
    });

    buttons.push([{ text: '⬅️ Back to Edit', callback_data: `edit:${reminderId}` }]);
    return { inline_keyboard: buttons };
}

let activeTimers = {};

async function sendOrUpdateDashboard(userId, text, markup) {
    const existingMsgId = await getActiveMenuMsgId(userId);
    let targetMsgId = existingMsgId;

    if (existingMsgId) {
        const success = await editTelegramMessage(userId, existingMsgId, text, markup);
        if (!success) {
            await deleteTelegramMessage(userId, existingMsgId);
            const newMsg = await sendTelegramMessage(userId, text, markup);
            if (newMsg) {
                targetMsgId = newMsg.message_id;
                await setActiveMenuMsgId(userId, targetMsgId);
            }
        }
    } else {
        const newMsg = await sendTelegramMessage(userId, text, markup);
        if (newMsg) {
            targetMsgId = newMsg.message_id;
            await setActiveMenuMsgId(userId, targetMsgId);
        }
    }

    if (activeTimers[userId]) clearTimeout(activeTimers[userId]);

    activeTimers[userId] = setTimeout(async () => {
        if (targetMsgId) {
            await editTelegramMessage(userId, targetMsgId, '🤖 Reminder Bot Active', null);
        }
    }, 30000);
}

setInterval(async () => {
    if (!process.env.DATABASE_URL) return;
    try {
        const res = await pool.query('SELECT * FROM reminders WHERE remind_at <= CURRENT_TIMESTAMP AND sent = FALSE');
        for (const reminder of res.rows) {
            const targetChat = reminder.chat_id || reminder.user_id;
            const newCount = (reminder.current_occurrence || 0) + 1;
            const userTz = (await getUserTimezone(reminder.user_id)) || 'UTC';
            const dt = DateTime.fromJSDate(new Date(reminder.remind_at)).setZone(userTz);
            const formattedTime = dt.toFormat('ff');

            let headerIcon = '';
            let progressFooter = '';

            if (reminder.recurring) {
                if (reminder.total_occurrences) {
                    headerIcon = ' 🔢';
                    progressFooter = `\n🔢 <i>${newCount} of ${reminder.total_occurrences}</i>`;
                } else {
                    headerIcon = ' 🔄';
                }
            }

            const alertText = `🔔 <b>Reminder Alert${headerIcon}</b>\n━━━━━━━━━━━━━━━━━━\n🕒 <i>${formattedTime}</i>\n📝 <b>${reminder.text}</b>${progressFooter}`;

            await sendTelegramMessage(targetChat, alertText);

            if (reminder.recurring && (!reminder.total_occurrences || newCount < reminder.total_occurrences)) {
                const nextDate = calculateNextOccurrence(new Date(reminder.remind_at), reminder.recurring, userTz);
                await pool.query('UPDATE reminders SET remind_at = $1, current_occurrence = $2 WHERE id = $3', [nextDate, newCount, reminder.id]);
            } else {
                await pool.query('UPDATE reminders SET sent = TRUE, current_occurrence = $1 WHERE id = $2', [newCount, reminder.id]);
            }
        }
    } catch (err) {
        if (err.code === 'ECONNRESET' || (err.message && err.message.includes('Connection terminated'))) {
            console.warn('Postgres connection resetting, retrying next cycle...');
        } else {
            console.error('Error checking scheduled reminders:', err);
        }
    }
}, 3000);

app.post('/webhook', async (req, res) => {
    try {
        const message = req.body.message;
        const callbackQuery = req.body.callback_query;
        const inlineQuery = req.body.inline_query;

        if (inlineQuery) {
            const userId = inlineQuery.from.id;
            const userTz = (await getUserTimezone(userId)) || 'UTC';
            const dashData = await getRemindersDashboardData(userId, userTz);

            const results = [{
                type: 'article',
                id: '1',
                title: '📋 View Active Reminders',
                description: 'Click to open active reminders popup menu',
                input_message_content: {
                    message_text: dashData.text,
                    parse_mode: 'HTML'
                },
                reply_markup: dashData.keyboard
            }];

            const url = `https://api.telegram.org/bot${TOKEN}/answerInlineQuery`;
            await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    inline_query_id: inlineQuery.id,
                    results: results,
                    cache_time: 0
                })
            });
            return res.sendStatus(200);
        }

        if (message && message.text) {
            const userId = message.from.id;
            const chatId = message.chat.id;
            const text = message.text.trim();

            if (text.startsWith('/start') || text.toLowerCase() === 'view' || text.toLowerCase() === 'reminders' || text.toLowerCase() === 'list') {
                const existingTz = await getUserTimezone(userId);
                if (existingTz) {
                    const dashData = await getRemindersDashboardData(userId, existingTz);
                    await sendOrUpdateDashboard(userId, dashData.text, dashData.keyboard);
                } else {
                    await sendTelegramMessage(userId, '👋 Welcome! Please select your primary timezone:', getTimezonePickerKeyboard());
                }
                return res.sendStatus(200);
            }

            const userTz = (await getUserTimezone(userId)) || 'UTC';
            const parsed = parseFlexibleDate(text, userTz);

            if (parsed) {
                const insertRes = await pool.query(
                    'INSERT INTO reminders (user_id, chat_id, text, remind_at) VALUES ($1, $2, $3, $4) RETURNING id',
                    [userId, chatId, parsed.reminderText, parsed.date]
                );

                const dashData = await getRemindersDashboardData(userId, userTz);
                await sendOrUpdateDashboard(userId, dashData.text, dashData.keyboard);
            }
            return res.sendStatus(200);
        }

        if (callbackQuery && callbackQuery.data) {
            const data = callbackQuery.data;
            const userId = callbackQuery.from.id;
            const messageId = callbackQuery.message.message_id;

            if (data.startsWith('settz:')) {
                const tz = data.split(':')[1];
                await setUserTimezone(userId, tz);
                await answerCallbackQuery(callbackQuery.id, `Timezone set to ${tz}`);
                const dashData = await getRemindersDashboardData(userId, tz);
                await sendOrUpdateDashboard(userId, tz);
                return res.sendStatus(200);
            }

            if (data.startsWith('manage:')) {
                const parts = data.split(':');
                const reminderId = parts[1];
                const num = parts[2];

                const subMenu = {
                    inline_keyboard: [
                        [
                            { text: '✏️ Edit', callback_data: `edit:${reminderId}` },
                            { text: '❌ Delete', callback_data: `del:${reminderId}` }
                        ],
                        [
                            { text: '⬅️ Back to Reminders', callback_data: 'menu:list' }
                        ]
                    ]
                };

                await editTelegramMessage(userId, messageId, `⚙️ <b>Managing Reminder #${num}</b>\nSelect an action:`, subMenu);
                await answerCallbackQuery(callbackQuery.id);
                return res.sendStatus(200);
            }

            if (data === 'menu:list') {
                const userTz = (await getUserTimezone(userId)) || 'UTC';
                const dashData = await getRemindersDashboardData(userId, userTz);
                await editTelegramMessage(userId, messageId, dashData.text, dashData.keyboard);
                await answerCallbackQuery(callbackQuery.id);
                return res.sendStatus(200);
            }

            if (data.startsWith('del:')) {
                const reminderId = data.split(':')[1];
                await pool.query('DELETE FROM reminders WHERE id = $1 AND user_id = $2', [reminderId, userId]);
                await answerCallbackQuery(callbackQuery.id, 'Reminder deleted!');
                const userTz = (await getUserTimezone(userId)) || 'UTC';
                const dashData = await getRemindersDashboardData(userId, userTz);
                await editTelegramMessage(userId, messageId, dashData.text, dashData.keyboard);
                return res.sendStatus(200);
            }

            if (data.startsWith('edit:')) {
                const reminderId = data.split(':')[1];
                const resRem = await pool.query('SELECT recurring, total_occurrences FROM reminders WHERE id = $1', [reminderId]);
                if (resRem.rows.length > 0) {
                    const r = resRem.rows[0];
                    const editKb = getEditMenuKeyboard(reminderId, r.recurring, r.total_occurrences);
                    await editTelegramMessage(userId, messageId, `✏️ <b>Edit Recurrence Settings</b>`, editKb);
                }
                await answerCallbackQuery(callbackQuery.id);
                return res.sendStatus(200);
            }

            if (data.startsWith('setrec:')) {
                const parts = data.split(':');
                const reminderId = parts[1];
                let recValue = null;

                if (parts[2] !== 'none') {
                    recValue = `${parts[2]}:${parts[3] || 1}`;
                }

                await pool.query('UPDATE reminders SET recurring = $1 WHERE id = $2 AND user_id = $3', [recValue, reminderId, userId]);
                await answerCallbackQuery(callbackQuery.id, 'Recurrence updated!');

                const resRem = await pool.query('SELECT recurring, total_occurrences FROM reminders WHERE id = $1', [reminderId]);
                if (resRem.rows.length > 0) {
                    const r = resRem.rows[0];
                    const editKb = getEditMenuKeyboard(reminderId, r.recurring, r.total_occurrences);
                    await editTelegramMessage(userId, messageId, `✏️ <b>Edit Recurrence Settings</b>`, editKb);
                }
                return res.sendStatus(200);
            }

            if (data.startsWith('unitmenu:')) {
                const reminderId = data.split(':')[1];
                await editTelegramMessage(userId, messageId, `⏱️ <b>Select Recurrence Unit</b>`, getUnitMenuKeyboard(reminderId));
                await answerCallbackQuery(callbackQuery.id);
                return res.sendStatus(200);
            }

            if (data.startsWith('nummenu:')) {
                const parts = data.split(':');
                const reminderId = parts[1];
                const unit = parts[2];
                await editTelegramMessage(userId, messageId, `🔢 <b>Select Interval (${unit})</b>`, getNumberMenuKeyboard(reminderId, unit));
                await answerCallbackQuery(callbackQuery.id);
                return res.sendStatus(200);
            }

            if (data.startsWith('limitmenu:')) {
                const reminderId = data.split(':')[1];
                const resRem = await pool.query('SELECT total_occurrences FROM reminders WHERE id = $1', [reminderId]);
                const totalOcc = resRem.rows.length > 0 ? resRem.rows[0].total_occurrences : 0;
                await editTelegramMessage(userId, messageId, `🔁 <b>Select Repeat Limit</b>`, getLimitMenuKeyboard(reminderId, totalOcc));
                await answerCallbackQuery(callbackQuery.id);
                return res.sendStatus(200);
            }

            if (data.startsWith('setlimit:')) {
                const parts = data.split(':');
                const reminderId = parts[1];
                const limitVal = parseInt(parts[2], 10);
                const finalLimit = limitVal === 0 ? null : limitVal;

                await pool.query('UPDATE reminders SET total_occurrences = $1 WHERE id = $2 AND user_id = $3', [finalLimit, reminderId, userId]);
                await answerCallbackQuery(callbackQuery.id, 'Limit updated!');

                const resRem = await pool.query('SELECT recurring, total_occurrences FROM reminders WHERE id = $1', [reminderId]);
                if (resRem.rows.length > 0) {
                    const r = resRem.rows[0];
                    const editKb = getEditMenuKeyboard(reminderId, r.recurring, r.total_occurrences);
                    await editTelegramMessage(userId, messageId, `✏️ <b>Edit Recurrence Settings</b>`, editKb);
                }
                return res.sendStatus(200);
            }
        }

        res.sendStatus(200);
    } catch (err) {
        console.error('Webhook error:', err);
        res.sendStatus(500);
    }
});
