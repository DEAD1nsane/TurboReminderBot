"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("../constants");
const results_1 = require("../../../results");
const AbstractParserWithWordBoundary_1 = require("../../../common/parsers/AbstractParserWithWordBoundary");
class FITimeUnitWithinFormatParser extends AbstractParserWithWordBoundary_1.AbstractParserWithWordBoundaryChecking {
    innerPattern() {
        return new RegExp(`(${constants_1.TIME_UNITS_PATTERN})\\s*(?:sisällä|kuluessa|päästä)(?=\\W|$)`, "i");
    }
    innerExtract(context, match) {
        const timeUnits = (0, constants_1.parseDuration)(match[1]);
        return results_1.ParsingComponents.createRelativeFromReference(context.reference, timeUnits);
    }
}
exports.default = FITimeUnitWithinFormatParser;
//# sourceMappingURL=FITimeUnitWithinFormatParser.js.map