import { describe, expect, it } from "vitest";
import { distance } from "./places.js";
describe("Find Care distance",()=>{
  it("returns zero for the same point",()=>expect(distance(7.2526,5.1931,7.2526,5.1931)).toBe(0));
  it("calculates a stable straight-line distance",()=>expect(Math.round(distance(6.5244,3.3792,6.6018,3.3515)/1000)).toBe(9));
});
