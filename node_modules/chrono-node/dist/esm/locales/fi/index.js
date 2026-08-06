import { includeCommonConfiguration } from "../../configurations.js";
import { Chrono } from "../../chrono.js";
import { ParsingResult, ParsingComponents, ReferenceWithTimezone } from "../../results.js";
import { Meridiem, Weekday } from "../../types.js";
import SlashDateFormatParser from "../../common/parsers/SlashDateFormatParser.js";
import ISOFormatParser from "../../common/parsers/ISOFormatParser.js";
import FITimeExpressionParser from "./parsers/FITimeExpressionParser.js";
import FIWeekdayParser from "./parsers/FIWeekdayParser.js";
import FIMonthNameLittleEndianParser from "./parsers/FIMonthNameLittleEndianParser.js";
import FITimeUnitCasualRelativeFormatParser from "./parsers/FITimeUnitCasualRelativeFormatParser.js";
import FITimeUnitAgoFormatParser from "./parsers/FITimeUnitAgoFormatParser.js";
import FITimeUnitWithinFormatParser from "./parsers/FITimeUnitWithinFormatParser.js";
import FICasualDateParser from "./parsers/FICasualDateParser.js";
import FICasualTimeParser from "./parsers/FICasualTimeParser.js";
import FIMergeDateRangeRefiner from "./refiners/FIMergeDateRangeRefiner.js";
import FIMergeDateTimeRefiner from "./refiners/FIMergeDateTimeRefiner.js";
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
    option.parsers.unshift(new FICasualTimeParser());
    option.parsers.unshift(new FICasualDateParser());
    option.parsers.unshift(new FITimeUnitCasualRelativeFormatParser());
    return option;
}
export function createConfiguration(strictMode = true, littleEndian = true) {
    return includeCommonConfiguration({
        parsers: [
            new ISOFormatParser(),
            new SlashDateFormatParser(littleEndian),
            new FITimeExpressionParser(),
            new FIMonthNameLittleEndianParser(),
            new FIWeekdayParser(),
            new FITimeUnitWithinFormatParser(),
            new FITimeUnitAgoFormatParser(),
        ],
        refiners: [new FIMergeDateRangeRefiner(), new FIMergeDateTimeRefiner()],
    }, strictMode);
}
//# sourceMappingURL=index.js.map