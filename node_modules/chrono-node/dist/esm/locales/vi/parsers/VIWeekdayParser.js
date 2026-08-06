import { WEEKDAY_DICTIONARY } from "../constants.js";
import { matchAnyPattern } from "../../../utils/pattern.js";
import { AbstractParserWithWordBoundaryChecking } from "../../../common/parsers/AbstractParserWithWordBoundary.js";
import { createParsingComponentsAtWeekday } from "../../../calculation/weekdays.js";
const PATTERN = new RegExp("(" +
    matchAnyPattern(WEEKDAY_DICTIONARY) +
    ")" +
    "(?:\\s*(này|tới|sau(?!\\s*khi)|qua))?" +
    "(?=\\W|$)", "i");
const WEEKDAY_GROUP = 1;
const MODIFIER_GROUP = 2;
export default class VIWeekdayParser extends AbstractParserWithWordBoundaryChecking {
    innerPattern() {
        return PATTERN;
    }
    innerExtract(context, match) {
        const dowText = match[WEEKDAY_GROUP].toLowerCase();
        const dow = WEEKDAY_DICTIONARY[dowText];
        if (dow === undefined)
            return null;
        const modifier = match[MODIFIER_GROUP];
        let modifierType = null;
        if (modifier) {
            const m = modifier.toLowerCase();
            if (m.includes("tới") || m.includes("sau"))
                modifierType = "next";
            else if (m.includes("qua"))
                modifierType = "last";
        }
        return createParsingComponentsAtWeekday(context.reference, dow, modifierType);
    }
}
//# sourceMappingURL=VIWeekdayParser.js.map