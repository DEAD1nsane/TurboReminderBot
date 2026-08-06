import { parseDuration, TIME_UNITS_NO_ABBR_PATTERN, TIME_UNITS_PATTERN } from "../constants.js";
import { ParsingComponents } from "../../../results.js";
import { AbstractParserWithWordBoundaryChecking } from "../../../common/parsers/AbstractParserWithWordBoundary.js";
const PATTERN = new RegExp(`(${TIME_UNITS_PATTERN})\\s{0,5}(?:dopo|più\\s*tardi|da\\s*adesso|da\\s*ora)` + "(?=(?:\\W|$))", "i");
const STRICT_PATTERN = new RegExp(`(${TIME_UNITS_NO_ABBR_PATTERN})\\s{0,5}(dopo|più\\s*tardi|da\\s*adesso|da\\s*ora)(?=\\W|$)`, "i");
const GROUP_NUM_TIMEUNITS = 1;
export default class ITTimeUnitLaterFormatParser extends AbstractParserWithWordBoundaryChecking {
    strictMode;
    constructor(strictMode) {
        super();
        this.strictMode = strictMode;
    }
    innerPattern() {
        return this.strictMode ? STRICT_PATTERN : PATTERN;
    }
    innerExtract(context, match) {
        const timeUnits = parseDuration(match[GROUP_NUM_TIMEUNITS]);
        if (!timeUnits) {
            return null;
        }
        return ParsingComponents.createRelativeFromReference(context.reference, timeUnits);
    }
}
//# sourceMappingURL=ITTimeUnitLaterFormatParser.js.map