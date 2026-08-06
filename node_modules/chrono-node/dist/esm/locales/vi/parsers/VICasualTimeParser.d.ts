import { ParsingContext } from "../../../chrono.js";
import { ParsingComponents, ParsingResult } from "../../../results.js";
import { AbstractParserWithWordBoundaryChecking } from "../../../common/parsers/AbstractParserWithWordBoundary.js";
export default class VICasualTimeParser extends AbstractParserWithWordBoundaryChecking {
    innerPattern(): RegExp;
    innerExtract(context: ParsingContext, match: RegExpMatchArray): ParsingComponents | ParsingResult;
    static extractTimeComponents(component: ParsingComponents, keyword: string): ParsingComponents;
}
