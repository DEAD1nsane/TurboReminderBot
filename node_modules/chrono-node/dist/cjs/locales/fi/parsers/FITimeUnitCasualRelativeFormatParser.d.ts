import { ParsingContext } from "../../../chrono";
import { ParsingComponents } from "../../../results";
import { AbstractParserWithWordBoundaryChecking } from "../../../common/parsers/AbstractParserWithWordBoundary";
export default class FITimeUnitCasualRelativeFormatParser extends AbstractParserWithWordBoundaryChecking {
    private allowAbbreviations;
    constructor(allowAbbreviations?: boolean);
    innerPattern(): RegExp;
    innerExtract(context: ParsingContext, match: RegExpMatchArray): ParsingComponents;
}
