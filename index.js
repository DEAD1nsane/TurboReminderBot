const chrono = require("chrono-node");
const crypto = require("crypto");

const express = require("express");
const { Pool } = require("pg");
const { DateTime } = require("luxon");
const {
  formatRepeatText,
  getTimezonePickerKeyboard,
  getEditMenuKeyboard,
  getUnitMenuKeyboard,
  getNumberMenuKeyboard,
  getLimitMenuKeyboard,
  getDowMenuKeyboard,
  buildCalendar,
} = require("./keyboards");
const {
  sendTelegramMessage,
  sendEphemeralMessage,
  editTelegramMessage,
  editEphemeralMessage,
  deleteTelegramMessage,
  deleteEphemeralMessage,
  answerCallbackQuery,
  setEphemeralGroupCommands,
  fetchWithTimeout,
  sendRichMessage,
  editRichMessage,
  sendRichEphemeralMessage,
  editRichEphemeralMessage,
  editInlineRichMessage,
  editInlineMessage,
  answerInlineQuery,
  checkRichMessageSupport,
  isRichMessageSupported,
} = require("./telegram");

const activityTimers = new Map();
const pendingDeletes = new Set();
const pendingInlineEdits = new Set();

// ── Bounded caches with TTL ────────────────────────────────────────────────
const MAX_CACHE_SIZE = 5000;
const CACHE_TTL_MS = 10 * 60 * 1000;

function boundedMap(ttlMs = CACHE_TTL_MS, maxSize = MAX_CACHE_SIZE) {
  const map = new Map();
  return {
    get(key) {
      const entry = map.get(key);
      if (!entry) return undefined;
      if (Date.now() > entry.expires) { map.delete(key); return undefined; }
      return entry.value;
    },
    set(key, value) {
      if (map.size >= maxSize) {
        const oldest = map.keys().next().value;
        map.delete(oldest);
      }
      map.set(key, { value, expires: Date.now() + ttlMs });
    },
    delete(key) { map.delete(key); },
    has(key) { return this.get(key) !== undefined; },
    get size() { return map.size; },
  };
}

const wizardStateBounded = boundedMap(10 * 60 * 1000, 1000);
const pendingEditSurfacesBounded = boundedMap(5 * 60 * 1000, 1000);
const inlineQueryCacheBounded = boundedMap(10 * 60 * 1000, 5000);
const inlineOwnerMap = boundedMap(30 * 60 * 1000, 5000);

async function editWizardStep(state, text, inlineKeyboard = null) {
  if (state.iMsgId) {
    await editInlineMessage(state.iMsgId, text, inlineKeyboard);
  } else if (state.surface) {
    await editRichSurface(state.surface, buildRichMessage([
      richHeading(text.replace(/\*\*/g, "").split("\n")[0], 1),
      ...text.split("\n").slice(1).map(l => richParagraph(l)),
    ]));
  }
}

// ── Rate limiter ───────────────────────────────────────────────────────────
const rateLimitCounts = new Map();
function checkRateLimit(key, maxRequests = 30, windowMs = 1000) {
  const now = Date.now();
  const entry = rateLimitCounts.get(key);
  if (!entry || now - entry.windowStart > windowMs) {
    rateLimitCounts.set(key, { count: 1, windowStart: now });
    return true;
  }
  entry.count++;
  return entry.count <= maxRequests;
}
setInterval(() => {
  const cutoff = Date.now() - 5000;
  for (const [k, v] of rateLimitCounts) {
    if (v.windowStart < cutoff) rateLimitCounts.delete(k);
  }
}, 10000);

function resetMenuTimer(key, action) {
  if (activityTimers.has(key)) clearTimeout(activityTimers.get(key));
  activityTimers.set(
    key,
    setTimeout(() => {
      activityTimers.delete(key);
      action();
    }, 30000),
  );
}

function clearMenuTimer(key) {
  if (activityTimers.has(key)) {
    clearTimeout(activityTimers.get(key));
    activityTimers.delete(key);
  }
}

function clearUserPendingState(userId) {
  for (const k of Array.from(pendingDeletes)) {
    if (k.includes(`:${userId}:`)) pendingDeletes.delete(k);
  }
  for (const k of Array.from(pendingInlineEdits)) {
    if (k.includes(`:${userId}:`)) pendingInlineEdits.delete(k);
  }
  for (const k of Array.from(activityTimers.keys())) {
    if (k.includes(`_${userId}`) || k.includes(`:${userId}:`)) {
      clearTimeout(activityTimers.get(k));
      activityTimers.delete(k);
    }
  }
}

const escapeMarkdownV2 = (str) =>
  String(str || "").replace(/[_\*\[\]\(\)~`>#\+\-=\|{\}\!\\.]/g, "\\$&");

function parseReminderId(data, prefix) {
  const raw = data.split(":")[1];
  const id = parseInt(raw, 10);
  if (isNaN(id) || id <= 0) return null;
  return id;
}

// ── Rich Message Block Builders ────────────────────────────────────────────

function richHeading(text, size = 2) {
  return { type: "heading", text, size };
}

function richParagraph(text) {
  return { type: "paragraph", text };
}

function richDivider() {
  return { type: "divider" };
}

function richButtons(buttons, align = "center") {
  return { type: "buttons", buttons, align };
}

function richButton(text, callbackData, style = null) {
  const btn = { text, callback_data: callbackData };
  if (style) btn.style = style;
  return btn;
}

function richTable(cells, opts = {}) {
  return {
    type: "table",
    cells,
    is_bordered: opts.bordered !== false,
    is_striped: opts.striped !== false,
    is_compact: opts.compact !== false,
  };
}

function richList(items, ordered = false) {
  return { type: "list", items, ordered };
}

function richListItem(text) {
  return { text };
}

function richDetails(summary, blocks, isOpen = false) {
  return { type: "details", summary, blocks, is_open: isOpen };
}

function buildRichMessage(blocks) {
  return { blocks };
}

function buildEditMenuRich(reminderId, recurring, totalOccurrences, earlyOffset) {
  const recType = formatRepeatText(recurring);
  const limitLabel = totalOccurrences ? `${totalOccurrences}x` : "Forever";
  const earlyLabel = earlyOffset ? `${earlyOffset}m` : "Off";

  return buildRichMessage([
    richHeading("✏️ Editing Reminder", 1),
    richParagraph("Select options below:"),
    richDivider(),
    richButtons([
      richButton("📝 Edit Note", `prompt_edit_text:${reminderId}`, "primary"),
      richButton("🕒 Edit Time", `prompt_edit_time:${reminderId}`, "primary"),
    ]),
    richButtons([
      richButton(recurring === null ? "✅ None" : "None", `setrec:${reminderId}:none`, "link"),
      richButton(recurring === "daily:1" ? "✅ Daily" : "Daily", `setrec:${reminderId}:daily:1`, "link"),
      richButton(recurring === "weekly:1" ? "✅ Weekly" : "Weekly", `setrec:${reminderId}:weekly:1`, "link"),
      richButton(recurring === "monthly:1" ? "✅ Monthly" : "Monthly", `setrec:${reminderId}:monthly:1`, "link"),
    ]),
    richButtons([
      richButton(`⚙️ Interval (${recType})`, `unitmenu:${reminderId}`, "link"),
      richButton("📅 Pick Days", `dowmenu:${reminderId}`, "link"),
    ]),
    richButtons([
      richButton(`🔁 Limit (${limitLabel})`, `limitmenu:${reminderId}`, "link"),
    ]),
    richButtons([
      richButton(earlyOffset === 5 ? "✅ 5m ⏳" : "5m ⏳", `setearly:${reminderId}:5`, "link"),
      richButton(earlyOffset === 10 ? "✅ 10m ⏳" : "10m ⏳", `setearly:${reminderId}:10`, "link"),
      richButton(earlyOffset && earlyOffset !== 5 && earlyOffset !== 10 ? `✅ ${earlyLabel} ⏳` : "Custom ⏳", `prompt_early:${reminderId}`, "link"),
      richButton(!earlyOffset ? "✅ Off" : "Off ❌", `setearly:${reminderId}:0`, "link"),
    ]),
    richDivider(),
    richButtons([
      richButton("⬅️ Back to Reminders", "menu:list", "link"),
    ]),
  ]);
}

const isGroupChat = (chat) =>
  chat?.type === "group" || chat?.type === "supergroup";

// Bot API 10.3 doesn't allow force_reply to be toggled after an inline
// keyboard is created. Ephemeral surfaces opt in from their first frame so
// typed answers stay private in the group.
function withPrivateReply(markup) {
  if (markup && markup.inline_keyboard) return markup;
  return {
    force_reply: true,
    ...(markup || {}),
  };
}

function surfaceFromTelegramMessage(message, receiverUserId) {
  if (!message?.chat) return null;
  if (message.ephemeral_message_id) {
    return {
      ephemeral: true,
      chatId: message.chat.id,
      receiverUserId,
      ephemeralMessageId: message.ephemeral_message_id,
      richContent: false,
    };
  }
  if (message.message_id) {
    return {
      ephemeral: false,
      chatId: message.chat.id,
      messageId: message.message_id,
      richContent: false,
    };
  }
  return null;
}

async function editSurface(surface, text, markup = null) {
  if (!surface) return false;
  if (surface.ephemeral) {
    return editEphemeralMessage(
      surface.chatId,
      surface.receiverUserId,
      surface.ephemeralMessageId,
      text,
      withPrivateReply(markup),
    );
  }
  return editTelegramMessage(
    surface.chatId,
    surface.messageId,
    text,
    markup,
  );
}

async function editRichSurface(surface, richMessage, markup = null) {
  if (!surface) {
    console.log("[EDIT_RICH] surface is null, returning false");
    return false;
  }
  console.log("[EDIT_RICH] surface:", JSON.stringify({ephemeral: surface.ephemeral, chatId: surface.chatId, messageId: surface.messageId}));
  if (!isRichMessageSupported()) {
    const fallbackText = richMessage.markdown || richMessage.html || "...";
    return editSurface(surface, fallbackText, markup);
  }
  if (surface.ephemeral) {
    console.log("[EDIT_RICH] editing ephemeral message");
    return editRichEphemeralMessage(
      surface.chatId,
      surface.receiverUserId,
      surface.ephemeralMessageId,
      richMessage,
      withPrivateReply(markup),
    );
  }
  console.log("[EDIT_RICH] editing regular message");
  return editRichMessage(
    surface.chatId,
    surface.messageId,
    richMessage,
    markup,
  );
}

async function removeUserInput(message, userId) {
  if (message?.ephemeral_message_id) {
    await deleteEphemeralMessage(
      message.chat.id,
      message.receiver_user?.id || userId,
      message.ephemeral_message_id,
    );
  } else if (message?.message_id) {
    await deleteTelegramMessage(message.chat.id, message.message_id);
  }
}

async function beginPrivateSurface(message, userId, text, markup) {
  if (!isGroupChat(message.chat)) {
    const sent = await sendTelegramMessage(message.chat.id, text, markup);
    return surfaceFromTelegramMessage(sent, userId);
  }

  const options = message.ephemeral_message_id
    ? { replyToEphemeralMessageId: message.ephemeral_message_id }
    : {};
  const sent = await sendEphemeralMessage(
    message.chat.id,
    userId,
    text,
    withPrivateReply(markup),
    options,
  );
  if (sent) return surfaceFromTelegramMessage(sent, userId);

  // Compatibility fallback for a public command from an older Telegram
  // client or a group where the bot can't start an unprompted ephemeral reply.
  const dm = await sendTelegramMessage(userId, text, markup);
  return surfaceFromTelegramMessage(dm, userId);
}

async function beginRichSurface(message, userId, richMessage, markup) {
  if (!isRichMessageSupported()) {
    const fallbackText = richMessage.markdown || richMessage.html || "";
    return beginPrivateSurface(message, userId, fallbackText, markup);
  }

  if (!isGroupChat(message.chat)) {
    const sent = await sendRichMessage(message.chat.id, richMessage, markup);
    if (sent) {
      const surface = surfaceFromTelegramMessage(sent, userId);
      if (surface) surface.richContent = true;
      return surface;
    }
    return null;
  }

  const options = message.ephemeral_message_id
    ? { replyToEphemeralMessageId: message.ephemeral_message_id }
    : {};
  const sent = await sendRichEphemeralMessage(
    message.chat.id,
    userId,
    richMessage,
    withPrivateReply(markup),
    options,
  );
  if (sent) {
    const surface = surfaceFromTelegramMessage(sent, userId);
    if (surface) surface.richContent = true;
    return surface;
  }

  // Fallback: try regular ephemeral with markdown text
  const fallbackText = richMessage.markdown || richMessage.html || "";
  const fallbackSent = await sendEphemeralMessage(
    message.chat.id,
    userId,
    fallbackText,
    withPrivateReply(markup),
    options,
  );
  if (fallbackSent) return surfaceFromTelegramMessage(fallbackSent, userId);

  // Final fallback: DM
  const dm = await sendTelegramMessage(userId, fallbackText, markup);
  return surfaceFromTelegramMessage(dm, userId);
}

const app = express();
app.use(express.json({ limit: "10kb" }));

const PORT = process.env.PORT || 8080;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN || !process.env.DATABASE_URL) {
  console.error("CRITICAL: Missing TELEGRAM_BOT_TOKEN or DATABASE_URL");
  process.exit(1);
}

if (!process.env.WEBHOOK_SECRET) {
  console.warn("WARN: WEBHOOK_SECRET not set. Webhook is unauthenticated.");
}

app.get("/", (req, res) => res.status(200).send("OK"));
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ status: "ok", db: "connected" });
  } catch (err) {
    res.status(503).json({ status: "error", db: "disconnected" });
  }
});

const server = app.listen(PORT, "0.0.0.0", () =>
  console.log(`Server listening on port ${PORT}`),
);

process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully...");
  let exited = false;
  const forceExit = () => {
    if (!exited) {
      exited = true;
      process.exit(1);
    }
  };
  setTimeout(forceExit, 10000);
  server.close(() => {
    pool.end()
      .then(() => { if (!exited) { exited = true; process.exit(0); } })
      .catch((err) => { console.error("pool.end() failed:", err); forceExit(); });
  });
});

checkRichMessageSupport().then(() => {
  console.log("[STARTUP] Rich message support:", isRichMessageSupported() ? "enabled" : "fallback to MarkdownV2");
});

setEphemeralGroupCommands([
  { command: "start", description: "Open your private reminder dashboard" },
  { command: "remind", description: "Create a reminder privately" },
  { command: "reminders", description: "View and manage your reminders" },
  { command: "calendar", description: "View reminders in calendar" },
  { command: "help", description: "Show reminder help" },
  { command: "cancel", description: "Cancel the current operation" },
]).then((result) => {
  if (result !== null) {
    console.log("Ephemeral group commands registered.");
  }
});

const isInternalHost =
  process.env.DATABASE_URL &&
  process.env.DATABASE_URL.includes("railway.internal");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isInternalHost
    ? false
    : process.env.DATABASE_URL
      ? { rejectUnauthorized: true }
      : false,
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) =>
  console.error("Unexpected Postgres pool error:", err),
);

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
            current_occurrence INT DEFAULT 0,
            early_offset INT DEFAULT NULL,
            early_alert_sent BOOLEAN DEFAULT FALSE
            );
            ALTER TABLE reminders ADD COLUMN IF NOT EXISTS early_offset INT DEFAULT NULL;
            ALTER TABLE reminders ADD COLUMN IF NOT EXISTS early_alert_sent BOOLEAN DEFAULT FALSE;
        `);
    console.log("Database initialized successfully!");
  } catch (err) {
    console.error("CRITICAL: Database initialization failed:", err);
    process.exit(1);
  }
}
initDb();

