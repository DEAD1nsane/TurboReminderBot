"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("../constants");
const results_1 = require("../../../results");
const AbstractParserWithWordBoundary_1 = require("../../../common/parsers/AbstractParserWithWordBoundary");
const duration_1 = require("../../../calculation/duration");
const PATTERN = new RegExp(`(seuraava|seuraavat|seuraavien|edellinen|edelliset|edellisten|viimeiset|viimeisten|kuluneet|kuluneiden|\\+|-)\\s*(${constants_1.TIME_UNITS_PATTERN})(?=\\W|$)`, "i");
const PATTERN_NO_ABBR = new RegExp(`(seuraava|seuraavat|seuraavien|edellinen|edelliset|edellisten|viimeiset|viimeisten|kuluneet|kuluneiden|\\+|-)\\s*(${constants_1.TIME_UNITS_NO_ABBR_PATTERN})(?=\\W|$)`, "i");
class FITimeUnitCasualRelativeFormatParser extends AbstractParserWithWordBoundary_1.AbstractParserWithWordBoundaryChecking {
    constructor(allowAbbreviations = true) {
        super();
        this.allowAbbreviations = allowAbbreviations;
    }
    innerPattern() {
        return this.allowAbbreviations ? PATTERN : PATTERN_NO_ABBR;
    }
    innerExtract(context, match) {
        const prefix = match[1].toLowerCase();
        let duration = (0, constants_1.parseDuration)(match[2]);
        if (!duration) {
            return null;
        }
        switch (prefix) {
            case "edellinen":
            case "edelliset":
            case "edellisten":
            case "viimeiset":
            case "viimeisten":
            case "kuluneet":
            case "kuluneiden":
            case "-":
                duration = (0, duration_1.reverseDuration)(duration);
                break;
        }
        return results_1.ParsingComponents.createRelativeFromReference(context.reference, duration);
    }
}
exports.default = FITimeUnitCasualRelativeFormatParser;
//# sourceMappingURL=FITimeUnitCasualRelativeFormatParser.js.map