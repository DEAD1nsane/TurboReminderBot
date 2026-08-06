const { chrono } = require('chrono-node');
const { DateTime } = require('luxon');

const userInput = "in 2 hours";
const userTimezone = "America/Chicago";

// Get current time in the user's timezone
const nowLocal = DateTime.now().setZone(userTimezone);

// Parse natural language relative to the user's local reference date
const parsedDate = chrono.parseDate(userInput, nowLocal.toJSDate());

if (parsedDate) {
    // Convert JS Date to Luxon DateTime in the user's timezone
    const localDt = DateTime.fromJSDate(parsedDate, { zone: userTimezone });
    
    // Convert to UTC for database scheduling
    const utcDt = localDt.toUTC();

    console.log(`User Local Time: ${localDt.toISO()}`);
    console.log(`Store in DB (UTC): ${utcDt.toISO()}`);
} else {
    console.log("Could not parse time.");
}
