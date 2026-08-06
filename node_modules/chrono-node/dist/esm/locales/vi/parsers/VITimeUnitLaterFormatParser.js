import { parseDuration, TIME_UNITS_PATTERN } from "../constants.js";
import { ParsingComponents } from "../../../results.js";
import { AbstractParserWithWordBoundaryChecking } from "../../../common/parsers/AbstractParserWithWordBoundary.js";
const PATTERN = new RegExp("(" + TIME_UNITS_PATTERN + ")" + "\\s{0,5}(?:sau|n\u1eefa|t\u1edbi|ti\u1ebfp)(?=\\W|$)", "i");
export default class VITimeUnitLaterFormatParser extends AbstractParserWithWordBoundaryChecking {
    strictMode;
    constructor(strictMode = false) {
        super();
        this.strictMode = strictMode;
    }
    innerPattern() {
        return PATTERN;
    }
    innerExtract(context, match) {
        const duration = parseDuration(match[1]);
        if (!duration)
            return null;
        return ParsingComponents.createRelativeFromReference(context.reference, duration);
    }
}
//# sourceMappingURL=VITimeUnitLaterFormatParser.js.map