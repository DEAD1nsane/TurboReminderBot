import { Chrono } from "../../chrono.js";
import { ParsingResult, ParsingComponents, ReferenceWithTimezone } from "../../results.js";
import { Meridiem, Weekday } from "../../types.js";
import ITDefaultConfiguration from "./configuration.js";
export { Chrono, ParsingResult, ParsingComponents, ReferenceWithTimezone };
export { Meridiem, Weekday };
export const configuration = new ITDefaultConfiguration();
export const casual = new Chrono(configuration.createCasualConfiguration());
export const strict = new Chrono(configuration.createConfiguration(true));
export function parse(text, ref, option) {
    return casual.parse(text, ref, option);
}
export function parseDate(text, ref, option) {
    return casual.parseDate(text, ref, option);
}
//# sourceMappingURL=index.js.map