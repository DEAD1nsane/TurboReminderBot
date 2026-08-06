import { includeCommonConfiguration } from "../../configurations.js";
import { Chrono } from "../../chrono.js";
import { ParsingResult, ParsingComponents, ReferenceWithTimezone } from "../../results.js";
import { Meridiem, Weekday } from "../../types.js";
import ISOFormatParser from "../../common/parsers/ISOFormatParser.js";
import SlashDateFormatParser from "../../common/parsers/SlashDateFormatParser.js";
import VIStandardParser from "./parsers/VIStandardParser.js";
import VIMonthYearParser from "./parsers/VIMonthYearParser.js";
import VIYearParser from "./parsers/VIYearParser.js";
import VICasualDateParser from "./parsers/VICasualDateParser.js";
import VICasualTimeParser from "./parsers/VICasualTimeParser.js";
import VIWeekdayParser from "./parsers/VIWeekdayParser.js";
import VITimeExpressionParser from "./parsers/VITimeExpressionParser.js";
import VITimeUnitAgoFormatParser from "./parsers/VITimeUnitAgoFormatParser.js";
import VITimeUnitLaterFormatParser from "./parsers/VITimeUnitLaterFormatParser.js";
import VITimeUnitWithinFormatParser from "./parsers/VITimeUnitWithinFormatParser.js";
import VITimeUnitCasualRelativeFormatParser from "./parsers/VITimeUnitCasualRelativeFormatParser.js";
import VIMergeDateRangeRefiner from "./refiners/VIMergeDateRangeRefiner.js";
import VIMergeDateTimeRefiner from "./refiners/VIMergeDateTimeRefiner.js";
import VIMergeWeekdayComponentRefiner from "./refiners/VIMergeWeekdayComponentRefiner.js";
export { Chrono, ParsingResult, ParsingComponents, ReferenceWithTimezone };
export { Meridiem, Weekday };
export const casual = new Chrono(createCasualConfiguration());
export const strict = new Chrono(createConfiguration(true));
export function parse(text, ref, option) {
    return casual.parse(text, ref, option);
}
export function parseDate(text, ref, option) {
    return casual.parseDate(text, ref, option);
}
export function createCasualConfiguration(littleEndian = true) {
    const option = createConfiguration(false, littleEndian);
    option.parsers.unshift(new VICasualTimeParser());
    option.parsers.unshift(new VICasualDateParser());
    option.parsers.unshift(new VITimeUnitCasualRelativeFormatParser());
    return option;
}
export function createConfiguration(strictMode = true, littleEndian = true) {
    return includeCommonConfiguration({
        parsers: [
            new ISOFormatParser(),
            new SlashDateFormatParser(littleEndian),
            new VIStandardParser(),
            new VIMonthYearParser(),
            new VIYearParser(),
            new VIWeekdayParser(),
            new VITimeExpressionParser(),
            new VITimeUnitAgoFormatParser(strictMode),
            new VITimeUnitLaterFormatParser(strictMode),
            new VITimeUnitWithinFormatParser(strictMode),
        ],
        refiners: [
            new VIMergeWeekdayComponentRefiner(),
            new VIMergeDateRangeRefiner(),
            new VIMergeDateTimeRefiner(),
        ],
    }, strictMode);
}
//# sourceMappingURL=index.js.map