let pollingLocked = false;
setInterval(async () => {
  if (pollingLocked) return;
  pollingLocked = true;
  try {
    const res = await pool.query(
      `SELECT r.*, COALESCE(s.timezone, 'America/Chicago') AS user_timezone
       FROM reminders r
       LEFT JOIN user_settings s ON s.user_id = r.user_id
       WHERE (r.remind_at <= NOW() AND r.sent = FALSE)
          OR (r.early_offset IS NOT NULL AND r.early_alert_sent = FALSE AND r.remind_at - (r.early_offset * INTERVAL '1 minute') <= NOW())
       FOR UPDATE OF r SKIP LOCKED`,
    );
    for (const r of res.rows) {
      const now = new Date();

      const remindAt = new Date(r.remind_at);
      const tz = r.user_timezone || "America/Chicago";
      const formattedTime = DateTime.fromJSDate(remindAt)
        .setZone(tz)
        .toFormat("EEE, MMM d, yyyy 'at' h:mm a")
        .replace(/:00\s?(AM|PM)/i, "$1")
        .replace(/\s?(AM|PM)/i, (m) => m.toLowerCase().trim());

      if (
        r.early_offset &&
        !r.early_alert_sent &&
        now >= new Date(remindAt.getTime() - r.early_offset * 60000)
      ) {
        await sendRichMessage(
          r.chat_id || r.user_id,
          buildRichMessage([
            richHeading(`⚡ | ${r.text} in ${r.early_offset}m`, 1),
            richParagraph(formattedTime),
          ]),
        );
        await pool.query(
          "UPDATE reminders SET early_alert_sent = TRUE WHERE id = $1",
          [r.id],
        );
      } else if (now >= remindAt && !r.sent) {
        await sendRichMessage(
          r.chat_id || r.user_id,
          buildRichMessage([
            richHeading(`🔔 | ${r.text}`, 1),
            richParagraph(formattedTime),
          ]),
        );

        if (r.recurring) {
          const nextDate = calculateNextOccurrence(
            remindAt,
            r.recurring,
            tz,
          );
          const newCount = (r.current_occurrence || 0) + 1;

          if (!r.total_occurrences || newCount < r.total_occurrences) {
            await pool.query(
              "UPDATE reminders SET remind_at = $1, current_occurrence = $2, early_alert_sent = FALSE WHERE id = $3",
              [nextDate, newCount, r.id],
            );
          } else {
            await pool.query("UPDATE reminders SET sent = TRUE WHERE id = $1", [
              r.id,
            ]);
          }
        } else {
          await pool.query("UPDATE reminders SET sent = TRUE WHERE id = $1", [
            r.id,
          ]);
        }
      }
    }
  } catch (err) {
    console.error("Reminder execution error:", err);
  } finally {
    pollingLocked = false;
  }
}, 30000);

async function getUserTimezone(userId) {
  if (!process.env.DATABASE_URL) return "America/Chicago";
  try {
    const res = await pool.query(
      "SELECT timezone FROM user_settings WHERE user_id = $1",
      [userId],
    );
    return res.rows.length > 0 ? res.rows[0].timezone : "America/Chicago";
  } catch (err) {
    console.error("[DB] getUserTimezone error:", err.message);
    return "America/Chicago";
  }
}

async function setUserTimezone(userId, tz) {
  if (!process.env.DATABASE_URL) return;
  try {
    await pool.query(
      `INSERT INTO user_settings (user_id, timezone) VALUES ($1, $2)
             ON CONFLICT (user_id) DO UPDATE SET timezone = $2`,
      [userId, tz],
    );
  } catch (err) {
    console.error("Error saving user timezone:", err);
  }
}

async function getActiveMenuMsgId(userId) {
  if (!process.env.DATABASE_URL) return null;
  try {
    const res = await pool.query(
      "SELECT active_menu_msg_id FROM user_settings WHERE user_id = $1",
      [userId],
    );
    return res.rows.length > 0 && res.rows[0].active_menu_msg_id
      ? res.rows[0].active_menu_msg_id
      : null;
  } catch (err) {
    console.error("[DB] getActiveMenuMsgId error:", err.message);
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
      [userId, msgId, triggerMsgId, collapseAt, "America/Chicago"],
    );
  } catch (err) {
    console.error("Error setting active menu msg id:", err);
  }
}

async function getPendingEdit(userId) {
  if (!process.env.DATABASE_URL) return null;
  try {
    const res = await pool.query(
      "SELECT pending_edit FROM user_settings WHERE user_id = $1",
      [userId],
    );
    return res.rows.length > 0 ? res.rows[0].pending_edit : null;
  } catch (err) {
    console.error("[DB] getPendingEdit error:", err.message);
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
      [userId, pendingStr],
    );
  } catch (err) {
    console.error("Error setting pending edit:", err);
  }
}

function calculateNextOccurrence(currentDate, recurringStr, timeZone) {
  let dt = DateTime.fromJSDate(currentDate).setZone(timeZone);
  const parts = recurringStr.split(":");
  const type = parts[0];
  const interval = parseInt(parts[1] || "1", 10);

  if (type === "daily" || type === "days") dt = dt.plus({ days: interval });
  else if (type === "weekly" || type === "weeks")
    dt = dt.plus({ weeks: interval });
  else if (type === "monthly" || type === "months")
    dt = dt.plus({ months: interval });
  else if (type === "hourly" || type === "hours")
    dt = dt.plus({ hours: interval });
  else if (type === "dow") {
    const selectedDays = parts[1].split(",").map(Number).sort();
    const currentDay = dt.weekday;
    let daysToAdd = -1;
    for (const day of selectedDays) {
      if (day > currentDay) {
        daysToAdd = day - currentDay;
        break;
      }
    }
    if (daysToAdd === -1) {
      daysToAdd = 7 - currentDay + selectedDays[0];
    }
    dt = dt.plus({ days: daysToAdd });
  }

  return dt.toJSDate();
}

async function detectTimezoneFromLocation(lat, lon) {
  try {
    const res = await fetchWithTimeout(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
      { timeout: 5000 }
    );
    if (res.ok) {
      const data = await res.json();
      return data.timeZone?.id || null;
    }
  } catch (err) {
    console.error("[TZ_DETECT] Error:", err);
  }
  return null;
}

async function getRemindersForMonth(userId, year, month) {
  const start = DateTime.fromObject({ year, month, day: 1 }, { zone: "utc" }).startOf('month').toJSDate();
  const end = DateTime.fromObject({ year, month, day: 1 }, { zone: "utc" }).endOf('month').toJSDate();
  const res = await pool.query(
    "SELECT EXTRACT(DAY FROM remind_at AT TIME ZONE COALESCE((SELECT timezone FROM user_settings WHERE user_id = $1), 'America/Chicago')) AS day FROM reminders WHERE user_id = $1 AND sent = FALSE AND remind_at >= $2 AND remind_at <= $3",
    [userId, start, end]
  );
  const dayMap = {};
  for (const row of res.rows) {
    const d = parseInt(row.day, 10);
    if (d) dayMap[d] = (dayMap[d] || 0) + 1;
  }
  return dayMap;
}

