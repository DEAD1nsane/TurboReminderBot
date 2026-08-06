import AbstractMergeDateTimeRefiner from "../../../common/refiners/AbstractMergeDateTimeRefiner.js";
export default class VIMergeDateTimeRefiner extends AbstractMergeDateTimeRefiner {
    patternBetween() {
        return /^\s*(?:lúc|vào|,|T|-)?\s*$/;
    }
}
//# sourceMappingURL=VIMergeDateTimeRefiner.js.map