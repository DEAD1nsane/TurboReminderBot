const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

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
  const payload = { chat_id: chatId, text, parse_mode: "MarkdownV2" };
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
    text,
    parse_mode: "MarkdownV2",
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
    text,
    parse_mode: "MarkdownV2",
  };
  if (replyMarkup !== undefined) payload.reply_markup = replyMarkup;
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
    text,
    parse_mode: "MarkdownV2",
  };
  if (replyMarkup !== undefined) payload.reply_markup = replyMarkup;
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

module.exports = {
  sendTelegramMessage,
  sendEphemeralMessage,
  editTelegramMessage,
  editEphemeralMessage,
  deleteTelegramMessage,
  deleteEphemeralMessage,
  answerCallbackQuery,
  setEphemeralGroupCommands,
  fetchWithTimeout,
};
