import { Filter } from "../../../common/abstractRefiners.js";
import { ParsingResult } from "../../../results.js";
export default class ITUnlikelyFormatFilter extends Filter {
    constructor();
    isValid(context: any, result: ParsingResult): boolean;
}
