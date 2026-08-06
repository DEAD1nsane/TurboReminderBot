import { MONTH_DICTIONARY, YEAR_PATTERN, parseYear } from "../constants.js";
import { matchAnyPattern } from "../../../utils/pattern.js";
import { AbstractParserWithWordBoundaryChecking } from "../../../common/parsers/AbstractParserWithWordBoundary.js";
const PATTERN = new RegExp("(" + matchAnyPattern(MONTH_DICTIONARY) + ")" + "(?:\\s*(?:năm|/)\\s*(" + YEAR_PATTERN + "))?" + "(?=\\W|$)", "i");
const MONTH_GROUP = 1;
const YEAR_GROUP = 2;
export default class VIMonthYearParser extends AbstractParserWithWordBoundaryChecking {
    innerPattern() {
        return PATTERN;
    }
    innerExtract(context, match) {
        const month = MONTH_DICTIONARY[match[MONTH_GROUP].toLowerCase()];
        if (!month)
            return null;
        const result = context.createParsingResult(match.index, match[0]);
        result.start.assign("month", month);
        result.start.imply("day", 1);
        if (match[YEAR_GROUP]) {
            result.start.assign("year", parseYear(match[YEAR_GROUP]));
        }
        else {
            result.start.imply("year", context.reference.getDateWithAdjustedTimezone().getFullYear());
        }
        return result;
    }
}
//# sourceMappingURL=VIMonthYearParser.js.map