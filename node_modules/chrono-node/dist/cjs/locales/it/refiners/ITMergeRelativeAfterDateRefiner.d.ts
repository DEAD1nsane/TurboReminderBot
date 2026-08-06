import { MergingRefiner } from "../../../common/abstractRefiners";
import { ParsingResult } from "../../../results";
export default class ITMergeRelativeAfterDateRefiner extends MergingRefiner {
    shouldMergeResults(textBetween: string, currentResult: ParsingResult, nextResult: ParsingResult): boolean;
    mergeResults(textBetween: string, currentResult: ParsingResult, nextResult: ParsingResult, context: any): ParsingResult;
}
