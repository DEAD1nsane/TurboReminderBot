"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("../constants");
const results_1 = require("../../../results");
const AbstractParserWithWordBoundary_1 = require("../../../common/parsers/AbstractParserWithWordBoundary");
const duration_1 = require("../../../calculation/duration");
class FITimeUnitAgoFormatParser extends AbstractParserWithWordBoundary_1.AbstractParserWithWordBoundaryChecking {
    innerPattern() {
        return new RegExp(`(${constants_1.TIME_UNITS_PATTERN})\\s*sitten(?=\\W|$)`, "i");
    }
    innerExtract(context, match) {
        const timeUnits = (0, constants_1.parseDuration)(match[1]);
        const outputTimeUnits = (0, duration_1.reverseDuration)(timeUnits);
        return results_1.ParsingComponents.createRelativeFromReference(context.reference, outputTimeUnits);
    }
}
exports.default = FITimeUnitAgoFormatParser;
//# sourceMappingURL=FITimeUnitAgoFormatParser.js.map