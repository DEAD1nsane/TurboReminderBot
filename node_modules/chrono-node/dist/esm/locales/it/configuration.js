import ITTimeUnitWithinFormatParser from "./parsers/ITTimeUnitWithinFormatParser.js";
import ITMonthNameLittleEndianParser from "./parsers/ITMonthNameLittleEndianParser.js";
import ITMonthNameMiddleEndianParser from "./parsers/ITMonthNameMiddleEndianParser.js";
import ITMonthNameParser from "./parsers/ITMonthNameParser.js";
import ITYearMonthDayParser from "./parsers/ITYearMonthDayParser.js";
import ITSlashMonthFormatParser from "./parsers/ITSlashMonthFormatParser.js";
import ITTimeExpressionParser from "./parsers/ITTimeExpressionParser.js";
import ITTimeUnitAgoFormatParser from "./parsers/ITTimeUnitAgoFormatParser.js";
import ITTimeUnitLaterFormatParser from "./parsers/ITTimeUnitLaterFormatParser.js";
import ITMergeDateRangeRefiner from "./refiners/ITMergeDateRangeRefiner.js";
import ITMergeDateTimeRefiner from "./refiners/ITMergeDateTimeRefiner.js";
import { includeCommonConfiguration } from "../../configurations.js";
import ITCasualDateParser from "./parsers/ITCasualDateParser.js";
import ITCasualTimeParser from "./parsers/ITCasualTimeParser.js";
import ITWeekdayParser from "./parsers/ITWeekdayParser.js";
import ITRelativeDateFormatParser from "./parsers/ITRelativeDateFormatParser.js";
import SlashDateFormatParser from "../../common/parsers/SlashDateFormatParser.js";
import ITTimeUnitCasualRelativeFormatParser from "./parsers/ITTimeUnitCasualRelativeFormatParser.js";
import ITMergeRelativeAfterDateRefiner from "./refiners/ITMergeRelativeAfterDateRefiner.js";
import ITMergeRelativeFollowByDateRefiner from "./refiners/ITMergeRelativeFollowByDateRefiner.js";
import OverlapRemovalRefiner from "../../common/refiners/OverlapRemovalRefiner.js";
import ITExtractYearSuffixRefiner from "./refiners/ITExtractYearSuffixRefiner.js";
import ITUnlikelyFormatFilter from "./refiners/ITUnlikelyFormatFilter.js";
export default class ITDefaultConfiguration {
    createCasualConfiguration() {
        const option = this.createConfiguration(false);
        option.parsers.push(new ITCasualDateParser());
        option.parsers.push(new ITCasualTimeParser());
        option.parsers.push(new ITMonthNameParser());
        option.parsers.push(new ITRelativeDateFormatParser());
        option.parsers.push(new ITTimeUnitCasualRelativeFormatParser());
        option.refiners.push(new ITUnlikelyFormatFilter());
        return option;
    }
    createConfiguration(strictMode = true) {
        const options = includeCommonConfiguration({
            parsers: [
                new SlashDateFormatParser(true),
                new ITTimeUnitWithinFormatParser(strictMode),
                new ITMonthNameLittleEndianParser(),
                new ITMonthNameMiddleEndianParser(true),
                new ITWeekdayParser(),
                new ITSlashMonthFormatParser(),
                new ITTimeExpressionParser(strictMode),
                new ITTimeUnitAgoFormatParser(strictMode),
                new ITTimeUnitLaterFormatParser(strictMode),
            ],
            refiners: [new ITMergeDateTimeRefiner()],
        }, strictMode);
        options.parsers.unshift(new ITYearMonthDayParser(strictMode));
        options.refiners.unshift(new ITMergeRelativeFollowByDateRefiner());
        options.refiners.unshift(new ITMergeRelativeAfterDateRefiner());
        options.refiners.unshift(new OverlapRemovalRefiner());
        options.refiners.push(new ITMergeDateTimeRefiner());
        options.refiners.push(new ITExtractYearSuffixRefiner());
        options.refiners.push(new ITMergeDateRangeRefiner());
        return options;
    }
}
//# sourceMappingURL=configuration.js.map