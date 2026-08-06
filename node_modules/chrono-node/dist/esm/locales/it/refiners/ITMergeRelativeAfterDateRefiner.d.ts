import { MergingRefiner } from "../../../common/abstractRefiners.js";
import { ParsingResult } from "../../../results.js";
export default class ITMergeRelativeAfterDateRefiner extends MergingRefiner {
    shouldMergeResults(textBetween: string, currentResult: ParsingResult, nextResult: ParsingResult): boolean;
    mergeResults(textBetween: string, currentResult: ParsingResult, nextResult: ParsingResult, context: any): ParsingResult;
}
