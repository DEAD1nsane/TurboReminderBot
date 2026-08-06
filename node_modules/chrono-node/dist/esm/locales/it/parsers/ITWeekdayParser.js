import { WEEKDAY_DICTIONARY } from "../constants.js";
import { matchAnyPattern } from "../../../utils/pattern.js";
import { AbstractParserWithWordBoundaryChecking } from "../../../common/parsers/AbstractParserWithWordBoundary.js";
import { createParsingComponentsAtWeekday } from "../../../calculation/weekdays.js";
import { Weekday } from "../../../types.js";
const PATTERN = new RegExp("(?:(?:\\,|\\(|\\（)\\s*)?" +
    "(?:(questo|questa|quest'|scorso|scorsa|prossimo|prossima)\\s*)?" +
    `(${matchAnyPattern(WEEKDAY_DICTIONARY)}|weekend|fine\\s*settimana)` +
    "(?:\\s*(?:\\,|\\)|\\）))?" +
    "(?:\\s*(scorso|scorsa|prossimo|prossima)(?:\\s*settimana)?)?" +
    "(?=\\W|$)", "i");
const PREFIX_GROUP = 1;
const WEEKDAY_GROUP = 2;
const POSTFIX_GROUP = 3;
export default class ITWeekdayParser extends AbstractParserWithWordBoundaryChecking {
    innerPattern() {
        return PATTERN;
    }
    innerExtract(context, match) {
        const prefix = match[PREFIX_GROUP];
        const postfix = match[POSTFIX_GROUP];
        let modifierWord = prefix || postfix;
        modifierWord = modifierWord || "";
        modifierWord = modifierWord.toLowerCase();
        let modifier = null;
        if (modifierWord == "scorso" || modifierWord == "scorsa") {
            modifier = "last";
        }
        else if (modifierWord == "prossimo" || modifierWord == "prossima") {
            modifier = "next";
        }
        else if (modifierWord == "questo" || modifierWord == "questa" || modifierWord == "quest'") {
            modifier = "this";
        }
        const weekday_word = match[WEEKDAY_GROUP].toLowerCase();
        let weekday;
        if (WEEKDAY_DICTIONARY[weekday_word] !== undefined) {
            weekday = WEEKDAY_DICTIONARY[weekday_word];
        }
        else if (weekday_word == "weekend" || weekday_word.match(/fine\s*settimana/)) {
            weekday = modifier == "last" ? Weekday.SUNDAY : Weekday.SATURDAY;
        }
        else {
            return null;
        }
        return createParsingComponentsAtWeekday(context.reference, weekday, modifier);
    }
}
//# sourceMappingURL=ITWeekdayParser.js.map