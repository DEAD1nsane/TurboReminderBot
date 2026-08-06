import AbstractMergeDateTimeRefiner from "../../../common/refiners/AbstractMergeDateTimeRefiner.js";
export default class FIMergeDateTimeRefiner extends AbstractMergeDateTimeRefiner {
    patternBetween() {
        return new RegExp("^\\s*(T|klo|kello|,|-)?\\s*$");
    }
}
//# sourceMappingURL=FIMergeDateTimeRefiner.js.map