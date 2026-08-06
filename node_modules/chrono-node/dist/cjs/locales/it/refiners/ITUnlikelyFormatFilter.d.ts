import { Filter } from "../../../common/abstractRefiners";
import { ParsingResult } from "../../../results";
export default class ITUnlikelyFormatFilter extends Filter {
    constructor();
    isValid(context: any, result: ParsingResult): boolean;
}
