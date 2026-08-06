const express = require('express');
const chrono = require('chrono-node');
const { DateTime } = require('luxon');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TIMEZONE = 'America/Chicago';

function parseFlexibleDate(text) {
    let clean = text.trim().toLowerCase().replace(/^reminder\s*/, '');

    // Expand shorthand syntax (e.g., 1m -> in 1 minute, 2h -> in 2 hours)
    const shorthandRegex = /^(\d+)\s*([mhd])$/i;
    const match = clean.match(shorthandRegex);
    if (match) {
        const num = match[1];
        const unitMap = { m: 'minute', h: 'hour', d: 'day' };
        clean = `in ${num} ${unitMap[match[2]]}`;
    } else if (/^\d+\s*(m|min|minute|minutes|h|hr|hour|hours|d|day|days)/i.test(clean)) {
        clean = `in ${clean}`;
    }

    return chrono.parseDate(clean, new Date());
}

app.post('/webhook', async (req, res) => {
    const inlineQuery = req.body.inline_query;
    if (inlineQuery) {
        const queryId = inlineQuery.id;
        const queryText = inlineQuery.query.trim().toLowerCase();

        let results = [];

        if (!queryText || queryText === 'reminder') {
            const presets = [
                { id: '1', title: '5 Minutes', time: 'in 5 minutes' },
                { id: '2', title: '15 Minutes', time: 'in 15 minutes' },
                { id: '3', title: '1 Hour', time: 'in 1 hour' },
                { id: '4', title: '1 Day', time: 'in 1 day' }
            ];

            results = presets.map(p => {
                const parsedDate = chrono.parseDate(p.time, new Date());
                const dt = DateTime.fromJSDate(parsedDate).setZone(TIMEZONE);
                return {
                    type: 'article',
                    id: p.id,
                    title: `Remind in ${p.title}`,
                    description: `Set reminder for ${dt.toFormat('ff')}`,
                    input_message_content: {
                        message_text: `Reminder set for ${p.title} (${dt.toFormat('ff')})`
                    }
                };
            });

            results.push({
                type: 'article',
                id: 'custom_prompt',
                title: '✍️ Custom Time...',
                description: 'Type a time (e.g. "1m", "10m", "2h")',
                input_message_content: {
                    message_text: 'Type your custom reminder time after the bot username.'
                }
            });
        } else {
            const parsedDate = parseFlexibleDate(queryText);
            let resultText = parsedDate 
                ? `Parsed Time: ${DateTime.fromJSDate(parsedDate).setZone(TIMEZONE).toFormat('ff')}`
                : `Could not parse time from: "${queryText}"`;

            results.push({
                type: 'article',
                id: String(Date.now()),
                title: 'Custom Reminder',
                description: resultText,
                input_message_content: {
                    message_text: resultText
                }
            });
        }

        const url = `https://api.telegram.org/bot${TOKEN}/answerInlineQuery`;
        try {
            await fetch(url, {
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

    res.sendStatus(200);
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
