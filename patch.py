import re
with open('index.js', 'r') as f:
    c = f.read()

# Make inline collapse and creation messages bold
c = c.replace("'🫈 Squatch spotted! List collapsed before anyone got proof.'", "'<b>🫈 Squatch spotted! List collapsed before anyone got proof.</b>'")
c = c.replace("`✅ Reminder Created for ${chosenResult.from?.first_name || 'you'}!`", "`<b>✅ Reminder Created for ${chosenResult.from?.first_name || 'you'}!</b>`")

# Clean up double bolding just in case the script runs twice
c = c.replace("'<b><b>", "'<b>").replace("</b></b>'", "</b>'")
c = c.replace("`<b><b>", "`<b>").replace("</b></b>`", "</b>`")

# Robust block replacement for the view pop-up layout
pattern = re.compile(r"(\} else if \(data\.startsWith\('view:'\)\) \{).*?(?=\} else if \(data\.startsWith\('edit:'\)\) \{)", re.DOTALL)

new_block = r"""\1
            const reminderId = data.replace('view:', '');
            const result = await pool.query('SELECT text, remind_at, recurring, total_occurrences, current_occurrence, early_offset FROM reminders WHERE id = $1 AND user_id = $2', [reminderId, userId]);
            if (result.rows.length > 0) {
                const r = result.rows[0];
                const dt = DateTime.fromJSDate(new Date(r.remind_at)).setZone('America/Chicago');
                
                // Format shorthand time (e.g. 2:00 PM -> 2pm)
                const formattedTime = dt.toFormat("EEE, LLL d, yyyy 'at' h:mm a")
                    .replace(/:00\s?(AM|PM)/i, '$1')
                    .replace(/\s?(AM|PM)/i, m => m.toLowerCase().trim());
                
                // Build extras string with divider line
                let extras = [];
                if (r.recurring) extras.push(`🔄 | Repeat: ${formatRepeatText(r.recurring)}${r.total_occurrences ? ` (${r.current_occurrence || 0}/${r.total_occurrences})` : ""}`);
                if (r.early_offset) extras.push(`⚡ | Early Warning: ${r.early_offset}m`);
                const extrasStr = extras.length > 0 ? `\n\n—\n${extras.join('\n')}` : "";

                await answerCallbackQuery(callbackQuery.id, `🔔 | ${r.text}\n🕒 | ${formattedTime}${extrasStr}`, true);
            }
        """
        
c = pattern.sub(new_block, c)

with open('index.js', 'w') as f:
    f.write(c)
