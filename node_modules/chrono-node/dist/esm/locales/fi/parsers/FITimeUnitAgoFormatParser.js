import { parseDuration, TIME_UNITS_PATTERN } from "../constants.js";
import { ParsingComponents } from "../../../results.js";
import { AbstractParserWithWordBoundaryChecking } from "../../../common/parsers/AbstractParserWithWordBoundary.js";
import { reverseDuration } from "../../../calculation/duration.js";
export default class FITimeUnitAgoFormatParser extends AbstractParserWithWordBoundaryChecking {
    innerPattern() {
        return new RegExp(`(${TIME_UNITS_PATTERN})\\s*sitten(?=\\W|$)`, "i");
    }
    innerExtract(context, match) {
        const timeUnits = parseDuration(match[1]);
        const outputTimeUnits = reverseDuration(timeUnits);
        return ParsingComponents.createRelativeFromReference(context.reference, outputTimeUnits);
    }
}
//# sourceMappingURL=FITimeUnitAgoFormatParser.js.map