function parseFlexibleDate(text, timeZone) {
  let clean = text.trim().replace(/^reminder\s*/i, "");
  const cleanNoEmoji = clean
    .replace(
      /^(?:(?:\p{Extended_Pictographic})(?:\uFE0F|\u200D(?:\p{Extended_Pictographic}))*(?:\s|$))+/u,
      "",
    )
    .replace(/^(?:[\p{Extended_Pictographic}\uFE0F\u200D]+\s*)+/u, "")
    .trim();
  let dateInput = cleanNoEmoji || clean;
  const nowInZone = DateTime.now().setZone(timeZone);

  let wantRepeatMenu = false;
  if (/\brepeat\b$/i.test(clean)) {
    wantRepeatMenu = true;
    clean = clean.replace(/\brepeat\b$/i, "").trim();
    dateInput =
      clean
        .replace(
          /^(?:(?:\p{Extended_Pictographic})(?:\uFE0F|\u200D(?:\p{Extended_Pictographic}))*(?:\s|$))+/u,
          "",
        )
        .replace(/^(?:[\p{Extended_Pictographic}\uFE0F\u200D]+\s*)+/u, "")
        .trim() || clean;
  }

  const compoundRegex =
    /^((?:\d+d)?\s*(?:\d+h)?\s*(?:\d+m)?\s*(?:\d+s)?)\s+(.+)$/i;
  const match = dateInput.match(compoundRegex);

  if (match && match[1].trim().length > 0) {
    const timePart = match[1];
    const dMatch = timePart.match(/(\d+)d/i);
    const hMatch = timePart.match(/(\d+)h/i);
    const mMatch = timePart.match(/(\d+)m/i);
    const sMatch = timePart.match(/(\d+)s/i);
    const days = dMatch ? parseInt(dMatch[1], 10) : 0;
    const hours = hMatch ? parseInt(hMatch[1], 10) : 0;
    const minutes = mMatch ? parseInt(mMatch[1], 10) : 0;
    const seconds = sMatch ? parseInt(sMatch[1], 10) : 0;

    if (days > 0 || hours > 0 || minutes > 0 || seconds > 0) {
      let dt = nowInZone;
      if (days) dt = dt.plus({ days });
      if (hours) dt = dt.plus({ hours });
      if (minutes) dt = dt.plus({ minutes });
      if (seconds) dt = dt.plus({ seconds });

      if (dt <= nowInZone.plus({ seconds: 59 })) return null;
      const leadingEmoji = (clean.match(
        /^(?:[\p{Extended_Pictographic}\uFE0F\u200D]+\s*)+/u,
      ) || [""])[0];
      const reminderText =
        match[2] && match[2].trim()
          ? `${leadingEmoji}${match[2].trim()}`.trim()
          : clean;
      return {
        dt,
        date: dt.toJSDate(),
        text: reminderText,
        reminderText,
        wantRepeatMenu,
      };
    }
  }

  const referenceDate = new Date(
    nowInZone.year,
    nowInZone.month - 1,
    nowInZone.day,
    nowInZone.hour,
    nowInZone.minute,
    nowInZone.second,
  );
  const parsed = chrono.parse(dateInput, referenceDate, { forwardDate: true });
  if (parsed.length > 0) {
    const parsedResult = parsed[0];
    const parsedComp = parsedResult.start;

    let dt = nowInZone.set({
      hour:
        parsedComp.get("hour") !== null
          ? parsedComp.get("hour")
          : nowInZone.hour,
      minute: parsedComp.get("minute") !== null ? parsedComp.get("minute") : 0,
      second: 0,
      millisecond: 0,
    });

    if (parsedComp.get("day") !== null) {
      dt = dt.set({
        year: parsedComp.get("year") || nowInZone.year,
        month: parsedComp.get("month"),
        day: parsedComp.get("day"),
      });
    }

    if (dt <= nowInZone) {
      if (parsedComp.get("day") === null && parsedComp.get("month") === null) {
        dt = dt.plus({ days: 1 });
      } else {
        return null;
      }
    }

    let reminderText = clean;
    if (parsedResult.text) {
      const dateText = parsedResult.text.trim();
      const idx = dateInput.toLowerCase().indexOf(dateText.toLowerCase());
      if (idx >= 0) {
        const originalIdx = clean.toLowerCase().indexOf(dateText.toLowerCase());
        if (originalIdx >= 0) {
          reminderText =
            `${clean.slice(0, originalIdx)} ${clean.slice(originalIdx + dateText.length)}`.trim();
        } else {
          reminderText = clean.replace(dateText, "").trim();
        }
      }
    }
    if (!reminderText) reminderText = "Reminder";

    return {
      dt,
      date: dt.toJSDate(),
      text: reminderText,
      reminderText,
      wantRepeatMenu,
    };
  }
  return null;
}

async function getRemindersDashboardData(userId, userTz, passedName = null) {
  try {
    let uName = passedName || "Your";
    let titleName = uName === "Your" ? "Your" : `${uName}'s`;

    const res = await pool.query(
      "SELECT id, text, remind_at, recurring, total_occurrences FROM reminders WHERE user_id = $1 AND sent = FALSE ORDER BY remind_at ASC",
      [userId],
    );

    if (res.rows.length === 0) {
      const richMessage = buildRichMessage([
        richHeading(`📋 ${titleName} Active Reminders`, 1),
        richParagraph("📭 No active reminders found."),
        richDivider(),
        richButtons([
          richButton("➕ Create Reminder", "wizard_new", "success"),
          richButton("📅 Calendar", "menu:calendar", "primary"),
        ]),
        richButtons([
          richButton("✖️ Close", "surface_close", "danger"),
        ]),
      ]);
      return {
        text: `📋 **${titleName} Active Reminders:**\n━━━━━━━━━━━━━━━━━━\n\n*📭 No active reminders found.*`,
        keyboard: {
          inline_keyboard: [
            [{ text: "📭 No active reminders", callback_data: "noop" }],
            [{ text: "➕ Create Reminder", callback_data: "wizard_new" }],
            [{ text: "✖️ Close", callback_data: "surface_close" }],
          ],
        },
        richMessage,
      };
    }

    const reminderButtons = res.rows.map((r) => {
      let statusIcon = r.recurring ? (r.total_occurrences ? "🔢 " : "🔄 ") : "";
      return richButtons([
        richButton(`${statusIcon}${r.text}`, `view:${r.id}`, "link"),
      ]);
    });

    const richMessage = buildRichMessage([
      richHeading(`📋 ${titleName} Active Reminders`, 1),
      richDivider(),
      ...reminderButtons,
      richDivider(),
      richButtons([
        richButton("➕ New Reminder", "wizard_new", "success"),
        richButton("📅 Calendar", "menu:calendar", "primary"),
      ]),
      richButtons([
        richButton("✖️ Close", "surface_close", "danger"),
      ]),
    ]);

    let buttons = res.rows.map((r) => {
      let statusIcon = r.recurring ? (r.total_occurrences ? "🔢 " : "🔄 ") : "";
      return [
        { text: `${statusIcon}${r.text}`, callback_data: `view:${r.id}` },
      ];
    });
    buttons.push([
      { text: "➕ New Reminder", callback_data: "wizard_new" },
      { text: "✖️ Close", callback_data: "surface_close" },
    ]);

    return {
      text: `📋 **${titleName} Active Reminders:**`,
      keyboard: { inline_keyboard: buttons },
      richMessage,
    };
  } catch (err) {
    console.error("Error fetching reminders for dashboard:", err);
    const richMessage = buildRichMessage([
      richHeading("⚠️ Error", 2),
      richParagraph("Error loading reminders."),
    ]);
    return {
      text: "⚠️ Error loading reminders.",
      keyboard: {
        inline_keyboard: [
          [{ text: "⚠️ Error loading reminders", callback_data: "noop" }],
        ],
      },
      richMessage,
    };
  }
}

async function sendOrUpdateDashboard(
  userId,
  text,
  markup,
  triggerMsgId = null,
  richMessage = null,
) {
  const existingMsgId = await getActiveMenuMsgId(userId);
  let targetMsgId = null;

  if (existingMsgId) {
    await deleteTelegramMessage(userId, existingMsgId);
  }

  let newMsg = null;
  if (richMessage && isRichMessageSupported()) {
    newMsg = await sendRichMessage(userId, richMessage, null);
  }
  if (!newMsg) {
    newMsg = await sendTelegramMessage(userId, text, markup);
  }
  if (newMsg) {
    targetMsgId = newMsg.message_id;
    await setActiveMenuMsgId(userId, targetMsgId, triggerMsgId);
  }

  if (targetMsgId) {
    const timerKey = `dm_dashboard_${userId}`;
    clearMenuTimer(timerKey);
    resetMenuTimer(timerKey, async () => {
      try {
        await deleteTelegramMessage(userId, targetMsgId);
        await setActiveMenuMsgId(userId, null);
      } catch (err) {
        console.error("Failed to auto-collapse DM dashboard:", err);
      }
    });
  }
}

