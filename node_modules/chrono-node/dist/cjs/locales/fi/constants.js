"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TIME_UNITS_NO_ABBR_PATTERN = exports.TIME_UNITS_PATTERN = exports.TIME_UNIT_PATTERN = exports.NUMBER_PATTERN = exports.TIME_UNIT_NO_ABBR_DICTIONARY = exports.TIME_UNIT_DICTIONARY = exports.INTEGER_WORD_DICTIONARY = exports.MONTH_DICTIONARY = exports.WEEKDAY_DICTIONARY = void 0;
exports.parseDuration = parseDuration;
exports.parseNumberPattern = parseNumberPattern;
exports.parseYear = parseYear;
const pattern_1 = require("../../utils/pattern");
const years_1 = require("../../calculation/years");
exports.WEEKDAY_DICTIONARY = {
    "sunnuntai": 0,
    "sunnuntaina": 0,
    "su": 0,
    "maanantai": 1,
    "maanantaina": 1,
    "ma": 1,
    "tiistai": 2,
    "tiistaina": 2,
    "ti": 2,
    "keskiviikko": 3,
    "keskiviikkona": 3,
    "ke": 3,
    "torstai": 4,
    "torstaina": 4,
    "to": 4,
    "perjantai": 5,
    "perjantaina": 5,
    "pe": 5,
    "lauantai": 6,
    "lauantaina": 6,
    "la": 6,
};
exports.MONTH_DICTIONARY = {
    "tammikuu": 1,
    "tammikuuta": 1,
    "tammikuun": 1,
    "tammi": 1,
    "helmikuu": 2,
    "helmikuuta": 2,
    "helmikuun": 2,
    "helmi": 2,
    "maaliskuu": 3,
    "maaliskuuta": 3,
    "maaliskuun": 3,
    "maalis": 3,
    "huhtikuu": 4,
    "huhtikuuta": 4,
    "huhtikuun": 4,
    "huhti": 4,
    "toukokuu": 5,
    "toukokuuta": 5,
    "toukokuun": 5,
    "touko": 5,
    "kesäkuu": 6,
    "kesäkuuta": 6,
    "kesäkuun": 6,
    "kesä": 6,
    "heinäkuu": 7,
    "heinäkuuta": 7,
    "heinäkuun": 7,
    "heinä": 7,
    "elokuu": 8,
    "elokuuta": 8,
    "elokuun": 8,
    "elo": 8,
    "syyskuu": 9,
    "syyskuuta": 9,
    "syyskuun": 9,
    "syys": 9,
    "lokakuu": 10,
    "lokakuuta": 10,
    "lokakuun": 10,
    "loka": 10,
    "marraskuu": 11,
    "marraskuuta": 11,
    "marraskuun": 11,
    "marras": 11,
    "joulukuu": 12,
    "joulukuuta": 12,
    "joulukuun": 12,
    "joulu": 12,
};
exports.INTEGER_WORD_DICTIONARY = {
    "yksi": 1,
    "yhden": 1,
    "kaksi": 2,
    "kahden": 2,
    "kolme": 3,
    "kolmen": 3,
    "neljä": 4,
    "neljän": 4,
    "viisi": 5,
    "viiden": 5,
    "kuusi": 6,
    "kuuden": 6,
    "seitsemän": 7,
    "kahdeksan": 8,
    "yhdeksän": 9,
    "kymmenen": 10,
};
exports.TIME_UNIT_DICTIONARY = {
    "s": "second",
    "sek": "second",
    "sekunti": "second",
    "sekuntia": "second",
    "sekunnin": "second",
    "min": "minute",
    "minuutti": "minute",
    "minuuttia": "minute",
    "minuutin": "minute",
    "t": "hour",
    "tunti": "hour",
    "tuntia": "hour",
    "tunnin": "hour",
    "pv": "day",
    "päivä": "day",
    "päivää": "day",
    "päivän": "day",
    "vk": "week",
    "viikko": "week",
    "viikkoa": "week",
    "viikon": "week",
    "kk": "month",
    "kuukausi": "month",
    "kuukautta": "month",
    "kuukauden": "month",
    "vuosi": "year",
    "vuotta": "year",
    "vuoden": "year",
};
exports.TIME_UNIT_NO_ABBR_DICTIONARY = {
    "sekunti": "second",
    "sekuntia": "second",
    "sekunnin": "second",
    "minuutti": "minute",
    "minuuttia": "minute",
    "minuutin": "minute",
    "tunti": "hour",
    "tuntia": "hour",
    "tunnin": "hour",
    "päivä": "day",
    "päivää": "day",
    "päivän": "day",
    "viikko": "week",
    "viikkoa": "week",
    "viikon": "week",
    "kuukausi": "month",
    "kuukautta": "month",
    "kuukauden": "month",
    "vuosi": "year",
    "vuotta": "year",
    "vuoden": "year",
};
function parseDuration(timeunitText) {
    const fragments = {};
    let remainingText = timeunitText;
    let match = SINGLE_TIME_UNIT_REGEX.exec(remainingText);
    while (match) {
        collectDateTimeFragment(fragments, match);
        remainingText = remainingText.substring(match[0].length);
        match = SINGLE_TIME_UNIT_REGEX.exec(remainingText);
    }
    return fragments;
}
function collectDateTimeFragment(fragments, match) {
    const num = parseNumberPattern(match[1]);
    const unit = exports.TIME_UNIT_DICTIONARY[match[2].toLowerCase()];
    fragments[unit] = num;
}
exports.NUMBER_PATTERN = `(?:${(0, pattern_1.matchAnyPattern)(exports.INTEGER_WORD_DICTIONARY)}|\\d+)`;
exports.TIME_UNIT_PATTERN = `(?:${(0, pattern_1.matchAnyPattern)(exports.TIME_UNIT_DICTIONARY)})`;
const SINGLE_TIME_UNIT_PATTERN = `(${exports.NUMBER_PATTERN})\\s{0,5}(${(0, pattern_1.matchAnyPattern)(exports.TIME_UNIT_DICTIONARY)})\\s{0,5}`;
const SINGLE_TIME_UNIT_REGEX = new RegExp(SINGLE_TIME_UNIT_PATTERN, "i");
const SINGLE_TIME_UNIT_NO_ABBR_PATTERN = `(${exports.NUMBER_PATTERN})\\s{0,5}(${(0, pattern_1.matchAnyPattern)(exports.TIME_UNIT_NO_ABBR_DICTIONARY)})\\s{0,5}`;
exports.TIME_UNITS_PATTERN = (0, pattern_1.repeatedTimeunitPattern)("", SINGLE_TIME_UNIT_PATTERN);
exports.TIME_UNITS_NO_ABBR_PATTERN = (0, pattern_1.repeatedTimeunitPattern)("", SINGLE_TIME_UNIT_NO_ABBR_PATTERN);
function parseNumberPattern(match) {
    const num = match.toLowerCase();
    if (exports.INTEGER_WORD_DICTIONARY[num] !== undefined) {
        return exports.INTEGER_WORD_DICTIONARY[num];
    }
    return parseInt(num);
}
function parseYear(match) {
    if (/\d+/.test(match)) {
        let yearNumber = parseInt(match);
        if (yearNumber < 100) {
            yearNumber = (0, years_1.findMostLikelyADYear)(yearNumber);
        }
        return yearNumber;
    }
    const num = match.toLowerCase();
    if (exports.INTEGER_WORD_DICTIONARY[num] !== undefined) {
        return exports.INTEGER_WORD_DICTIONARY[num];
    }
    return parseInt(match);
}
//# sourceMappingURL=constants.js.map