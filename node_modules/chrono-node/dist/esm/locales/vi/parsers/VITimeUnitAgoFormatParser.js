import { parseDuration, TIME_UNITS_PATTERN } from "../constants.js";
import { ParsingComponents } from "../../../results.js";
import { AbstractParserWithWordBoundaryChecking } from "../../../common/parsers/AbstractParserWithWordBoundary.js";
import { reverseDuration } from "../../../calculation/duration.js";
const PATTERN = new RegExp("(" + TIME_UNITS_PATTERN + ")" + "\\s{0,5}(?:tr\u01b0\u1edbc|qua)(?=\\W|$)", "i");
export default class VITimeUnitAgoFormatParser extends AbstractParserWithWordBoundaryChecking {
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
        return ParsingComponents.createRelativeFromReference(context.reference, reverseDuration(duration));
    }
}
//# sourceMappingURL=VITimeUnitAgoFormatParser.js.map