app.post("/webhook", async (req, res) => {
  if (
    process.env.WEBHOOK_SECRET &&
    req.headers["x-telegram-bot-api-secret-token"] !==
      process.env.WEBHOOK_SECRET
  ) {
    return res.sendStatus(403);
  }
  if (!checkRateLimit("webhook", 100, 1000)) {
    return res.sendStatus(429);
  }
  try {
    const {
      message,
      callback_query: callbackQuery,
      inline_query: inlineQuery,
      chosen_inline_result: chosenResult,
    } = req.body;

    const updateType = message ? "message" : callbackQuery ? "callback" : inlineQuery ? "inline" : "other";
    console.log(`[WEBHOOK] ${updateType} received`);

    let userId = null;
    let userFirstName = null;

    if (message && message.from) {
      userId = message.from.id;
      userFirstName = message.from.first_name;
    } else if (callbackQuery && callbackQuery.from) {
      userId = callbackQuery.from.id;
      userFirstName = callbackQuery.from.first_name;
    } else if (inlineQuery && inlineQuery.from) {
      userId = inlineQuery.from.id;
      userFirstName = inlineQuery.from.first_name;
    } else if (chosenResult && chosenResult.from) {
      userId = chosenResult.from.id;
      userFirstName = chosenResult.from.first_name;
    }

    if (!userId) return res.sendStatus(200);

    if (message && message.text) {
      const chatId = message.chat.id;
      const msgId = message.message_id;
      const text = message.text.trim();

      if (wizardStateBounded.has(userId)) {
        const state = wizardStateBounded.get(userId);
        if (state.surface?.chatId !== chatId && !state.iMsgId) {
          return res.sendStatus(200);
        }
        await removeUserInput(message, userId);
        if (state.step === 1) {
          state.title = text;
          if (state.prefillDate) {
            const userTz = await getUserTimezone(userId);
            let prefillDt = DateTime.fromJSDate(state.prefillDate).setZone(userTz).set({ hour: 9, minute: 0, second: 0 });
            if (prefillDt <= DateTime.now().setZone(userTz)) {
              prefillDt = prefillDt.plus({ days: 1 });
            }
            state.time = {
              dt: prefillDt,
              date: prefillDt.toJSDate(),
              text: text,
              reminderText: text,
            };
            state.step = 3;
            wizardStateBounded.set(userId, state);
            if (state.iMsgId) {
              await editInlineMessage(
                state.iMsgId,
                "🔄 **How often should it repeat?**",
                {
                  inline_keyboard: [
                    [{ text: "None", callback_data: "wizard_repeat:none" }, { text: "Daily", callback_data: "wizard_repeat:daily:1" }],
                    [{ text: "Weekly", callback_data: "wizard_repeat:weekly:1" }, { text: "Monthly", callback_data: "wizard_repeat:monthly:1" }],
                    [{ text: "Every X Hours/Minutes", callback_data: "wizard_repeat:smart" }],
                    [{ text: "❌ Cancel", callback_data: "wizard_cancel" }],
                  ],
                },
              );
            } else {
              await editRichSurface(state.surface, buildRichMessage([
                richHeading("🔄 How often should it repeat?", 1),
                richDivider(),
                richButtons([
                  richButton("None", "wizard_repeat:none", "primary"),
                  richButton("Daily", "wizard_repeat:daily:1", "primary"),
                  richButton("Weekly", "wizard_repeat:weekly:1", "primary"),
                ]),
                richButtons([
                  richButton("Monthly", "wizard_repeat:monthly:1", "primary"),
                  richButton("Every X Hours/Minutes", "wizard_repeat:smart", "link"),
                ]),
                richButtons([
                  richButton("❌ Cancel", "wizard_cancel", "danger"),
                ]),
              ]));
            }
          } else {
            state.step = 2;
            wizardStateBounded.set(userId, state);
            if (state.iMsgId) {
              await editInlineMessage(
                state.iMsgId,
                "⏰ **When should this remind you?**\nExamples:\n• tomorrow 5pm\n• in 2 hours 30 minutes\n• Aug 12 8am\n• daily 9am (with repeat)",
                {
                  inline_keyboard: [
                    [{ text: "❌ Cancel", callback_data: "wizard_cancel" }],
                  ],
                },
              );
            } else {
              await editRichSurface(state.surface, buildRichMessage([
                richHeading("⏰ When should this remind you?", 1),
                richParagraph("Examples:\n• tomorrow 5pm\n• in 2 hours 30 minutes\n• Aug 12 8am\n• daily 9am (with repeat)"),
                richDivider(),
                richButtons([
                  richButton("❌ Cancel", "wizard_cancel", "danger"),
                ]),
              ]));
            }
          }
          return res.sendStatus(200);
        } else if (state.step === 2) {
          const userTz2 = await getUserTimezone(userId);
          const parsed2 = parseFlexibleDate(text, userTz2);
          if (!parsed2) {
            if (state.iMsgId) {
              await editInlineMessage(state.iMsgId, "⚠️ **Could not parse the time**\nPlease try again:\n• tomorrow 5pm\n• in 2h 30m\n• Aug 12 8am", {
                inline_keyboard: [[{ text: "❌ Cancel", callback_data: "wizard_cancel" }]],
              });
            } else {
              await editRichSurface(state.surface, buildRichMessage([
                richHeading("⚠️ Could not parse the time", 2),
                richParagraph("Please try again:\n• tomorrow 5pm\n• in 2h 30m\n• Aug 12 8am"),
                richDivider(),
                richButtons([
                  richButton("❌ Cancel", "wizard_cancel", "danger"),
                ]),
              ]));
            }
            return res.sendStatus(200);
          }
          state.time = parsed2;
          state.step = 3;
          wizardStateBounded.set(userId, state);
          if (state.iMsgId) {
            await editInlineMessage(state.iMsgId, "🔄 **How often should it repeat?**", {
              inline_keyboard: [
                [{ text: "None", callback_data: "wizard_repeat:none" }, { text: "Daily", callback_data: "wizard_repeat:daily:1" }],
                [{ text: "Weekly", callback_data: "wizard_repeat:weekly:1" }, { text: "Monthly", callback_data: "wizard_repeat:monthly:1" }],
                [{ text: "Every X Hours/Minutes", callback_data: "wizard_repeat:smart" }],
                [{ text: "❌ Cancel", callback_data: "wizard_cancel" }],
              ],
            });
          } else {
            await editRichSurface(state.surface, buildRichMessage([
              richHeading("🔄 How often should it repeat?", 1),
              richDivider(),
              richButtons([
                richButton("None", "wizard_repeat:none", "primary"),
                richButton("Daily", "wizard_repeat:daily:1", "primary"),
                richButton("Weekly", "wizard_repeat:weekly:1", "primary"),
              ]),
              richButtons([
                richButton("Monthly", "wizard_repeat:monthly:1", "primary"),
                richButton("Every X Hours/Minutes", "wizard_repeat:smart", "link"),
              ]),
              richButtons([
                richButton("❌ Cancel", "wizard_cancel", "danger"),
              ]),
            ]));
          }
          return res.sendStatus(200);
        } else if (state.step === 3.5) {
          const smartMatch = text.toLowerCase().match(
            /(?:every\s+)?(\d+)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?|months?)/i,
          );
          if (!smartMatch) {
            if (state.iMsgId) {
              await editInlineMessage(state.iMsgId, "⚠️ **Couldn't understand that**\nTry something like:\n• every 56 hours\n• every 2 days\n• every 90 minutes", {
                inline_keyboard: [[{ text: "❌ Cancel", callback_data: "wizard_cancel" }]],
              });
            } else {
              await editRichSurface(state.surface, buildRichMessage([
                richHeading("⚠️ Couldn't understand that", 2),
                richParagraph("Try something like:\n• every 56 hours\n• every 2 days\n• every 90 minutes"),
                richDivider(),
                richButtons([
                  richButton("❌ Cancel", "wizard_cancel", "danger"),
                ]),
              ]));
            }
            return res.sendStatus(200);
          }
          const num = parseInt(smartMatch[1], 10);
          const unitRaw = smartMatch[2].toLowerCase();
          let unit, unitLabel;
          if (unitRaw.startsWith("min")) {
            unit = "minutes";
            unitLabel = "Minutes";
          } else if (unitRaw.startsWith("hour") || unitRaw.startsWith("hr")) {
            unit = "hours";
            unitLabel = "Hours";
          } else if (unitRaw.startsWith("day")) {
            unit = "days";
            unitLabel = "Days";
          } else if (unitRaw.startsWith("week")) {
            unit = "weeks";
            unitLabel = "Weeks";
          } else if (unitRaw.startsWith("month")) {
            unit = "months";
            unitLabel = "Months";
          }
          state.repeat = `${unit}:${num}`;
          state.repeatText = `Every ${num} ${unitLabel}`;
          state.step = 4;
          wizardStateBounded.set(userId, state);
          if (state.iMsgId) {
            await editInlineMessage(state.iMsgId, "⏳ **How many minutes early should the warning be?**\nExample: 15, 30, 60 (or 0 for no warning)", {
              inline_keyboard: [
                [{ text: "5m", callback_data: "wizard_early:5" }, { text: "15m", callback_data: "wizard_early:15" }, { text: "30m", callback_data: "wizard_early:30" }, { text: "60m", callback_data: "wizard_early:60" }],
                [{ text: "None", callback_data: "wizard_early:0" }, { text: "❌ Cancel", callback_data: "wizard_cancel" }],
              ],
            });
          } else {
            await editRichSurface(state.surface, buildRichMessage([
              richHeading("⏳ How many minutes early should the warning be?", 1),
              richParagraph("Example: 15, 30, 60 (or 0 for no warning)"),
              richDivider(),
              richButtons([
                richButton("5m", "wizard_early:5", "primary"),
                richButton("15m", "wizard_early:15", "primary"),
                richButton("30m", "wizard_early:30", "primary"),
                richButton("60m", "wizard_early:60", "primary"),
              ]),
              richButtons([
                richButton("None", "wizard_early:0", "link"),
                richButton("❌ Cancel", "wizard_cancel", "danger"),
              ]),
            ]));
          }
          return res.sendStatus(200);
        } else if (state.step === 4) {
          const mins = parseInt(text, 10);
          if (isNaN(mins) || mins < 0) {
            if (state.iMsgId) {
              await editInlineMessage(state.iMsgId, "⚠️ **Invalid number**\nPlease enter a valid number of minutes (0 = no warning):", {
                inline_keyboard: [[{ text: "❌ Cancel", callback_data: "wizard_cancel" }]],
              });
            } else {
              await editRichSurface(state.surface, buildRichMessage([
                richHeading("⚠️ Invalid number", 2),
                richParagraph("Please enter a valid number of minutes (0 = no warning):"),
                richDivider(),
                richButtons([
                  richButton("❌ Cancel", "wizard_cancel", "danger"),
                ]),
              ]));
            }
            return res.sendStatus(200);
          }
          state.earlyWarning = mins === 0 ? null : mins;
          state.step = 5;
          wizardStateBounded.set(userId, state);
          const timeStr = state.time.dt.toFormat("EEE, MMM d, yyyy 'at' h:mm a");

          if (state.iMsgId) {
            await editInlineMessage(state.iMsgId, `📝 **Review Your Reminder**\n\n📌 **Title:** ${state.title}\n⏰ **Time:** ${timeStr}\n🔄 **Repeat:** ${state.repeatText || "None"}\n⏳ **Early Warning:** ${state.earlyWarning ? `${state.earlyWarning}m before` : "None"}`, {
              inline_keyboard: [
                [{ text: "✅ Create", callback_data: "wizard_confirm" }, { text: "❌ Cancel", callback_data: "wizard_cancel" }],
              ],
            });
          } else {
            await editRichSurface(state.surface, buildRichMessage([
              richHeading("📝 Review Your Reminder", 1),
              richTable([
                [{ text: "📌 Title" }, { text: state.title }],
                [{ text: "⏰ Time" }, { text: timeStr }],
                [{ text: "🔄 Repeat" }, { text: state.repeatText || "None" }],
                [{ text: "⏳ Early Warning" }, { text: state.earlyWarning ? `${state.earlyWarning}m before` : "None" }],
              ]),
              richDivider(),
              richButtons([
                richButton("✅ Create", "wizard_confirm", "success"),
                richButton("❌ Cancel", "wizard_cancel", "danger"),
              ]),
            ]));
          }
          return res.sendStatus(200);
        }
      }

      if (text.length > 500) {
        const pendingSurface = pendingEditSurfacesBounded.get(userId);
        if (pendingSurface) {
          await editSurface(
            pendingSurface,
            "⚠️ Reminder text is too long\\. Please keep it under 500 characters\\.",
            null,
          );
        } else {
          await beginPrivateSurface(
            message,
            userId,
            "⚠️ Reminder text is too long\\. Please keep it under 500 characters\\.",
            null,
          );
        }
        await removeUserInput(message, userId);
        return res.sendStatus(200);
      }
      const pendingEdit = await getPendingEdit(userId);
      if (pendingEdit) {
        const parts = pendingEdit.split(":");
        const field = parts[0];
        const reminderId = parts[1];
        const userTz = await getUserTimezone(userId);
        const pendingSurface = pendingEditSurfacesBounded.get(userId);

        if (pendingSurface && pendingSurface.chatId !== chatId) {
          return res.sendStatus(200);
        }
        await removeUserInput(message, userId);

        if (field === "text") {
          await pool.query(
            "UPDATE reminders SET text = $1 WHERE id = $2 AND user_id = $3",
            [text, reminderId, userId],
          );
        } else if (field === "time") {
          const parsed = parseFlexibleDate(text, userTz);
          if (parsed) {
            await pool.query(
              "UPDATE reminders SET remind_at = $1 WHERE id = $2 AND user_id = $3",
              [parsed.date, reminderId, userId],
            );
          } else {
            if (pendingSurface) {
              await editSurface(
                pendingSurface,
                "⚠️ Could not parse the new time\\. Please try again or tap Cancel\\.",
                {
                  inline_keyboard: [
                    [{ text: "⬅️ Cancel", callback_data: `edit:${reminderId}` }],
                  ],
                },
              );
            } else {
              await sendTelegramMessage(
                userId,
              "⚠️ Could not parse new time. Please try again or tap Cancel.",
                null,
                5000,
              );
            }
            return res.sendStatus(200);
          }
        } else if (field === "rec") {
          const unit = parts[2];
          const num = parseInt(text.trim(), 10);
          if (!isNaN(num) && num > 0) {
            const recurringVal = `${unit}:${num}`;
            await pool.query(
              "UPDATE reminders SET recurring = $1 WHERE id = $2 AND user_id = $3",
              [recurringVal, reminderId, userId],
            );
          } else {
            if (pendingSurface) {
              await editSurface(
                pendingSurface,
                "⚠️ Invalid number\\. Please enter a positive whole number\\.",
                {
                  inline_keyboard: [
                    [
                      {
                        text: "⬅️ Cancel",
                        callback_data: `nummenu:${reminderId}:${unit}`,
                      },
                    ],
                  ],
                },
              );
            }
            return res.sendStatus(200);
          }
        } else if (field === "early") {
          const mins = parseInt(text.trim(), 10);
          if (Number.isInteger(mins) && mins >= 0) {
            await pool.query(
              "UPDATE reminders SET early_offset = $1, early_alert_sent = FALSE WHERE id = $2 AND user_id = $3",
              [mins === 0 ? null : mins, reminderId, userId],
            );
          } else {
            if (pendingSurface) {
              await editSurface(
                pendingSurface,
                "⚠️ Enter a whole number of minutes, or 0 to turn the warning off\\.",
                {
                  inline_keyboard: [
                    [{ text: "⬅️ Cancel", callback_data: `edit:${reminderId}` }],
                  ],
                },
              );
            }
            return res.sendStatus(200);
          }
        }

        await setPendingEdit(userId, null);
        pendingEditSurfacesBounded.delete(userId);
        const dashData = await getRemindersDashboardData(
          userId,
          userTz,
          userFirstName,
        );
        if (pendingSurface) {
          await editRichSurface(pendingSurface, dashData.richMessage);
        } else {
          await sendOrUpdateDashboard(userId, dashData.text, dashData.keyboard, null, dashData.richMessage);
        }
        return res.sendStatus(200);
      }

      if (
        text.startsWith("/start") ||
        text.toLowerCase() === "view" ||
        text.toLowerCase().startsWith("/reminders")
      ) {
        const existingTz = await getUserTimezone(userId);
        if (existingTz) {
          const dashData = await getRemindersDashboardData(userId, existingTz);
          const surface = await beginRichSurface(message, userId, dashData.richMessage);
          if (surface) await removeUserInput(message, userId);
        } else {
          const tzRich = buildRichMessage([
            richHeading("👋 Welcome!", 1),
            richParagraph("Please select your primary timezone:"),
            richDivider(),
            richButtons([
              richButton("🇺🇸 Eastern", "settz:America/New_York", "primary"),
              richButton("🇺🇸 Central", "settz:America/Chicago", "primary"),
            ]),
            richButtons([
              richButton("🇺🇸 Mountain", "settz:America/Denver", "primary"),
              richButton("🇺🇸 Pacific", "settz:America/Los_Angeles", "primary"),
            ]),
            richButtons([
              richButton("🇬🇧 London", "settz:Europe/London", "primary"),
              richButton("🇪🇺 Central Europe", "settz:Europe/Paris", "primary"),
            ]),
            richButtons([
              richButton("🌐 UTC", "settz:UTC", "link"),
            ]),
          ]);
          const surface = await beginRichSurface(message, userId, tzRich);
          if (surface) await removeUserInput(message, userId);
        }
        return res.sendStatus(200);
      } else if (text.toLowerCase() === "create") {
        console.log("[WIZARD] Wizard triggered for user:", userId);
        wizardStateBounded.delete(userId);
        const openingRich = buildRichMessage([
          richHeading("🪄 Initiating reminder protocol...", 1),
          richParagraph("What should I remind you about?"),
          richDivider(),
          richButtons([
            richButton("❌ Abort", "wizard_cancel", "danger"),
          ]),
        ]);
        const surface = await beginRichSurface(message, userId, openingRich);

        if (!surface) return res.sendStatus(200);
        wizardStateBounded.set(userId, {
          step: 1,
          surface,
          originalChatId: isGroupChat(message.chat) ? userId : chatId,
        });
        await removeUserInput(message, userId);
        return res.sendStatus(200);
      } else if (text.toLowerCase() === "/help") {
        const helpRich = buildRichMessage([
          richHeading("🤖 Bot Commands & Usage", 1),
          richDivider(),
          richParagraph("/start — Welcome message + timezone selection"),
          richParagraph("create / create reminder — Create a reminder step-by-step"),
          richParagraph("/reminders — Show your active reminders"),
          richParagraph("/calendar — View reminders in calendar"),
          richDivider(),
          richParagraph("Or just type a natural reminder like:\nreminder tomorrow 5pm buy milk"),
        ]);
        const surface = await beginRichSurface(message, userId, helpRich);
        if (surface) await removeUserInput(message, userId);
        return res.sendStatus(200);
      } else if (text.toLowerCase() === "/cancel") {
        const state = wizardStateBounded.get(userId);
        const pendingSurface = pendingEditSurfacesBounded.get(userId);
        wizardStateBounded.delete(userId);
        pendingEditSurfacesBounded.delete(userId);
        await setPendingEdit(userId, null);
        clearUserPendingState(userId);
        if (state?.surface || pendingSurface) {
          await editSurface(
            state?.surface || pendingSurface,
            "✅ Operation cancelled\\. No changes were saved\\.",
            null,
          );
        } else {
          await beginPrivateSurface(
            message,
            userId,
            "✅ Operation cancelled\\. No changes were saved\\.",
            null,
          );
        }
        await removeUserInput(message, userId);
        return res.sendStatus(200);
      } else if (text.toLowerCase() === "/calendar" || text.toLowerCase() === "calendar") {
        const calUserTz = await getUserTimezone(userId);
        const now = DateTime.now().setZone(calUserTz || "America/Chicago");
        const remindersOnDay = await getRemindersForMonth(userId, now.year, now.month);
        const cal = buildCalendar(now.year, now.month, remindersOnDay);
        const calRich = buildRichMessage([
          richHeading(`📅 ${cal.monthName}`, 1),
          richParagraph("Tap a day to see reminders:"),
          richDivider(),
          ...cal.richBlocks,
        ]);
        const surface = await beginRichSurface(message, userId, calRich);
        if (surface) await removeUserInput(message, userId);
        return res.sendStatus(200);
      }

      if (message.location) {
        const { latitude, longitude } = message.location;
        const detectedTz = await detectTimezoneFromLocation(latitude, longitude);
        if (detectedTz) {
          await setUserTimezone(userId, detectedTz);
          await sendTelegramMessage(
            userId,
            `✅ Timezone auto-detected: *${detectedTz}*`,
            null,
            5000
          );
          const dashData = await getRemindersDashboardData(userId, detectedTz, userFirstName);
          await sendOrUpdateDashboard(userId, dashData.text, dashData.keyboard, null, dashData.richMessage);
        } else {
          await sendTelegramMessage(
            userId,
            "⚠️ Could not detect timezone from that location. Please select manually:",
            getTimezonePickerKeyboard()
          );
        }
        await removeUserInput(message, userId);
        return res.sendStatus(200);
      }

      const userTz = await getUserTimezone(userId);
      const parsed = parseFlexibleDate(text, userTz);

      if (!parsed) {
        if (typeof chatId !== "undefined" && typeof msgId !== "undefined") {
          await deleteTelegramMessage(chatId, msgId);
        }
        await beginPrivateSurface(
          message,
          userId,
          "⚠️ Could not understand that as a reminder\\. Try something like:\\n• tomorrow 5pm buy milk\\n• in 2 hours call mom\\n• Aug 12 8am meeting\\n• daily 9am take vitamins",
          {
            inline_keyboard: [
              [{ text: "❌ Close", callback_data: "surface_close" }],
            ],
          },
        );
        await removeUserInput(message, userId);
        return res.sendStatus(200);
      }

      if (parsed) {
        if (typeof chatId !== "undefined" && typeof msgId !== "undefined") {
          await deleteTelegramMessage(chatId, msgId);
        }
        const insertRes = await pool.query(
          "INSERT INTO reminders (user_id, chat_id, text, remind_at) VALUES ($1, $2, $3, $4) RETURNING id",
          [userId, chatId, parsed.reminderText, parsed.date],
        );
        if (parsed.wantRepeatMenu) {
          const editKb = getEditMenuKeyboard(insertRes.rows[0].id, null, null);
          await sendOrUpdateDashboard(
            userId,
            `📝 Editing Reminder: "**${escapeMarkdownV2(parsed.reminderText)}**"\nSelect options below:`,
            editKb,
            null,
            buildRichMessage([
              richHeading("✏️ Editing Reminder", 1),
              richParagraph("Select options below:"),
              richDivider(),
              ...editKb.richBlocks,
            ]),
          );
        } else {
          const dashData = await getRemindersDashboardData(
            userId,
            userTz,
            userFirstName,
          );
          await sendOrUpdateDashboard(
            userId,
            dashData.text,
            dashData.keyboard,
            msgId,
            dashData.richMessage,
          );
        }
      }
      return res.sendStatus(200);
    }

    if (callbackQuery) {
      const chatId = callbackQuery.message?.chat.id;
      const messageId = callbackQuery.message?.message_id;
      const data = callbackQuery.data;
      const callbackSurface = surfaceFromTelegramMessage(
        callbackQuery.message,
        userId,
      );
      const editCallbackSurface = (text, markup = null) =>
        editSurface(callbackSurface, text, markup);
      const editRichCallbackSurface = (richMessage, markup = null) =>
        editRichSurface(callbackSurface, richMessage, markup);

      const inlineMsgId = callbackQuery.inline_message_id;

      if (inlineMsgId) {
        const owner = inlineOwnerMap.get(inlineMsgId);
        if (owner && owner !== userId) {
          await answerCallbackQuery(callbackQuery.id, "⚠️ This button belongs to another user.", true);
          return res.sendStatus(200);
        }
      }

      console.log("[CALLBACK] data:", data, "inlineMsgId:", inlineMsgId, "hasMessage:", !!callbackQuery.message);
      if (messageId && chatId) {
        const timerKey = `dm_dashboard_${userId}`;
        clearMenuTimer(timerKey);
        resetMenuTimer(timerKey, async () => {
          await deleteTelegramMessage(chatId, messageId);
          await setActiveMenuMsgId(userId, null);
        });
      }

      let userTz = (await getUserTimezone(userId)) || "America/Chicago";

      if (messageId) {
        await setActiveMenuMsgId(userId, messageId);
      }

      if (data === "wizard_new") {
        await answerCallbackQuery(callbackQuery.id, "Opening reminder wizard in your DMs...", false);
        let surface = callbackSurface;
        if (!surface && inlineMsgId) {
          const sent = await sendRichMessage(
            userId,
            buildRichMessage([
              richHeading("📝 What's the reminder title?", 1),
              richParagraph("Type the title for your reminder (e.g., buy milk, team meeting, pay bills):"),
              richDivider(),
              richButtons([
                richButton("❌ Cancel", "wizard_cancel", "danger"),
              ]),
            ]),
          );
          if (sent) {
            surface = surfaceFromTelegramMessage(sent, userId);
            if (surface) surface.richContent = true;
          }
        } else if (surface) {
          await editRichSurface(surface, buildRichMessage([
            richHeading("📝 What's the reminder title?", 1),
            richParagraph("Type the title for your reminder (e.g., buy milk, team meeting, pay bills):"),
            richDivider(),
            richButtons([
              richButton("❌ Cancel", "wizard_cancel", "danger"),
            ]),
          ]));
        }
        if (surface) {
          wizardStateBounded.set(userId, {
            step: 1,
            surface,
            originalChatId: isGroupChat(callbackQuery.message?.chat)
              ? userId
              : chatId,
          });
        }
      } else if (data === "surface_close") {
        await answerCallbackQuery(callbackQuery.id);
        wizardStateBounded.delete(userId);
        pendingEditSurfacesBounded.delete(userId);
        await setPendingEdit(userId, null);
        clearUserPendingState(userId);
        if (callbackSurface?.ephemeral) {
          await deleteEphemeralMessage(
            callbackSurface.chatId,
            userId,
            callbackSurface.ephemeralMessageId,
          );
        } else if (callbackSurface) {
          await deleteTelegramMessage(
            callbackSurface.chatId,
            callbackSurface.messageId,
          );
        } else if (callbackQuery.inline_message_id) {
          await editInlineRichMessage(
            callbackQuery.inline_message_id,
            buildRichMessage([
              richHeading("✅ Closed", 1),
            ]),
          );
        }
      } else if (data.startsWith("wizard_repeat:")) {
        await answerCallbackQuery(callbackQuery.id);
        const parts = data.split(":");
        const repeatType = parts[1];
        if (repeatType === "custom") {
          const state = wizardStateBounded.get(userId);
          if (!state) return res.sendStatus(200);
          if (state.iMsgId) {
            await editInlineMessage(state.iMsgId, "⚙️ **Enter custom repeat interval**\nExamples:\n• daily:2 (every 2 days)\n• weekly:2 (every 2 weeks)\n• monthly:3 (every 3 months)", {
              inline_keyboard: [[{ text: "❌ Cancel", callback_data: "wizard_cancel" }]],
            });
          } else {
            await editRichSurface(state.surface, buildRichMessage([
              richHeading("⚙️ Enter custom repeat interval", 1),
              richParagraph("Examples:\n• daily:2 (every 2 days)\n• weekly:2 (every 2 weeks)\n• monthly:3 (every 3 months)"),
              richDivider(),
              richButtons([
                richButton("❌ Cancel", "wizard_cancel", "danger"),
              ]),
            ]));
          }
          return res.sendStatus(200);
        }
        if (repeatType === "smart") {
          const state = wizardStateBounded.get(userId);
          if (!state) return res.sendStatus(200);
          if (state.iMsgId) {
            await editInlineMessage(state.iMsgId, "🧠 **Enter repeat interval in natural language**\nExamples:\n• every 56 hours\n• every 2 days\n• every 90 minutes\n• every 3 weeks\n• every 6 months", {
              inline_keyboard: [[{ text: "❌ Cancel", callback_data: "wizard_cancel" }]],
            });
          } else {
            await editRichSurface(state.surface, buildRichMessage([
              richHeading("🧠 Enter repeat interval in natural language", 1),
              richParagraph("Examples:\n• every 56 hours\n• every 2 days\n• every 90 minutes\n• every 3 weeks\n• every 6 months"),
              richDivider(),
              richButtons([
                richButton("❌ Cancel", "wizard_cancel", "danger"),
              ]),
            ]));
          }
          state.step = 3.5;
          wizardStateBounded.set(userId, state);
          return res.sendStatus(200);
        }
        const state = wizardStateBounded.get(userId);
        if (state) {
          state.repeat =
            repeatType === "none" ? null : `${repeatType}:${parts[2] || "1"}`;
          state.repeatText =
            repeatType === "none"
              ? "None"
              : repeatType.charAt(0).toUpperCase() + repeatType.slice(1);
          state.step = 4;
          wizardStateBounded.set(userId, state);
          const earlyKeyboard = {
            inline_keyboard: [
              [
                { text: "5m", callback_data: "wizard_early:5" },
                { text: "15m", callback_data: "wizard_early:15" },
                { text: "30m", callback_data: "wizard_early:30" },
                { text: "60m", callback_data: "wizard_early:60" },
              ],
              [
                { text: "None", callback_data: "wizard_early:0" },
                { text: "❌ Cancel", callback_data: "wizard_cancel" },
              ],
            ],
          };
          if (state.iMsgId) {
            await editInlineMessage(state.iMsgId, "⏳ **How many minutes early should the warning be?**\nExample: 15, 30, 60 (or 0 for no warning)", earlyKeyboard);
          } else {
            await editRichSurface(state.surface, buildRichMessage([
              richHeading("⏳ How many minutes early should the warning be?", 1),
              richParagraph("Example: 15, 30, 60 (or 0 for no warning)"),
              richDivider(),
              richButtons([
                richButton("5m", "wizard_early:5", "primary"),
                richButton("15m", "wizard_early:15", "primary"),
                richButton("30m", "wizard_early:30", "primary"),
                richButton("60m", "wizard_early:60", "primary"),
              ]),
              richButtons([
                richButton("None", "wizard_early:0", "link"),
                richButton("❌ Cancel", "wizard_cancel", "danger"),
              ]),
            ]));
          }
        }
      } else if (data.startsWith("wizard_early:")) {
        await answerCallbackQuery(callbackQuery.id);
        const mins = parseInt(data.split(":")[1], 10);
        const state = wizardStateBounded.get(userId);
        if (state) {
          state.earlyWarning = mins === 0 ? null : mins;
          state.step = 5;
          wizardStateBounded.set(userId, state);
          const timeStr = state.time.dt.toFormat("EEE, MMM d, yyyy 'at' h:mm a");

          await editRichSurface(state.surface, buildRichMessage([
            richHeading("📝 Review Your Reminder", 1),
            richTable([
              [{ text: "📌 Title" }, { text: state.title }],
              [{ text: "⏰ Time" }, { text: timeStr }],
              [{ text: "🔄 Repeat" }, { text: state.repeatText || "None" }],
              [{ text: "⏳ Early Warning" }, { text: state.earlyWarning ? `${state.earlyWarning}m before` : "None" }],
            ]),
            richDivider(),
            richButtons([
              richButton("✅ Create", "wizard_confirm", "success"),
              richButton("❌ Cancel", "wizard_cancel", "danger"),
            ]),
          ]));
        }
      } else if (data === "wizard_confirm") {
        await answerCallbackQuery(callbackQuery.id);
        const state = wizardStateBounded.get(userId);
        if (state) {
          await pool.query(
            "INSERT INTO reminders (user_id, chat_id, text, remind_at, recurring, early_offset) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
            [
              userId,
              state.originalChatId,
              state.title,
              state.time.date,
              state.repeat,
              state.earlyWarning,
            ],
          );
          wizardStateBounded.delete(userId);
          const timeStr = state.time.dt.toFormat("EEE, MMM d, yyyy 'at' h:mm a");
          await editRichSurface(state.surface, buildRichMessage([
            richHeading("✅ Reminder Created!", 1),
            richTable([
              [{ text: "📌 Title" }, { text: state.title }],
              [{ text: "⏰ Time" }, { text: timeStr }],
              [{ text: "🔄 Repeat" }, { text: state.repeatText || "None" }],
              [{ text: "⏳ Early Warning" }, { text: state.earlyWarning ? `${state.earlyWarning}m before` : "None" }],
            ]),
            richDivider(),
            richButtons([
              richButton("📋 View Reminders", "menu:list", "primary"),
              richButton("➕ New Reminder", "wizard_new", "primary"),
            ]),
            richButtons([
              richButton("✖️ Close", "surface_close", "danger"),
            ]),
          ]));
        }
      } else if (data === "wizard_cancel") {
        const state = wizardStateBounded.get(userId);
        wizardStateBounded.delete(userId);
        clearUserPendingState(userId);
        await answerCallbackQuery(callbackQuery.id, "Wizard cancelled.", false);
        await editRichSurface(
          state?.surface || callbackSurface,
          buildRichMessage([
            richHeading("✅ Wizard cancelled", 2),
            richParagraph("No reminder was created."),
            richDivider(),
            richButtons([
              richButton("➕ Create Reminder", "wizard_new", "primary"),
              richButton("✖️ Close", "surface_close", "danger"),
            ]),
          ]),
        );
      } else if (data === "tz_detect") {
        await answerCallbackQuery(callbackQuery.id, "📍 Share your location to auto-detect timezone", false);
        await editRichCallbackSurface(buildRichMessage([
          richHeading("📍 Share Your Location", 1),
          richParagraph("Tap the button below to share your location, and I'll auto-detect your timezone."),
          richDivider(),
          richButtons([
            richButton("📍 Send Location", "tz_send_loc", "primary"),
          ]),
          richButtons([
            richButton("⬅️ Back", "menu:list", "link"),
          ]),
        ]));
      } else if (data === "tz_send_loc") {
        await answerCallbackQuery(callbackQuery.id);
        await editRichCallbackSurface(buildRichMessage([
          richHeading("📍 Share Your Location", 1),
          richParagraph("Use the attachment menu (📎) to share your location with the bot."),
          richDivider(),
          richButtons([
            richButton("⬅️ Back", "menu:list", "link"),
          ]),
        ]));
      } else if (data.startsWith("calprev:") || data.startsWith("calnext:")) {
        await answerCallbackQuery(callbackQuery.id);
        const parts = data.split(":");
        const calYear = parseInt(parts[1], 10);
        const calMonth = parseInt(parts[2], 10);
        const remindersOnDay = await getRemindersForMonth(userId, calYear, calMonth);
        const cal = buildCalendar(calYear, calMonth, remindersOnDay);
        await editRichCallbackSurface(buildRichMessage([
          richHeading(`📅 ${cal.monthName}`, 1),
          richParagraph("Tap a day to see reminders:"),
          richDivider(),
          ...cal.richBlocks,
        ]));
      } else if (data.startsWith("calday:")) {
        await answerCallbackQuery(callbackQuery.id);
        const dateKey = data.replace("calday:", "");
        const [calYear, calMonth, calDay] = dateKey.split("-").map(Number);
        if (isNaN(calYear) || isNaN(calMonth) || isNaN(calDay) || calMonth < 1 || calMonth > 12 || calDay < 1 || calDay > 31) {
          return res.sendStatus(200);
        }
        const calDt = DateTime.local(calYear, calMonth, calDay);
        if (!calDt.isValid) return res.sendStatus(200);
        const dayStart = calDt.startOf("day").toJSDate();
        const dayEnd = calDt.endOf("day").toJSDate();
        const res = await pool.query(
          "SELECT id, text, remind_at, recurring FROM reminders WHERE user_id = $1 AND sent = FALSE AND remind_at >= $2 AND remind_at < $3 ORDER BY remind_at ASC",
          [userId, dayStart, dayEnd]
        );
        const dateLabel = DateTime.local(calYear, calMonth, calDay).toFormat("EEEE, MMM d");
        if (res.rows.length === 0) {
          await editRichCallbackSurface(buildRichMessage([
            richHeading(`📅 ${dateLabel}`, 1),
            richParagraph("No reminders scheduled for this day."),
            richDivider(),
            richButtons([
              richButton("➕ Add Reminder", `caladd:${dateKey}`, "success"),
              richButton("⬅️ Back to Calendar", `calback:${calYear}:${calMonth}`, "link"),
            ]),
          ]));
        } else {
          const blocks = [
            richHeading(`📅 ${dateLabel}`, 1),
            richParagraph(`${res.rows.length} reminder(s):`),
            richDivider(),
          ];
          for (const r of res.rows) {
            const time = DateTime.fromJSDate(new Date(r.remind_at)).setZone(userTz || "America/Chicago").toFormat("h:mm a");
            blocks.push(richButtons([
              richButton(`${time} - ${r.text}`, `view:${r.id}`, "link"),
            ]));
          }
          blocks.push(richDivider());
          blocks.push(richButtons([
            richButton("➕ Add Reminder", `caladd:${dateKey}`, "success"),
            richButton("⬅️ Back to Calendar", `calback:${calYear}:${calMonth}`, "link"),
          ]));
          await editRichCallbackSurface(buildRichMessage(blocks));
        }
      } else if (data.startsWith("calback:")) {
        await answerCallbackQuery(callbackQuery.id);
        const parts = data.split(":");
        const calYear = parseInt(parts[1], 10);
        const calMonth = parseInt(parts[2], 10);
        const remindersOnDay = await getRemindersForMonth(userId, calYear, calMonth);
        const cal = buildCalendar(calYear, calMonth, remindersOnDay);
        await editRichCallbackSurface(buildRichMessage([
          richHeading(`📅 ${cal.monthName}`, 1),
          richParagraph("Tap a day to see reminders:"),
          richDivider(),
          ...cal.richBlocks,
        ]));
      } else if (data.startsWith("caladd:")) {
        await answerCallbackQuery(callbackQuery.id);
        const dateKey = data.replace("caladd:", "");
        const [calYear, calMonth, calDay] = dateKey.split("-").map(Number);
        if (isNaN(calYear) || isNaN(calMonth) || isNaN(calDay) || calMonth < 1 || calMonth > 12 || calDay < 1 || calDay > 31) {
          return res.sendStatus(200);
        }
        const calDt = DateTime.local(calYear, calMonth, calDay);
        if (!calDt.isValid) return res.sendStatus(200);
        const dateLabel = calDt.toFormat("EEEE, MMM d");
        wizardStateBounded.set(userId, {
          step: 1,
          surface: callbackSurface,
          originalChatId: isGroupChat(callbackQuery.message?.chat) ? userId : chatId,
          prefillDate: calDt,
        });
        await editRichCallbackSurface(buildRichMessage([
          richHeading("📝 What's the reminder title?", 1),
          richParagraph(`Adding a reminder for ${dateLabel}`),
          richDivider(),
          richButtons([
            richButton("❌ Cancel", `calday:${dateKey}`, "danger"),
          ]),
        ]));
      } else if (data.startsWith("settz:")) {
        const tz = data.replace("settz:", "");
        if (!DateTime.now().setZone(tz).isValid) {
          return res.sendStatus(200);
        }
        await setUserTimezone(userId, tz);
        await answerCallbackQuery(
          callbackQuery.id,
          `✅ Timezone saved: ${tz}`,
          true,
        );
        const dashData = await getRemindersDashboardData(
          userId,
          tz,
          userFirstName,
        );
        if (callbackSurface) {
          await editRichCallbackSurface(dashData.richMessage);
        } else {
          await sendOrUpdateDashboard(userId, dashData.text, dashData.keyboard, null, dashData.richMessage);
        }
      } else if (data === "noop") {
        await answerCallbackQuery(callbackQuery.id);
      } else if (data === "menu:list") {
        await answerCallbackQuery(callbackQuery.id);
        await setPendingEdit(userId, null);
        pendingEditSurfacesBounded.delete(userId);
        clearUserPendingState(userId);
        if (inlineMsgId) clearMenuTimer(`inline_${inlineMsgId}`);
        const dashData = await getRemindersDashboardData(
          userId,
          userTz,
          userFirstName,
        );
        pendingEditSurfacesBounded.delete(userId);
        if (callbackSurface) {
          await editRichCallbackSurface(dashData.richMessage);
        } else if (inlineMsgId) {
          await editInlineRichMessage(inlineMsgId, dashData.richMessage);
        } else {
          await sendOrUpdateDashboard(userId, dashData.text, null, null, dashData.richMessage);
        }
      } else if (data === "menu:calendar") {
        await answerCallbackQuery(callbackQuery.id);
        const now = DateTime.now().setZone(userTz || "America/Chicago");
        const remindersOnDay = await getRemindersForMonth(userId, now.year, now.month);
        const cal = buildCalendar(now.year, now.month, remindersOnDay);
        await editRichCallbackSurface(buildRichMessage([
          richHeading(`📅 ${cal.monthName}`, 1),
          richParagraph("Tap a day to see reminders:"),
          richDivider(),
          ...cal.richBlocks,
        ]));
      } else if (data.startsWith("del:")) {
        const reminderId = parseReminderId(data, "del:");
        if (!reminderId) return res.sendStatus(200);
        const key = `del_confirm:${userId}:${reminderId}`;

        if (pendingDeletes.has(key)) {
          pendingDeletes.delete(key);
          await pool.query(
            "DELETE FROM reminders WHERE id = $1 AND user_id = $2",
            [reminderId, userId],
          );
          await answerCallbackQuery(callbackQuery.id, "🗑️ Reminder deleted!", false);

          const dashData = await getRemindersDashboardData(userId, userTz, userFirstName);
          if (callbackSurface) {
            await editRichCallbackSurface(dashData.richMessage);
          } else if (callbackQuery.inline_message_id) {
            clearMenuTimer(`inline_${callbackQuery.inline_message_id}`);
            await editInlineRichMessage(callbackQuery.inline_message_id, dashData.richMessage);
          }
        } else {
          pendingDeletes.add(key);
          setTimeout(() => pendingDeletes.delete(key), 10000);
          await answerCallbackQuery(callbackQuery.id, "⚠️ Tap Delete again within 10s to confirm", false);
        }
        return res.sendStatus(200);
      } else if (data.startsWith("view:")) {
        const reminderId = parseReminderId(data, "view:");
        if (!reminderId) return res.sendStatus(200);
        const result = await pool.query(
          "SELECT text, remind_at, recurring, total_occurrences, current_occurrence, early_offset FROM reminders WHERE id = $1 AND user_id = $2",
          [reminderId, userId],
        );
        if (result.rows.length > 0) {
          const r = result.rows[0];
          const dt = DateTime.fromJSDate(new Date(r.remind_at)).setZone(userTz);

          const formattedTime = dt
            .toFormat("EEE, LLL d, yyyy 'at' h:mm a")
            .replace(/:00\s?(AM|PM)/i, "$1")
            .replace(/\s?(AM|PM)/i, (m) => m.toLowerCase().trim());

          let extras = [];
          if (r.recurring)
            extras.push(
              `🔄 Repeat: ${formatRepeatText(r.recurring)}${r.total_occurrences ? ` (${r.current_occurrence || 0}/${r.total_occurrences})` : ""}`,
            );
          if (r.early_offset)
            extras.push(`⏳ Early Warning: ${r.early_offset}m`);

          const richBlocks = [
            richHeading("🔔 Reminder Details", 1),
            richTable([
              [{ text: "📝 Title" }, { text: r.text }],
              [{ text: "🕒 Time" }, { text: formattedTime }],
              ...(r.recurring ? [[{ text: "🔄 Repeat" }, { text: formatRepeatText(r.recurring) + (r.total_occurrences ? ` (${r.current_occurrence || 0}/${r.total_occurrences})` : "") }]] : []),
              ...(r.early_offset ? [[{ text: "⏳ Early Warning" }, { text: `${r.early_offset}m` }]] : []),
            ]),
            richDivider(),
            richButtons([
              richButton("✏️ Edit", `edit:${reminderId}`, "primary"),
              richButton("❌ Delete", `del:${reminderId}`, "danger"),
            ]),
            richButtons([
              richButton("🔙 Back", "menu:list", "link"),
            ]),
          ];

          if (callbackQuery.inline_message_id) {
            const extrasStr = extras.length > 0 ? `\n\n━━━━━━━━━━━━━━━━━━\n${extras.join("\n")}` : "";
            await editInlineMessage(
              callbackQuery.inline_message_id,
              `🔔 **Reminder Details**\n📝 ${escapeMarkdownV2(r.text)}\n🕒 ${formattedTime}${extrasStr}`,
              {
                inline_keyboard: [
                  [{ text: "✏️ Edit", callback_data: `edit:${reminderId}` }, { text: "❌ Delete", callback_data: `del:${reminderId}` }],
                  [{ text: "🔙 Back", callback_data: "menu:list" }],
                ],
              },
            );
            const inlineTimerKey = `inline_${callbackQuery.inline_message_id}`;
            clearMenuTimer(inlineTimerKey);
            resetMenuTimer(inlineTimerKey, async () => {
              try {
                await editInlineMessage(
                  callbackQuery.inline_message_id,
                  "✅ Closed.",
                );
              } catch (err) {
                console.error("Failed to collapse inline details:", err);
              }
            });
          } else {
            await editRichCallbackSurface(buildRichMessage(richBlocks));
          }
        } else {
          await answerCallbackQuery(callbackQuery.id, "Reminder not found.", true);
        }
      } else if (data.startsWith("edit:")) {
        const reminderId = parseReminderId(data, "edit:");
        if (!reminderId) return res.sendStatus(200);
        await setPendingEdit(userId, null);
        pendingEditSurfacesBounded.delete(userId);
        await answerCallbackQuery(
          callbackQuery.id,
          "✏️ Edit this reminder?",
          false,
        );
        const iMsgId = callbackQuery.inline_message_id;
        console.log("[EDIT] reminderId:", reminderId, "iMsgId:", iMsgId, "callbackSurface:", !!callbackSurface, "hasMessage:", !!callbackQuery.message);

        if (!iMsgId) {
          await answerCallbackQuery(callbackQuery.id);
          const result = await pool.query(
            "SELECT text, recurring, total_occurrences, early_offset FROM reminders WHERE id = $1 AND user_id = $2",
            [reminderId, userId],
          );
          if (result.rows.length > 0) {
            const r = result.rows[0];
            await editRichCallbackSurface(
              buildEditMenuRich(reminderId, r.recurring, r.total_occurrences, r.early_offset),
            );
          }
          return res.sendStatus(200);
        }

        if (iMsgId) {
          const key = `edit_confirm:${userId}:${reminderId}`;
          if (pendingInlineEdits.has(key)) {
            pendingInlineEdits.delete(key);
            await answerCallbackQuery(
              callbackQuery.id,
              "📩 Sent edit options to DM!",
              false,
            );

            const result = await pool.query(
              "SELECT text, recurring, total_occurrences, early_offset FROM reminders WHERE id = $1 AND user_id = $2",
              [reminderId, userId],
            );
            if (result.rows.length > 0) {
              const r = result.rows[0];
              const activeMsgId = await getActiveMenuMsgId(userId);
              if (activeMsgId) {
                await deleteTelegramMessage(userId, activeMsgId);
                await setActiveMenuMsgId(userId, null);
              }
              await sendOrUpdateDashboard(
                userId,
                `✏️ Editing Reminder: "**${escapeMarkdownV2(r.text)}**"\n━━━━━━━━━━━━━━━━━━\nSelect options below:`,
                getEditMenuKeyboard(
                  reminderId,
                  r.recurring,
                  r.total_occurrences,
                  r.early_offset,
                ),
                null,
                buildEditMenuRich(reminderId, r.recurring, r.total_occurrences, r.early_offset),
              );
            }

            await editInlineMessage(iMsgId, "📝 *Edit menu sent to your DM!*");
          } else {
            pendingInlineEdits.add(key);
            setTimeout(() => pendingInlineEdits.delete(key), 10000);
            await answerCallbackQuery(
              callbackQuery.id,
              "⚠️ Tap Edit again within 10s to send options to your DM",
              false,
            );

            await editInlineMessage(
              iMsgId,
              "⚠️ **Tap Edit again within 10s** to send options to your DM",
              {
                inline_keyboard: [
                  [{ text: "✏️ Edit", callback_data: `edit:${reminderId}` }],
                ],
              },
            );
          }
          return res.sendStatus(200);
        }
      } else if (data.startsWith("setearly:")) {
        const parts = data.split(":");
        const reminderId = parseInt(parts[1], 10);
        if (isNaN(reminderId) || reminderId <= 0) return res.sendStatus(200);
        const mins = parseInt(parts[2], 10);
        const offsetVal = mins === 0 ? null : mins;
        await pool.query(
          "UPDATE reminders SET early_offset = $1, early_alert_sent = FALSE WHERE id = $2 AND user_id = $3",
          [offsetVal, reminderId, userId],
        );
        await answerCallbackQuery(
          callbackQuery.id,
          "⚡ Early warning updated!",
          true,
        );
        const result = await pool.query(
          "SELECT recurring, total_occurrences, early_offset FROM reminders WHERE id = $1 AND user_id = $2",
          [reminderId, userId],
        );
        if (result.rows.length > 0) {
          const r = result.rows[0];
          await editRichCallbackSurface(
            buildEditMenuRich(reminderId, r.recurring, r.total_occurrences, r.early_offset),
          );
        }
      } else if (data.startsWith("prompt_early:")) {
        const reminderId = data.replace("prompt_early:", "");
        await setPendingEdit(userId, `early:${reminderId}`);
        if (callbackSurface) pendingEditSurfacesBounded.set(userId, callbackSurface);
        await editRichCallbackSurface(buildRichMessage([
          richHeading("⚡ How many minutes early?", 1),
          richParagraph("Example: 15, 45, 120"),
          richDivider(),
          richButtons([
            richButton("⬅️ Cancel", `edit:${reminderId}`, "danger"),
          ]),
        ]));
        await answerCallbackQuery(callbackQuery.id);
      } else if (data.startsWith("prompt_edit_text:")) {
        const reminderId = parseReminderId(data, "prompt_edit_text:");
        if (!reminderId) return res.sendStatus(200);
        await setPendingEdit(userId, `text:${reminderId}`);
        if (callbackSurface) pendingEditSurfacesBounded.set(userId, callbackSurface);
        await editRichCallbackSurface(buildRichMessage([
          richHeading("📝 Type the new note/text", 1),
          richParagraph("Enter the new text for this reminder:"),
          richDivider(),
          richButtons([
            richButton("⬅️ Cancel", `edit:${reminderId}`, "danger"),
          ]),
        ]));
        await answerCallbackQuery(callbackQuery.id);
      } else if (data.startsWith("prompt_edit_time:")) {
        const reminderId = parseReminderId(data, "prompt_edit_time:");
        if (!reminderId) return res.sendStatus(200);
        await setPendingEdit(userId, `time:${reminderId}`);
        if (callbackSurface) pendingEditSurfacesBounded.set(userId, callbackSurface);
        await editRichCallbackSurface(buildRichMessage([
          richHeading("🕒 Type the new time/date", 1),
          richParagraph("Example: tomorrow at 8am, 2h, or Aug 12 5pm"),
          richDivider(),
          richButtons([
            richButton("⬅️ Cancel", `edit:${reminderId}`, "danger"),
          ]),
        ]));
        await answerCallbackQuery(callbackQuery.id);
      } else if (data.startsWith("dowmenu:")) {
        const reminderId = data.replace("dowmenu:", "");
        const result = await pool.query(
          "SELECT recurring FROM reminders WHERE id = $1 AND user_id = $2",
          [reminderId, userId],
        );
        if (result.rows.length > 0) {
          await answerCallbackQuery(callbackQuery.id);
          const current = result.rows[0].recurring;
          const selected = (current && current.startsWith("dow:"))
            ? current.split(":")[1].split(",").map(Number)
            : [];
          const dayLabel = (n, label) => selected.includes(n) ? `✅ ${label}` : label;
          await editRichCallbackSurface(buildRichMessage([
            richHeading("📅 Select specific days to repeat", 1),
            richDivider(),
            richButtons([
              richButton(dayLabel(1, "Mon"), `toggledow:${reminderId}:1`, "link"),
              richButton(dayLabel(2, "Tue"), `toggledow:${reminderId}:2`, "link"),
              richButton(dayLabel(3, "Wed"), `toggledow:${reminderId}:3`, "link"),
              richButton(dayLabel(4, "Thu"), `toggledow:${reminderId}:4`, "link"),
            ]),
            richButtons([
              richButton(dayLabel(5, "Fri"), `toggledow:${reminderId}:5`, "link"),
              richButton(dayLabel(6, "Sat"), `toggledow:${reminderId}:6`, "link"),
              richButton(dayLabel(7, "Sun"), `toggledow:${reminderId}:7`, "link"),
            ]),
            richDivider(),
            richButtons([
              richButton("💾 Save / Back", `edit:${reminderId}`, "primary"),
            ]),
          ]));
        }
      } else if (data.startsWith("toggledow:")) {
        const parts = data.split(":");
        const reminderId = parseInt(parts[1], 10);
        if (isNaN(reminderId) || reminderId <= 0) return res.sendStatus(200);
        const dayNum = parseInt(parts[2], 10);
        const result = await pool.query(
          "SELECT recurring FROM reminders WHERE id = $1 AND user_id = $2",
          [reminderId, userId],
        );
        if (result.rows.length > 0) {
          let current = result.rows[0].recurring;
          let selected =
            current && current.startsWith("dow:")
              ? current.split(":")[1].split(",").map(Number)
              : [];
          if (selected.includes(dayNum)) {
            selected = selected.filter((n) => n !== dayNum);
          } else {
            selected.push(dayNum);
          }
          selected.sort();
          let newRec = selected.length > 0 ? `dow:${selected.join(",")}` : null;
          await pool.query(
            "UPDATE reminders SET recurring = $1 WHERE id = $2 AND user_id = $3",
            [newRec, reminderId, userId],
          );
          await answerCallbackQuery(callbackQuery.id);
          const dayLabel = (n, label) => selected.includes(n) ? `✅ ${label}` : label;
          await editRichCallbackSurface(buildRichMessage([
            richHeading("📅 Select specific days to repeat", 1),
            richDivider(),
            richButtons([
              richButton(dayLabel(1, "Mon"), `toggledow:${reminderId}:1`, "link"),
              richButton(dayLabel(2, "Tue"), `toggledow:${reminderId}:2`, "link"),
              richButton(dayLabel(3, "Wed"), `toggledow:${reminderId}:3`, "link"),
              richButton(dayLabel(4, "Thu"), `toggledow:${reminderId}:4`, "link"),
            ]),
            richButtons([
              richButton(dayLabel(5, "Fri"), `toggledow:${reminderId}:5`, "link"),
              richButton(dayLabel(6, "Sat"), `toggledow:${reminderId}:6`, "link"),
              richButton(dayLabel(7, "Sun"), `toggledow:${reminderId}:7`, "link"),
            ]),
            richDivider(),
            richButtons([
              richButton("💾 Save / Back", `edit:${reminderId}`, "primary"),
            ]),
          ]));
        } else {
          await answerCallbackQuery(callbackQuery.id, "Reminder not found.", true);
        }
      } else if (data.startsWith("unitmenu:")) {
        const reminderId = parseReminderId(data, "unitmenu:");
        if (!reminderId) return res.sendStatus(200);
        await answerCallbackQuery(callbackQuery.id);
        await editRichCallbackSurface(buildRichMessage([
          richHeading("⚙️ Select Custom Interval Unit", 1),
          richDivider(),
          richButtons([
            richButton("⏱️ Hours", `nummenu:${reminderId}:hours`, "primary"),
            richButton("📅 Days", `nummenu:${reminderId}:days`, "primary"),
          ]),
          richButtons([
            richButton("🗓️ Weeks", `nummenu:${reminderId}:weeks`, "primary"),
            richButton("📆 Months", `nummenu:${reminderId}:months`, "primary"),
          ]),
          richDivider(),
          richButtons([
            richButton("⬅️ Back to Edit", `edit:${reminderId}`, "link"),
          ]),
        ]));
      } else if (data.startsWith("nummenu:")) {
        const [, reminderIdStr, unit] = data.split(":");
        const reminderId = parseInt(reminderIdStr, 10);
        if (isNaN(reminderId) || reminderId <= 0) return res.sendStatus(200);
        await setPendingEdit(userId, null);
        pendingEditSurfacesBounded.delete(userId);
        await answerCallbackQuery(callbackQuery.id);
        const nums = [2, 3, 4, 5, 6, 8, 10, 12, 14, 21, 30];
        const numButtons = [];
        for (let i = 0; i < nums.length; i += 4) {
          const row = nums.slice(i, i + 4).map(n =>
            richButton(`${n}`, `setrec:${reminderId}:${unit}:${n}`, "primary")
          );
          numButtons.push(richButtons(row));
        }
        await editRichCallbackSurface(buildRichMessage([
          richHeading(`⚙️ Every how many ${unit.toUpperCase()}?`, 1),
          richDivider(),
          ...numButtons,
          richDivider(),
          richButtons([
            richButton("✍️ Custom Number...", `prompt_rec:${reminderId}:${unit}`, "link"),
          ]),
          richButtons([
            richButton("⬅️ Back to Units", `unitmenu:${reminderId}`, "link"),
          ]),
        ]));
      } else if (data.startsWith("prompt_rec:")) {
        const [, reminderId, unit] = data.split(":");
        await setPendingEdit(userId, `rec:${reminderId}:${unit}`);
        if (callbackSurface) pendingEditSurfacesBounded.set(userId, callbackSurface);
        await editRichCallbackSurface(buildRichMessage([
          richHeading(`⚙️ Enter custom repeat interval in ${unit.toUpperCase()}`, 1),
          richParagraph("Example: 56, 72, 100"),
          richDivider(),
          richButtons([
            richButton("⬅️ Cancel", `nummenu:${reminderId}:${unit}`, "danger"),
          ]),
        ]));
        await answerCallbackQuery(callbackQuery.id);
      } else if (data.startsWith("limitmenu:")) {
        const reminderId = data.replace("limitmenu:", "");
        const result = await pool.query(
          "SELECT total_occurrences, early_offset FROM reminders WHERE id = $1 AND user_id = $2",
          [reminderId, userId],
        );
        if (result.rows.length > 0) {
          await answerCallbackQuery(callbackQuery.id);
          const current = result.rows[0].total_occurrences || 0;
          const limits = [0, 2, 3, 5, 10, 15, 20, 30, 50, 100];
          const limitButtons = [];
          for (let i = 0; i < limits.length; i += 3) {
            const row = limits.slice(i, i + 3).map(val => {
              const label = val === 0 ? "Forever" : `${val}x`;
              return richButton(current === val ? `✅ ${label}` : label, `setlimit:${reminderId}:${val}`, "link");
            });
            limitButtons.push(richButtons(row));
          }
          await editRichCallbackSurface(buildRichMessage([
            richHeading("🔁 Select How Many Times to Repeat", 1),
            richDivider(),
            ...limitButtons,
            richDivider(),
            richButtons([
              richButton("⬅️ Back to Edit", `edit:${reminderId}`, "link"),
            ]),
          ]));
        } else {
          await answerCallbackQuery(callbackQuery.id, "Reminder not found.", true);
        }
      } else if (data.startsWith("setrec:")) {
        const [, reminderIdStr, recType, interval = "1"] = data.split(":");
        const reminderId = parseInt(reminderIdStr, 10);
        if (isNaN(reminderId) || reminderId <= 0) return res.sendStatus(200);
        const recurringVal =
          recType === "none" ? null : `${recType}:${interval}`;

        await pool.query(
          "UPDATE reminders SET recurring = $1 WHERE id = $2 AND user_id = $3",
          [recurringVal, reminderId, userId],
        );
        await answerCallbackQuery(
          callbackQuery.id,
          "✅ Recurrence updated!",
          true,
        );

        const result = await pool.query(
          "SELECT total_occurrences, early_offset FROM reminders WHERE id = $1 AND user_id = $2",
          [reminderId, userId],
        );
        if (result.rows.length > 0) {
          await editRichCallbackSurface(
            buildEditMenuRich(reminderId, recurringVal, result.rows[0].total_occurrences, result.rows[0].early_offset),
          );
        }
      } else if (data.startsWith("setlimit:")) {
        const [, reminderIdStr, countStr] = data.split(":");
        const reminderId = parseInt(reminderIdStr, 10);
        if (isNaN(reminderId) || reminderId <= 0) return res.sendStatus(200);
        const count = parseInt(countStr, 10);
        const limitVal = count === 0 ? null : count;

        await pool.query(
          "UPDATE reminders SET total_occurrences = $1 WHERE id = $2 AND user_id = $3",
          [limitVal, reminderId, userId],
        );
        await answerCallbackQuery(
          callbackQuery.id,
          "✅ Repeat limit updated!",
          true,
        );

        const result = await pool.query(
          "SELECT recurring, early_offset FROM reminders WHERE id = $1 AND user_id = $2",
          [reminderId, userId],
        );
        if (result.rows.length > 0) {
          await editRichCallbackSurface(
            buildEditMenuRich(reminderId, result.rows[0].recurring, limitVal, result.rows[0].early_offset),
          );
        }
      }
    }

    if (inlineQuery) {
      console.log("[INLINE] Query received:", inlineQuery.query || "(empty)");
      try {
        const userTz = (await getUserTimezone(userId)) || "America/Chicago";
        const queryText = inlineQuery.query.trim();
        let results = [];

        if (queryText) {
          results.push({
            type: "article",
            id: "noop_text",
            title: "⚠️ Don't type — just tap below",
            description: "👇🏼 Swipe up for more options 👇🏼",
            input_message_content: {
              message_text: "📝 **No text needed\\!** Just pick an option below\\.",
              parse_mode: "MarkdownV2",
            },
          });
        }

        results.push({
          type: "article",
          id: "create_wizard_dm",
          title: "🪄 Create Reminder",
          description: "Tap to start the reminder wizard",
          thumbnail_url:
            "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1fa84.png",
          thumb_width: 72,
          thumb_height: 72,
          input_message_content: {
            message_text:
              "📝 **Opening reminder wizard\\.\\.\\.**",
            parse_mode: "MarkdownV2",
          },
          reply_markup: {
            inline_keyboard: [
              [{ text: "⏳ Loading...", callback_data: "noop" }],
            ],
          },
        });
        results.push({
          type: "article",
          id: "show_reminders_dm",
          title: "📋 View Reminders (DM)",
          description: "👇🏼 Manage in your DM",
          thumbnail_url:
            "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4e9.png",
          thumb_width: 72,
          thumb_height: 72,
          input_message_content: {
            message_text:
              "💻 **\\[INIT\\_DM\\] Establishing encrypted tunnel\\.\\.\\.**",
            parse_mode: "MarkdownV2",
          },
          reply_markup: {
            inline_keyboard: [
              [{ text: "📡 Injecting payload...", callback_data: "noop" }],
            ],
          },
        });
        results.push({
          type: "article",
          id: "show_reminders_inline_v6",
          title: "📋 View Reminders Inline",
          description: "👇🏼 Show list in this chat",
          thumbnail_url:
            "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f5e8.png",
          thumb_width: 72,
          thumb_height: 72,
          input_message_content: {
            message_text: "📋 **Fetching active reminders\\.\\.\\.**",
            parse_mode: "MarkdownV2",
          },
          reply_markup: {
            inline_keyboard: [
              [{ text: "⏳ Loading...", callback_data: "noop" }],
            ],
          },
        });

        console.log("[INLINE] Sending", results.length, "results");
        await answerInlineQuery(inlineQuery.id, results);
      } catch (inlineErr) {
        console.error("[INLINE] Error handling inline query:", inlineErr);
      }
    }

    if (chosenResult) {
      const selectedResultId = chosenResult.result_id || "";
      const iMsgId = chosenResult.inline_message_id || null;

      if (iMsgId && userId) {
        inlineOwnerMap.set(iMsgId, userId);
      }

      if (selectedResultId === "show_reminders_dm") {
        const userTz = (await getUserTimezone(userId)) || "America/Chicago";
        const dashData = await getRemindersDashboardData(
          userId,
          userTz,
          userFirstName,
        );
        await sendOrUpdateDashboard(userId, dashData.text, dashData.keyboard, null, dashData.richMessage);

        if (iMsgId) {
          setTimeout(async () => {
            try {
              await editInlineMessage(iMsgId, `✅ **Reminders sent to your DM\\!**`);
            } catch (err) {
              console.error("Failed to collapse inline DM message:", err);
            }
          }, 3000);
        }
      } else if (selectedResultId === "show_reminders_inline_v6") {
        const userTz = (await getUserTimezone(userId)) || "America/Chicago";
        const dashData = await getRemindersDashboardData(
          userId,
          userTz,
          userFirstName,
        );

        if (iMsgId) {
          await editInlineRichMessage(iMsgId, dashData.richMessage);
        } else {
          await sendOrUpdateDashboard(userId, dashData.text, dashData.keyboard, null, dashData.richMessage);
        }
      } else if (selectedResultId === "show_reminders_share") {
        const userTz = (await getUserTimezone(userId)) || "America/Chicago";
        const dashData = await getRemindersDashboardData(
          userId,
          userTz,
          userFirstName,
        );

        if (iMsgId) {
          await editInlineMessage(iMsgId, dashData.text, dashData.keyboard);
        }
      } else if (selectedResultId === "create_wizard_dm") {
        if (iMsgId) {
          wizardStateBounded.set(userId, {
            step: 1,
            iMsgId: iMsgId,
            originalChatId: null,
          });
          await editInlineMessage(
            iMsgId,
            "📝 **What's the reminder title?**\nType the title for your reminder (e.g., buy milk, team meeting, pay bills):",
            {
              inline_keyboard: [
                [{ text: "❌ Cancel", callback_data: "wizard_cancel" }],
              ],
            },
          );
        }
      }
    }
    res.sendStatus(200);
  } catch (error) {
    console.error("[WEBHOOK ERROR]:", error);
    res.sendStatus(500);
  }
});
