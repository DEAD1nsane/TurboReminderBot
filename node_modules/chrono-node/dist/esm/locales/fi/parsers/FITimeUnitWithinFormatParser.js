import { TIME_UNITS_PATTERN, parseDuration } from "../constants.js";
import { ParsingComponents } from "../../../results.js";
import { AbstractParserWithWordBoundaryChecking } from "../../../common/parsers/AbstractParserWithWordBoundary.js";
export default class FITimeUnitWithinFormatParser extends AbstractParserWithWordBoundaryChecking {
    innerPattern() {
        return new RegExp(`(${TIME_UNITS_PATTERN})\\s*(?:sisällä|kuluessa|päästä)(?=\\W|$)`, "i");
    }
    innerExtract(context, match) {
        const timeUnits = parseDuration(match[1]);
        return ParsingComponents.createRelativeFromReference(context.reference, timeUnits);
    }
}
//# sourceMappingURL=FITimeUnitWithinFormatParser.js.map