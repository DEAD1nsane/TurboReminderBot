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
const ISOFormatParser_1 = __importDefault(require("../../common/parsers/ISOFormatParser"));
const SlashDateFormatParser_1 = __importDefault(require("../../common/parsers/SlashDateFormatParser"));
const VIStandardParser_1 = __importDefault(require("./parsers/VIStandardParser"));
const VIMonthYearParser_1 = __importDefault(require("./parsers/VIMonthYearParser"));
const VIYearParser_1 = __importDefault(require("./parsers/VIYearParser"));
const VICasualDateParser_1 = __importDefault(require("./parsers/VICasualDateParser"));
const VICasualTimeParser_1 = __importDefault(require("./parsers/VICasualTimeParser"));
const VIWeekdayParser_1 = __importDefault(require("./parsers/VIWeekdayParser"));
const VITimeExpressionParser_1 = __importDefault(require("./parsers/VITimeExpressionParser"));
const VITimeUnitAgoFormatParser_1 = __importDefault(require("./parsers/VITimeUnitAgoFormatParser"));
const VITimeUnitLaterFormatParser_1 = __importDefault(require("./parsers/VITimeUnitLaterFormatParser"));
const VITimeUnitWithinFormatParser_1 = __importDefault(require("./parsers/VITimeUnitWithinFormatParser"));
const VITimeUnitCasualRelativeFormatParser_1 = __importDefault(require("./parsers/VITimeUnitCasualRelativeFormatParser"));
const VIMergeDateRangeRefiner_1 = __importDefault(require("./refiners/VIMergeDateRangeRefiner"));
const VIMergeDateTimeRefiner_1 = __importDefault(require("./refiners/VIMergeDateTimeRefiner"));
const VIMergeWeekdayComponentRefiner_1 = __importDefault(require("./refiners/VIMergeWeekdayComponentRefiner"));
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
    option.parsers.unshift(new VICasualTimeParser_1.default());
    option.parsers.unshift(new VICasualDateParser_1.default());
    option.parsers.unshift(new VITimeUnitCasualRelativeFormatParser_1.default());
    return option;
}
function createConfiguration(strictMode = true, littleEndian = true) {
    return (0, configurations_1.includeCommonConfiguration)({
        parsers: [
            new ISOFormatParser_1.default(),
            new SlashDateFormatParser_1.default(littleEndian),
            new VIStandardParser_1.default(),
            new VIMonthYearParser_1.default(),
            new VIYearParser_1.default(),
            new VIWeekdayParser_1.default(),
            new VITimeExpressionParser_1.default(),
            new VITimeUnitAgoFormatParser_1.default(strictMode),
            new VITimeUnitLaterFormatParser_1.default(strictMode),
            new VITimeUnitWithinFormatParser_1.default(strictMode),
        ],
        refiners: [
            new VIMergeWeekdayComponentRefiner_1.default(),
            new VIMergeDateRangeRefiner_1.default(),
            new VIMergeDateTimeRefiner_1.default(),
        ],
    }, strictMode);
}
//# sourceMappingURL=index.js.map