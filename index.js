const chrono = require('chrono-node');
const dmCollapseTimers = new Map();
const pendingInlineEdits = new Set();
const express = require('express');
const { Telegraf } = require('telegraf');
const { Pool } = require('pg');
const { DateTime } = require('luxon');
const { 
    formatRepeatText, 
    getTimezonePickerKeyboard, 
    getEditMenuKeyboard, 
    getUnitMenuKeyboard, 
    getNumberMenuKeyboard, 
    getLimitMenuKeyboard 
} = require('./keyboards');
const { 
    sendTelegramMessage, 
    editTelegramMessage, 
    deleteTelegramMessage, 
    answerCallbackQuery 
} = require('./telegram');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OWNER_ID = 6293437261;

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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id BIGINT PRIMARY KEY,
        timezone TEXT NOT NULL DEFAULT 'America/Chicago',
        pending_edit TEXT DEFAULT NULL,
        trigger_msg_id BIGINT DEFAULT NULL,
        active_menu_msg_id BIGINT DEFAULT NULL,
        collapse_at TIMESTAMPTZ DEFAULT NULL
      );
    `);

    await pool.query(`
      ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS pending_edit TEXT DEFAULT NULL;
      ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS trigger_msg_id BIGINT DEFAULT NULL;
      ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS active_menu_msg_id BIGINT DEFAULT NULL;
      ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS collapse_at TIMESTAMPTZ DEFAULT NULL;
      ALTER TABLE user_settings ALTER COLUMN timezone SET DEFAULT 'America/Chicago';
      UPDATE user_settings SET timezone = 'America/Chicago' WHERE timezone IS NULL;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS reminders (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        chat_id BIGINT,
        text TEXT NOT NULL,
        remind_at TIMESTAMPTZ NOT NULL,
        sent BOOLEAN DEFAULT FALSE,
        recurring TEXT DEFAULT NULL,
        total_occurrences INT DEFAULT NULL,
        current_occurrence INT DEFAULT 0
      );
    `);
    console.log("Database initialized successfully!");
  } catch (err) {
    console.error("Error initializing database:", err);
  }
}
initDb();

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
        await pool.query(
            `INSERT INTO user_settings (user_id, timezone) VALUES ($1, $2) 
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

async function setActiveMenuMsgId(userId, msgId, triggerMsgId = null) {
    if (!process.env.DATABASE_URL) return;
    try {
        const collapseAt = msgId ? new Date(Date.now() + 30000) : null;
        await pool.query(
      `INSERT INTO user_settings (user_id, active_menu_msg_id, trigger_msg_id, collapse_at, timezone)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET 
         active_menu_msg_id = $2, 
         trigger_msg_id = COALESCE($3, user_settings.trigger_msg_id), 
         collapse_at = $4,
         timezone = COALESCE(user_settings.timezone, EXCLUDED.timezone)`,
      [userId, msgId, triggerMsgId, collapseAt, 'America/Chicago']
	);
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
        await pool.query(
            `INSERT INTO user_settings (user_id, pending_edit) 
             VALUES ($1, $2) 
             ON CONFLICT (user_id) DO UPDATE SET pending_edit = $2`,
            [userId, pendingStr]
        );
    } catch (err) {
        console.error('Error setting pending edit:', err);
    }
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
            const reminderText = (match[2] && match[2].trim()) ? match[2].trim() : clean;
            return { dt, date: dt.toJSDate(), text: reminderText, wantRepeatMenu };
        }
            return { date: dt.toJSDate(), reminderText: match[2].trim(), wantRepeatMenu };
        }
    }

    const referenceDate = new Date(nowInZone.year, nowInZone.month - 1, nowInZone.day, nowInZone.hour, nowInZone.minute, nowInZone.second);
    const parsed = chrono.parse(clean, referenceDate, { forwardDate: true });
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
            if (parsedComp.get('day') === null && parsedComp.get('month') === null) {
                dt = dt.plus({ days: 1 });
            } else {
                return null;
            }
        }

        let reminderText = clean.replace(parsedResult.text, '').trim();
        if (!reminderText) reminderText = 'Reminder';

        return { date: dt.toJSDate(), reminderText: reminderText, wantRepeatMenu };
    }
    return null;
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

        let buttons = res.rows.map(r => {
            let statusIcon = r.recurring ? (r.total_occurrences ? '🔢 ' : '🔄 ') : '';
            return [
                { text: `${statusIcon}${r.text}`, callback_data: `view:${r.id}` },
                { text: '✏️ Edit', callback_data: `edit:${r.id}` },
                { text: '❌ Del', callback_data: `del:${r.id}` }
            ];
        });

        return { text: '📋 <b>Your Active Reminders:</b>', keyboard: { inline_keyboard: buttons } };
    } catch (err) {
        console.error('Error fetching reminders for dashboard:', err);
        return { text: '⚠️ Error loading reminders.', keyboard: { inline_keyboard: [[{ text: '⚠️ Error loading reminders', callback_data: 'noop' }]] } };
    }
}

