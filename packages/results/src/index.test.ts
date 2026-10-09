import { describe, expect, it } from "vitest";
import { evaluateResult } from "./index.js";
describe("deterministic result evaluation", () => {
  it("includes exact inclusive boundaries", () => expect(evaluateResult({confirmed:true,numericValue:13,unit:"g/dL",lower:13,upper:17,lowerInclusive:true,upperInclusive:true,laboratoryFlag:"normal"}).status).toBe("green"));
  it("supports one-sided intervals", () => expect(evaluateResult({confirmed:true,numericValue:8,unit:"mg/L",upper:5,laboratoryFlag:"normal"}).status).toBe("amber"));
  it("keeps missing units grey", () => expect(evaluateResult({confirmed:true,numericValue:8,lower:5,upper:9}).status).toBe("grey"));
  it("never colours drafts", () => expect(evaluateResult({confirmed:false,numericValue:14,unit:"g/dL",lower:13,upper:17}).status).toBe("grey"));
  it("uses only an explicit lab critical flag for red", () => expect(evaluateResult({confirmed:true,laboratoryFlag:"critical"}).status).toBe("red"));
});
