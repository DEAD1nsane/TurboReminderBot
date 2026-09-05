const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * The original bot writes messages with a small, Markdown-like vocabulary
 * (**bold**, *italic*, `code`, ||spoiler|| and leading > quotes). Converting
 * that vocabulary to Telegram HTML avoids MarkdownV2's fragile requirement
 * to escape every period, parenthesis, hyphen and other reserved character.
 * User-provided text is HTML-escaped before any request is sent.
 */
function formatTelegramHtml(text) {
  const unescaped = String(text || "").replace(
    /\\([_*\[\]()~`>#+\-=|{}.!\\])/g,
    "$1",
  );
  let formatted = escapeHtml(unescaped);

  formatted = formatted.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  formatted = formatted.replace(/\*\*([\s\S]+?)\*\*/g, "<b>$1</b>");
  formatted = formatted.replace(
    /(^|[^*])\*([^*\n]+)\*(?!\*)/g,
    "$1<i>$2</i>",
  );
  formatted = formatted.replace(
    /\|\|([\s\S]+?)\|\|/g,
    "<tg-spoiler>$1</tg-spoiler>",
  );
  formatted = formatted
    .split("\n")
    .map((line) =>
      line.startsWith("&gt; ")
        ? `<blockquote>${line.slice(5)}</blockquote>`
        : line,
    )
    .join("\n");

  return formatted;
}

let richMessageSupported = true;

async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 10000 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(resource, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(id);
  }
}

async function checkRichMessageSupport() {
  try {
    const res = await callTelegram("getBotInfo", {}, "getBotInfo");
    if (res) {
      richMessageSupported = true;
      console.log("[TELEGRAM] Rich message support: enabled (Bot API 10.2+ required)");
    }
  } catch {
    richMessageSupported = false;
    console.log("[TELEGRAM] Could not verify rich message support, will fallback to MarkdownV2");
  }
}

function isRichMessageSupported() {
  return richMessageSupported;
}

async function callTelegram(method, payload, logLabel = method) {
  try {
    const res = await fetchWithTimeout(
      `https://api.telegram.org/bot${TOKEN}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const data = await res.json();
    if (!data.ok) {
      console.error(`[TELEGRAM] ${logLabel} failed:`, data.description);
      return null;
    }
    return data.result;
  } catch (err) {
    console.error(`[TELEGRAM] ${logLabel} error:`, err);
    return null;
  }
}

async function sendTelegramMessage(
  chatId,
  text,
  replyMarkup = null,
  autoDeleteMs = null,
) {
  const payload = {
    chat_id: chatId,
    text: formatTelegramHtml(text),
    parse_mode: "HTML",
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  const result = await callTelegram("sendMessage", payload);
  if (result && autoDeleteMs) {
    setTimeout(
      () => deleteTelegramMessage(chatId, result.message_id),
      autoDeleteMs,
    );
  }
  return result || null;
}

/**
 * Sends a Bot API 10.3 ephemeral group message. The returned Message has
 * message_id=0 and an ephemeral_message_id that must be used for later edits.
 */
async function sendEphemeralMessage(
  chatId,
  receiverUserId,
  text,
  replyMarkup = null,
  options = {},
) {
  const ephemeralParams = { receiver_user_id: receiverUserId };
  if (options.callbackQueryId) {
    ephemeralParams.callback_query_id = options.callbackQueryId;
  }
  if (options.replaceCallbackQueryMessage) {
    ephemeralParams.replace_callback_query_message = true;
  }

  const payload = {
    chat_id: chatId,
    text: formatTelegramHtml(text),
    parse_mode: "HTML",
    ephemeral_message_parameters: ephemeralParams,
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  if (options.replyToEphemeralMessageId) {
    payload.reply_parameters = {
      ephemeral_message_id: options.replyToEphemeralMessageId,
    };
  }

  return (
    (await callTelegram("sendMessage", payload, "send ephemeral message")) ||
    null
  );
}

async function editTelegramMessage(
  chatId,
  messageId,
  text,
  replyMarkup = null,
) {
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text: formatTelegramHtml(text),
    parse_mode: "HTML",
  };
  if (replyMarkup != null) payload.reply_markup = replyMarkup;
  const result = await callTelegram("editMessageText", payload);
  return result !== null;
}

async function editEphemeralMessage(
  chatId,
  receiverUserId,
  ephemeralMessageId,
  text,
  replyMarkup = null,
) {
  const payload = {
    chat_id: chatId,
    receiver_user_id: receiverUserId,
    ephemeral_message_id: ephemeralMessageId,
    text: formatTelegramHtml(text),
    parse_mode: "HTML",
  };
  if (replyMarkup != null) payload.reply_markup = replyMarkup;
  const result = await callTelegram(
    "editEphemeralMessageText",
    payload,
    "edit ephemeral message",
  );
  return result !== null;
}

async function deleteTelegramMessage(chatId, messageId) {
  return callTelegram("deleteMessage", {
    chat_id: chatId,
    message_id: messageId,
  });
}

async function deleteEphemeralMessage(
  chatId,
  receiverUserId,
  ephemeralMessageId,
) {
  return callTelegram(
    "deleteEphemeralMessage",
    {
      chat_id: chatId,
      receiver_user_id: receiverUserId,
      ephemeral_message_id: ephemeralMessageId,
    },
    "delete ephemeral message",
  );
}

async function answerCallbackQuery(
  callbackQueryId,
  text = "",
  showAlert = false,
) {
  return callTelegram("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert,
  });
}

async function setEphemeralGroupCommands(commands) {
  return callTelegram(
    "setMyCommands",
    {
      commands: commands.map((command) => ({
        ...command,
        is_ephemeral: true,
      })),
      scope: { type: "all_group_chats" },
    },
    "register ephemeral group commands",
  );
}

// ── Rich Message API (Bot API 10.2+) ──────────────────────────────────────

async function sendRichMessage(chatId, richMessage, replyMarkup = null) {
  const payload = { chat_id: chatId, rich_message: richMessage };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  const result = await callTelegram("sendRichMessage", payload, "send rich message");
  return result || null;
}

async function editRichMessage(chatId, messageId, richMessage, replyMarkup = null) {
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    rich_message: richMessage,
    reply_markup: replyMarkup || { inline_keyboard: [] },
  };
  const result = await callTelegram("editMessageText", payload, "edit rich message");
  return result !== null;
}

async function sendRichEphemeralMessage(
  chatId,
  receiverUserId,
  richMessage,
  replyMarkup = null,
  options = {},
) {
  const ephemeralParams = { receiver_user_id: receiverUserId };
  if (options.callbackQueryId) {
    ephemeralParams.callback_query_id = options.callbackQueryId;
  }
  if (options.replaceCallbackQueryMessage) {
    ephemeralParams.replace_callback_query_message = true;
  }

  const payload = {
    chat_id: chatId,
    rich_message: richMessage,
    ephemeral_message_parameters: ephemeralParams,
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  if (options.replyToEphemeralMessageId) {
    payload.reply_parameters = {
      ephemeral_message_id: options.replyToEphemeralMessageId,
    };
  }

  return (
    (await callTelegram("sendRichMessage", payload, "send rich ephemeral message")) ||
    null
  );
}

async function editRichEphemeralMessage(
  chatId,
  receiverUserId,
  ephemeralMessageId,
  richMessage,
  replyMarkup = null,
) {
  const payload = {
    chat_id: chatId,
    receiver_user_id: receiverUserId,
    ephemeral_message_id: ephemeralMessageId,
    rich_message: richMessage,
  };
  if (replyMarkup != null) payload.reply_markup = replyMarkup;
  const result = await callTelegram(
    "editEphemeralMessageText",
    payload,
    "edit rich ephemeral message",
  );
  return result !== null;
}

// ── Inline message edit (no chat_id needed) ────────────────────────────────

// ── Inline message edit (no chat_id needed) ────────────────────────────────

async function editInlineRichMessage(inlineMessageId, richMessage, replyMarkup = null) {
  const payload = {
    inline_message_id: inlineMessageId,
    rich_message: richMessage,
    reply_markup: replyMarkup || { inline_keyboard: [] },
  };
  const result = await callTelegram("editMessageText", payload, "edit inline rich message");
  return result !== null;
}

async function editInlineMessage(inlineMessageId, text, replyMarkup = null) {
  const payload = {
    inline_message_id: inlineMessageId,
    text,
    parse_mode: "MarkdownV2",
  };
  if (replyMarkup != null) payload.reply_markup = replyMarkup;
  const result = await callTelegram("editMessageText", payload, "edit inline message");
  return result !== null;
}

module.exports = {
  sendTelegramMessage,
  sendEphemeralMessage,
  editTelegramMessage,
  editEphemeralMessage,
  deleteTelegramMessage,
  deleteEphemeralMessage,
  answerCallbackQuery,
  setEphemeralGroupCommands,
  formatTelegramHtml,
  fetchWithTimeout,
  sendRichMessage,
  editRichMessage,
  sendRichEphemeralMessage,
  editRichEphemeralMessage,
  editInlineRichMessage,
  editInlineMessage,
  checkRichMessageSupport,
  isRichMessageSupported,
};
