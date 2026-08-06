import AbstractMergeDateTimeRefiner from "../../../common/refiners/AbstractMergeDateTimeRefiner.js";
export default class ITMergeDateTimeRefiner extends AbstractMergeDateTimeRefiner {
    patternBetween() {
        return new RegExp("^\\s*(T|alle?|dopo\\s*le|prima\\s*delle?|,|-|\\.|∙|:)?\\s*$");
    }
}
//# sourceMappingURL=ITMergeDateTimeRefiner.js.map