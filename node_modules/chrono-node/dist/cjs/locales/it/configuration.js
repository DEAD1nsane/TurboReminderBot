"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ITTimeUnitWithinFormatParser_1 = __importDefault(require("./parsers/ITTimeUnitWithinFormatParser"));
const ITMonthNameLittleEndianParser_1 = __importDefault(require("./parsers/ITMonthNameLittleEndianParser"));
const ITMonthNameMiddleEndianParser_1 = __importDefault(require("./parsers/ITMonthNameMiddleEndianParser"));
const ITMonthNameParser_1 = __importDefault(require("./parsers/ITMonthNameParser"));
const ITYearMonthDayParser_1 = __importDefault(require("./parsers/ITYearMonthDayParser"));
const ITSlashMonthFormatParser_1 = __importDefault(require("./parsers/ITSlashMonthFormatParser"));
const ITTimeExpressionParser_1 = __importDefault(require("./parsers/ITTimeExpressionParser"));
const ITTimeUnitAgoFormatParser_1 = __importDefault(require("./parsers/ITTimeUnitAgoFormatParser"));
const ITTimeUnitLaterFormatParser_1 = __importDefault(require("./parsers/ITTimeUnitLaterFormatParser"));
const ITMergeDateRangeRefiner_1 = __importDefault(require("./refiners/ITMergeDateRangeRefiner"));
const ITMergeDateTimeRefiner_1 = __importDefault(require("./refiners/ITMergeDateTimeRefiner"));
const configurations_1 = require("../../configurations");
const ITCasualDateParser_1 = __importDefault(require("./parsers/ITCasualDateParser"));
const ITCasualTimeParser_1 = __importDefault(require("./parsers/ITCasualTimeParser"));
const ITWeekdayParser_1 = __importDefault(require("./parsers/ITWeekdayParser"));
const ITRelativeDateFormatParser_1 = __importDefault(require("./parsers/ITRelativeDateFormatParser"));
const SlashDateFormatParser_1 = __importDefault(require("../../common/parsers/SlashDateFormatParser"));
const ITTimeUnitCasualRelativeFormatParser_1 = __importDefault(require("./parsers/ITTimeUnitCasualRelativeFormatParser"));
const ITMergeRelativeAfterDateRefiner_1 = __importDefault(require("./refiners/ITMergeRelativeAfterDateRefiner"));
const ITMergeRelativeFollowByDateRefiner_1 = __importDefault(require("./refiners/ITMergeRelativeFollowByDateRefiner"));
const OverlapRemovalRefiner_1 = __importDefault(require("../../common/refiners/OverlapRemovalRefiner"));
const ITExtractYearSuffixRefiner_1 = __importDefault(require("./refiners/ITExtractYearSuffixRefiner"));
const ITUnlikelyFormatFilter_1 = __importDefault(require("./refiners/ITUnlikelyFormatFilter"));
class ITDefaultConfiguration {
    createCasualConfiguration() {
        const option = this.createConfiguration(false);
        option.parsers.push(new ITCasualDateParser_1.default());
        option.parsers.push(new ITCasualTimeParser_1.default());
        option.parsers.push(new ITMonthNameParser_1.default());
        option.parsers.push(new ITRelativeDateFormatParser_1.default());
        option.parsers.push(new ITTimeUnitCasualRelativeFormatParser_1.default());
        option.refiners.push(new ITUnlikelyFormatFilter_1.default());
        return option;
    }
    createConfiguration(strictMode = true) {
        const options = (0, configurations_1.includeCommonConfiguration)({
            parsers: [
                new SlashDateFormatParser_1.default(true),
                new ITTimeUnitWithinFormatParser_1.default(strictMode),
                new ITMonthNameLittleEndianParser_1.default(),
                new ITMonthNameMiddleEndianParser_1.default(true),
                new ITWeekdayParser_1.default(),
                new ITSlashMonthFormatParser_1.default(),
                new ITTimeExpressionParser_1.default(strictMode),
                new ITTimeUnitAgoFormatParser_1.default(strictMode),
                new ITTimeUnitLaterFormatParser_1.default(strictMode),
            ],
            refiners: [new ITMergeDateTimeRefiner_1.default()],
        }, strictMode);
        options.parsers.unshift(new ITYearMonthDayParser_1.default(strictMode));
        options.refiners.unshift(new ITMergeRelativeFollowByDateRefiner_1.default());
        options.refiners.unshift(new ITMergeRelativeAfterDateRefiner_1.default());
        options.refiners.unshift(new OverlapRemovalRefiner_1.default());
        options.refiners.push(new ITMergeDateTimeRefiner_1.default());
        options.refiners.push(new ITExtractYearSuffixRefiner_1.default());
        options.refiners.push(new ITMergeDateRangeRefiner_1.default());
        return options;
    }
}
exports.default = ITDefaultConfiguration;
//# sourceMappingURL=configuration.js.map