async function sendOrUpdateDashboard(userId, text, markup, triggerMsgId = null) {
    if (dmCollapseTimers.has(userId)) {
        clearTimeout(dmCollapseTimers.get(userId));
        dmCollapseTimers.delete(userId);
    }

    const existingMsgId = await getActiveMenuMsgId(userId);
    let targetMsgId = null;

    if (existingMsgId) {
        const success = await editTelegramMessage(userId, existingMsgId, text, markup);
        if (success) {
            targetMsgId = existingMsgId;
            await setActiveMenuMsgId(userId, targetMsgId, triggerMsgId);
        } else {
            await deleteTelegramMessage(userId, existingMsgId);
            const newMsg = await sendTelegramMessage(userId, text, markup);
            if (newMsg) {
                targetMsgId = newMsg.message_id;
                await setActiveMenuMsgId(userId, targetMsgId, triggerMsgId);
            }
        }
    } else {
        const newMsg = await sendTelegramMessage(userId, text, markup);
        if (newMsg) {
            targetMsgId = newMsg.message_id;
            await setActiveMenuMsgId(userId, targetMsgId, triggerMsgId);
        }
    }

    if (targetMsgId) {
        const timer = setTimeout(async () => {
            try {
                await deleteTelegramMessage(userId, targetMsgId);
                await setActiveMenuMsgId(userId, null);
                dmCollapseTimers.delete(userId);
            } catch (err) {
                console.error('Failed to auto-delete DM dashboard:', err);
            }
        }, 30000);
        dmCollapseTimers.set(userId, timer);
    }
}


