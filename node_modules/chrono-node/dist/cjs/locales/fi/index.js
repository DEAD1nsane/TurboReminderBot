"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.strict = exports.casual = exports.Weekday = exports.Meridiem = exports.ReferenceWithTimezone = exports.ParsingComponents = exports.ParsingResult = exports.Chrono = void 0;
exports.parse = parse;
exports.parseDate = parseDate;
exports.createCasualConfiguration = createCasualConfiguration;
exports.createConfiguration = createConfiguration;
const configurations_1 = require("../../configurations");
const chrono_1 = require("../../chrono");
Object.defineProperty(exports, "Chrono", { enumerable: true, get: function () { return chrono_1.Chrono; } });
const results_1 = require("../../results");
Object.defineProperty(exports, "ParsingResult", { enumerable: true, get: function () { return results_1.ParsingResult; } });
Object.defineProperty(exports, "ParsingComponents", { enumerable: true, get: function () { return results_1.ParsingComponents; } });
Object.defineProperty(exports, "ReferenceWithTimezone", { enumerable: true, get: function () { return results_1.ReferenceWithTimezone; } });
const types_1 = require("../../types");
Object.defineProperty(exports, "Meridiem", { enumerable: true, get: function () { return types_1.Meridiem; } });
Object.defineProperty(exports, "Weekday", { enumerable: true, get: function () { return types_1.Weekday; } });
const SlashDateFormatParser_1 = __importDefault(require("../../common/parsers/SlashDateFormatParser"));
const ISOFormatParser_1 = __importDefault(require("../../common/parsers/ISOFormatParser"));
const FITimeExpressionParser_1 = __importDefault(require("./parsers/FITimeExpressionParser"));
const FIWeekdayParser_1 = __importDefault(require("./parsers/FIWeekdayParser"));
const FIMonthNameLittleEndianParser_1 = __importDefault(require("./parsers/FIMonthNameLittleEndianParser"));
const FITimeUnitCasualRelativeFormatParser_1 = __importDefault(require("./parsers/FITimeUnitCasualRelativeFormatParser"));
const FITimeUnitAgoFormatParser_1 = __importDefault(require("./parsers/FITimeUnitAgoFormatParser"));
const FITimeUnitWithinFormatParser_1 = __importDefault(require("./parsers/FITimeUnitWithinFormatParser"));
const FICasualDateParser_1 = __importDefault(require("./parsers/FICasualDateParser"));
const FICasualTimeParser_1 = __importDefault(require("./parsers/FICasualTimeParser"));
const FIMergeDateRangeRefiner_1 = __importDefault(require("./refiners/FIMergeDateRangeRefiner"));
const FIMergeDateTimeRefiner_1 = __importDefault(require("./refiners/FIMergeDateTimeRefiner"));
exports.casual = new chrono_1.Chrono(createCasualConfiguration());
exports.strict = new chrono_1.Chrono(createConfiguration(true));
function parse(text, ref, option) {
    return exports.casual.parse(text, ref, option);
}
function parseDate(text, ref, option) {
    return exports.casual.parseDate(text, ref, option);
}
function createCasualConfiguration(littleEndian = true) {
    const option = createConfiguration(false, littleEndian);
    option.parsers.unshift(new FICasualTimeParser_1.default());
    option.parsers.unshift(new FICasualDateParser_1.default());
    option.parsers.unshift(new FITimeUnitCasualRelativeFormatParser_1.default());
    return option;
}
function createConfiguration(strictMode = true, littleEndian = true) {
    return (0, configurations_1.includeCommonConfiguration)({
        parsers: [
            new ISOFormatParser_1.default(),
            new SlashDateFormatParser_1.default(littleEndian),
            new FITimeExpressionParser_1.default(),
            new FIMonthNameLittleEndianParser_1.default(),
            new FIWeekdayParser_1.default(),
            new FITimeUnitWithinFormatParser_1.default(),
            new FITimeUnitAgoFormatParser_1.default(),
        ],
        refiners: [new FIMergeDateRangeRefiner_1.default(), new FIMergeDateTimeRefiner_1.default()],
    }, strictMode);
}
//# sourceMappingURL=index.js.map