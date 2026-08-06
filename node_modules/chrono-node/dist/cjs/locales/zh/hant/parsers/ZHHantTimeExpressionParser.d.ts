import { ParsingContext } from "../../../../chrono";
import { AbstractParserWithWordBoundaryChecking } from "../../../../common/parsers/AbstractParserWithWordBoundary";
export default class ZHHantTimeExpressionParser extends AbstractParserWithWordBoundaryChecking {
    patternLeftBoundary(): string;
    innerPattern(): RegExp;
    innerExtract(context: ParsingContext, match: RegExpMatchArray): import("..").ParsingResult;
}