app.post('/webhook', async (req, res) => {
    console.log('[WEBHOOK LOG]:', JSON.stringify(req.body));
    try {
        const { message, callback_query: callbackQuery, inline_query: inlineQuery, chosen_inline_result: chosenResult } = req.body;

        if (message && message.text) {
            const userId = message.from.id;
            const chatId = message.chat.id;
            const msgId = message.message_id;
            const text = message.text.trim();

            const pendingEdit = await getPendingEdit(userId);
            if (pendingEdit) {
                const [field, reminderId] = pendingEdit.split(':');
                const userTz = await getUserTimezone(userId);

                if (field === 'text') {
                    await pool.query('UPDATE reminders SET text = $1 WHERE id = $2 AND user_id = $3', [text, reminderId, userId]);
                    await sendTelegramMessage(userId, `✅ Reminder text updated to: "<b>${text}</b>"`, null, 5000);
                } else if (field === 'time') {
                    const parsed = parseFlexibleDate(text, userTz);
                    if (parsed) {
                        await pool.query('UPDATE reminders SET remind_at = $1 WHERE id = $2 AND user_id = $3', [parsed.date, reminderId, userId]);
                        const localDt = DateTime.fromJSDate(parsed.date).setZone(userTz);
                        await sendTelegramMessage(userId, `✅ Reminder time updated to: <i>${localDt.toFormat("LLL d, yyyy 'at' h:mm a")}</i>`, null, 5000);
                    } else {
                        await sendTelegramMessage(userId, '⚠️ Could not parse new time. Please try again or tap Cancel.', null, 5000);
                        return res.sendStatus(200);
                    }
                }

                await setPendingEdit(userId, null);
                await deleteTelegramMessage(chatId, msgId);
                const existingMenuId = await getActiveMenuMsgId(userId);
                if (existingMenuId) await deleteTelegramMessage(userId, existingMenuId);
                await setActiveMenuMsgId(userId, null);
                const dashData = await getRemindersDashboardData(userId, userTz);
                await sendOrUpdateDashboard(userId, dashData.text, dashData.keyboard);
                return res.sendStatus(200);
            }

            if (text.startsWith('/start') || text.toLowerCase() === 'view') {
                const existingTz = await getUserTimezone(userId);
                if (existingTz) {
                    const dashData = await getRemindersDashboardData(userId, existingTz);
                    await sendOrUpdateDashboard(userId, dashData.text, dashData.keyboard, msgId);
                } else {
                    await sendTelegramMessage(userId, '👋 Welcome! Please select your primary timezone:', getTimezonePickerKeyboard());
                }
                return res.sendStatus(200);
            }

            if ((text.startsWith('/delete') || text.startsWith('/del')) && userId === OWNER_ID) {
                const replyMsg = message.reply_to_message;
                if (replyMsg?.from?.is_bot) {
                    await deleteTelegramMessage(chatId, replyMsg.message_id);
                    await deleteTelegramMessage(chatId, msgId);
                }
                return res.sendStatus(200);
            }
        await pool.query('INSERT INTO reminders (user_id, chat_id, text, remind_at) VALUES ($1, $2, $3, $4)', [userId, chatId, parsed.reminderText, parsed.date]);
            const userTz = await getUserTimezone(userId);
            const parsed = parseFlexibleDate(text, userTz);

            if (parsed) {
        await pool.query('INSERT INTO reminders (user_id, chat_id, text, remind_at) VALUES ($1, $2, $3, $4)', [userId, chatId, parsed.reminderText, parsed.date]);
                const dashData = await getRemindersDashboardData(userId, userTz);
                await sendOrUpdateDashboard(userId, dashData.text, dashData.keyboard, msgId);
            }
            return res.sendStatus(200);
        }

        if (callbackQuery) {
            const userId = callbackQuery.from.id;
            const chatId = callbackQuery.message?.chat.id;
            const messageId = callbackQuery.message?.message_id;
            const data = callbackQuery.data;
            let userTz = (await getUserTimezone(userId)) || 'America/Chicago';

            if (messageId) { await setActiveMenuMsgId(userId, messageId); }

            if (data.startsWith('settz:')) {
                const tz = data.replace('settz:', '');
                await setUserTimezone(userId, tz);
                await answerCallbackQuery(callbackQuery.id, `✅ Timezone saved: ${tz}`, true);
                const dashData = await getRemindersDashboardData(userId, tz);
                await sendOrUpdateDashboard(userId, dashData.text, dashData.keyboard);
            } else if (data === 'noop') {
                await answerCallbackQuery(callbackQuery.id);
            } else if (data === 'menu:list') {
                await answerCallbackQuery(callbackQuery.id);
                await setPendingEdit(userId, null);
                const dashData = await getRemindersDashboardData(userId, userTz);
                if (chatId && messageId) {
                    await editTelegramMessage(chatId, messageId, dashData.text, dashData.keyboard);
                } else {
                    await sendOrUpdateDashboard(userId, dashData.text, dashData.keyboard);
                }
            } else if (data.startsWith('del:')) {
            const id = data.split(':')[1];
            await fetch(`https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    callback_query_id: req.body.callback_query.id,
                    text: 'Tap Del again to confirm deletion',
                    show_alert: true
                })
            });
            return res.sendStatus(200);
        } else if (data.startsWith('confirm_del:')) {
                const reminderId = data.replace('del:', '');
                await pool.query('DELETE FROM reminders WHERE id = $1 AND user_id = $2', [reminderId, userId]);
                await answerCallbackQuery(callbackQuery.id, '🗑️ Reminder deleted!', true);
                const dashData = await getRemindersDashboardData(userId, userTz);
                await editTelegramMessage(chatId, messageId, dashData.text, dashData.keyboard);
            } else if (data.startsWith('view:')) {
                const reminderId = data.replace('view:', '');
                const result = await pool.query('SELECT text, remind_at, recurring, total_occurrences, current_occurrence FROM reminders WHERE id = $1 AND user_id = $2', [reminderId, userId]);
                if (result.rows.length > 0) {
                    const r = result.rows[0];
                    const dt = DateTime.fromJSDate(new Date(r.remind_at)).setZone(userTz);
                    const formattedTime = dt.toFormat("LLL d, yyyy 'at' h:mm a");
      let repeatInfo = r.recurring ? `\n🔄 Repeat: ${formatRepeatText(r.recurring)}${r.total_occurrences ? ` (${r.current_occurrence || 0}/${r.total_occurrences})` : ""}` : "";

                    await answerCallbackQuery(callbackQuery.id, `━━━━━━━━━━━━━━━━━━\n🔔 ${r.text}\n🕒 ${formattedTime}${repeatInfo}`, true);
                }
                                                            } else if (data.startsWith('edit:')) {
                const inlineMsgId = req.body.callback_query.inline_message_id;
                const reminderId = data.replace('edit:', '');
                
                if (inlineMsgId) {
                    const key = `${userId}:${reminderId}`;
                    if (pendingInlineEdits.has(key)) {
                        pendingInlineEdits.delete(key);
                        await answerCallbackQuery(callbackQuery.id, '📩 Sent edit options to DM!');
                        const result = await pool.query('SELECT text, recurring, total_occurrences FROM reminders WHERE id = $1 AND user_id = $2', [reminderId, userId]);
                        if (result.rows.length > 0) {
                            const r = result.rows[0];
                            const activeMsgId = await getActiveMenuMsgId(userId);
                            if (activeMsgId) {
                                await deleteTelegramMessage(userId, activeMsgId);
                                await setActiveMenuMsgId(userId, null);
                            }
                            await sendOrUpdateDashboard(userId, `✏️ Editing Reminder: "<b>${r.text}</b>"
━━━━━━━━━━━━━━━━━━
Select options below:`, getEditMenuKeyboard(reminderId, r.recurring, r.total_occurrences));
                        }
                    } else {
                        pendingInlineEdits.add(key);
                        setTimeout(() => pendingInlineEdits.delete(key), 10000);
                        await fetch(`https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                callback_query_id: req.body.callback_query.id,
                                text: '⚠️ Tap Edit again within 10s to send options to your DM',
                                show_alert: true
                            })
                        });
                    }
                    return res.sendStatus(200);
                }
            } else if (data.startsWith('prompt_edit_text:')) {
                const reminderId = data.replace('prompt_edit_text:', '');
                await setPendingEdit(userId, `text:${reminderId}`);
                await editTelegramMessage(chatId, messageId, `📝 <b>Please type the new note/text for this reminder:</b>\n━━━━━━━━━━━━━━━━━━`, { inline_keyboard: [[{ text: '⬅️ Cancel', callback_data: `edit:${reminderId}` }]] });
                await answerCallbackQuery(callbackQuery.id);
            } else if (data.startsWith('prompt_edit_time:')) {
                const reminderId = data.replace('prompt_edit_time:', '');
                await setPendingEdit(userId, `time:${reminderId}`);
                await editTelegramMessage(chatId, messageId, `🕒 <b>Please type the new time/date for this reminder:</b>\n<i>Example: tomorrow at 8am, 2h, or Aug 12 5pm</i>\n━━━━━━━━━━━━━━━━━━`, { inline_keyboard: [[{ text: '⬅️ Cancel', callback_data: `edit:${reminderId}` }]] });
                await answerCallbackQuery(callbackQuery.id);
            } else if (data.startsWith('unitmenu:')) {
                const reminderId = data.replace('unitmenu:', '');
                await answerCallbackQuery(callbackQuery.id);
                await editTelegramMessage(chatId, messageId, `⚙️ <b>Select Custom Interval Unit:</b>\n━━━━━━━━━━━━━━━━━━`, getUnitMenuKeyboard(reminderId));
            } else if (data.startsWith('nummenu:')) {
                const [, reminderId, unit] = data.split(':');
                await answerCallbackQuery(callbackQuery.id);
                await editTelegramMessage(chatId, messageId, `⚙️ <b>Select Every How Many ${unit.toUpperCase()}:</b>\n━━━━━━━━━━━━━━━━━━`, getNumberMenuKeyboard(reminderId, unit));
            } else if (data.startsWith('limitmenu:')) {
                const reminderId = data.replace('limitmenu:', '');
                const result = await pool.query('SELECT total_occurrences FROM reminders WHERE id = $1 AND user_id = $2', [reminderId, userId]);
                if (result.rows.length > 0) {
                    await answerCallbackQuery(callbackQuery.id);
                    await editTelegramMessage(chatId, messageId, `🔁 <b>Select How Many Times to Repeat:</b>\n━━━━━━━━━━━━━━━━━━`, getLimitMenuKeyboard(reminderId, result.rows[0].total_occurrences));
                }
            } else if (data.startsWith('setrec:')) {
                const [, reminderId, recType, interval = '1'] = data.split(':');
                const recurringVal = recType === 'none' ? null : `${recType}:${interval}`;

                await pool.query('UPDATE reminders SET recurring = $1 WHERE id = $2 AND user_id = $3', [recurringVal, reminderId, userId]);
                await answerCallbackQuery(callbackQuery.id, '✅ Recurrence updated!', true);

                const result = await pool.query('SELECT total_occurrences FROM reminders WHERE id = $1 AND user_id = $2', [reminderId, userId]);
                const totalOcc = result.rows.length > 0 ? result.rows[0].total_occurrences : null;
                await editTelegramMessage(chatId, messageId, `✏️ Editing Reminder\n━━━━━━━━━━━━━━━━━━\nSelect options below:`, getEditMenuKeyboard(reminderId, recurringVal, totalOcc));
            } else if (data.startsWith('setlimit:')) {
                const [, reminderId, countStr] = data.split(':');
                const count = parseInt(countStr, 10);
                const limitVal = count === 0 ? null : count;

                await pool.query('UPDATE reminders SET total_occurrences = $1 WHERE id = $2 AND user_id = $3', [limitVal, reminderId, userId]);
                await answerCallbackQuery(callbackQuery.id, '✅ Repeat limit updated!', true);

                const result = await pool.query('SELECT recurring FROM reminders WHERE id = $1 AND user_id = $2', [reminderId, userId]);
                const currentRec = result.rows.length > 0 ? result.rows[0].recurring : null;
                await editTelegramMessage(chatId, messageId, `✏️ Editing Reminder\n━━━━━━━━━━━━━━━━━━\nSelect options below:`, getEditMenuKeyboard(reminderId, currentRec, limitVal));
            }
        }

        if (inlineQuery) {
            const userId = inlineQuery.from.id;
            const userTz = (await getUserTimezone(userId)) || 'America/Chicago';
            const queryText = inlineQuery.query.trim();
            let results = [];

            if (queryText.toLowerCase() === 'view' || queryText === '') {
                results.push({
                    type: 'article',
                    id: 'show_reminders_dm',
                    title: '👀 View Active Reminders (DM)',
                    description: 'Tap to view and manage your active reminders.',
                    thumbnail_url: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/2709.png',
                    thumbnail_url: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/2709.png',
                    thumb_width: 72,
                    thumb_height: 72,
                    input_message_content: { message_text: '📋 Requesting active reminders list...' }
                });
                results.push({
                    type: 'article',
                    id: 'show_reminders_inline_v6',
                    title: '👀 View Active Reminders (Inline)',
                    description: 'Posts active reminders in chat, collapses in 30s',
                    thumbnail_url: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/23f3.png',
                    input_message_content: { message_text: '📋 Fetching active reminders...' },
                    reply_markup: {
                        inline_keyboard: [[{ text: '⏳ Loading...', callback_data: 'noop' }]]
                    }
                });
            } else {
                const parsed = parseFlexibleDate(queryText, userTz);
                if (parsed) {
                    const dt = DateTime.fromJSDate(parsed.date).setZone(userTz);
                    results.push({
                        type: 'article',
                        id: `create_inline_${encodeURIComponent(queryText)}`,
                        title: `🔔 Set Reminder: "${parsed.text}"`,
                        thumbnail_url: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/23f0.png",
                        description: `Scheduled for: ${dt.toFormat('ff')}`,
                        input_message_content: { message_text: `⏳ Creating reminder...` }
                    });
                } else {
                    results.push({
                        type: 'article',
                        id: 'invalid_time',
                        title: '⚠️ Min 1 min ahead',
                        description: 'Time must be >= 1 min.',
                        input_message_content: { message_text: '❌ Reminders must be set for at least 1 minute from now.' }
                    });
                }
            }

            await fetch(`https://api.telegram.org/bot${TOKEN}/answerInlineQuery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ inline_query_id: inlineQuery.id, results, cache_time: 0 })
            });
        }

        if (chosenResult) {
            const userId = chosenResult.from.id;
            const resultId = chosenResult.result_id;

            if (resultId === 'show_reminders_dm') {
                const userTz = (await getUserTimezone(userId)) || 'America/Chicago';
                const dashData = await getRemindersDashboardData(userId, userTz);
                await sendOrUpdateDashboard(userId, dashData.text, dashData.keyboard);
            } else if (resultId === 'show_reminders_inline_v6') {
                const inlineMessageId = chosenResult.inline_message_id;
                const userTz = (await getUserTimezone(userId)) || 'America/Chicago';
                const dashData = await getRemindersDashboardData(userId, userTz);

                if (inlineMessageId) {
                    await fetch(`https://api.telegram.org/bot${TOKEN}/editMessageText`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            inline_message_id: inlineMessageId,
                            text: dashData.text,
                            reply_markup: dashData.keyboard,
                            parse_mode: 'HTML'
                        })
                    });

                    setTimeout(async () => {
                        try {
                            await fetch(`https://api.telegram.org/bot${TOKEN}/editMessageText`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    inline_message_id: inlineMessageId,
                                    text: '🫈 Squatch spotted! List collapsed before anyone got proof.',
                                    parse_mode: 'HTML'
                                })
                            });
                        } catch (err) {
                            console.error('Failed to collapse inline message:', err);
                        }
                    }, 30000);
                } else {
                    await sendOrUpdateDashboard(userId, dashData.text, dashData.keyboard);
                }
            } else if (resultId.startsWith('create_inline_') || resultId.startsWith('custom:')) {
                const inlineMessageId = chosenResult.inline_message_id;
                if (inlineMessageId) {
                    let rawQuery = chosenResult.query;
                    if (resultId.startsWith('create_inline_')) {
                        rawQuery = decodeURIComponent(resultId.replace('create_inline_', ''));
                    }
                    const userTz = (await getUserTimezone(userId)) || 'America/Chicago';
                    const parsed = parseFlexibleDate(rawQuery, userTz);
                    if (parsed) {
                        const targetUtc = parsed.dt.toUTC().toJSDate();
                        const remText = (parsed.text && parsed.text.trim()) ? parsed.text.trim() : rawQuery;
                        await pool.query(
                            'INSERT INTO reminders (user_id, text, target_time, recurring) VALUES ($1, $2, $3, $4)',
                            [userId, remText, targetUtc, 'none']
                        );
                        const formattedTime = parsed.dt.toFormat("LLL d, yyyy 'at' h:mm a");
                        await fetch(`https://api.telegram.org/bot${TOKEN}/editMessageText`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                inline_message_id: inlineMessageId,
                                text: `✅ <b>Reminder set!</b>\n📝 <i>${remText}</i>\n⏰ ${formattedTime}`,
                                parse_mode: 'HTML'
                            })
                        });
                    }
                }
            }
        }
        res.sendStatus(200);
    } catch (error) {
        console.error('[WEBHOOK ERROR]:', error);
        res.sendStatus(500);
    }
});
