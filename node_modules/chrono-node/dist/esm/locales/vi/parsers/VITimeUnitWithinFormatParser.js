import { parseDuration, TIME_UNITS_PATTERN } from "../constants.js";
import { ParsingComponents } from "../../../results.js";
import { AbstractParserWithWordBoundaryChecking } from "../../../common/parsers/AbstractParserWithWordBoundary.js";
const PATTERN = new RegExp("(?:trong\\s*(?:v\u00f2ng\\s*)?)" + "(" + TIME_UNITS_PATTERN + ")(?=\\W|$)", "i");
export default class VITimeUnitWithinFormatParser extends AbstractParserWithWordBoundaryChecking {
    strictMode;
    constructor(strictMode = false) {
        super();
        this.strictMode = strictMode;
    }
    innerPattern() {
        return PATTERN;
    }
    innerExtract(context, match) {
        const timeUnits = parseDuration(match[1]);
        if (!timeUnits)
            return null;
        return ParsingComponents.createRelativeFromReference(context.reference, timeUnits);
    }
}
//# sourceMappingURL=VITimeUnitWithinFormatParser.js.map