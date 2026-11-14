import { describe, expect, it } from "vitest";
import { overviewQuerySchema,comparison,shareTenths } from "../../src/modules/reporting/domain/overview";
import { periodRange,shiftDay,todayInZone } from "../../src/shared/period";
describe("períodos y reporting exacto",() => {
 it.each([["day","2026-11-14","2026-11-14","2026-11-14"],["week","2026-11-15","2026-11-09","2026-11-15"],["month","2028-02-15","2028-02-01","2028-02-29"],["quarter","2026-11-14","2026-10-01","2026-12-31"],["year","2026-11-14","2026-01-01","2026-12-31"]] as const)("%s por calendario",(period,anchor,from,to) => { expect(periodRange(period,anchor)).toEqual({from,to}); });
 it("día local y desplazamiento de calendario independiente de DST",() => { expect(todayInZone("2026-11-14T02:00:00Z","America/Lima")).toBe("2026-11-13"); expect(shiftDay("2026-03-08",1)).toBe("2026-03-09"); expect(shiftDay("2028-03-01",-1)).toBe("2028-02-29"); });
 it.each([{currency:"EUR"},{period:"all"},{period:"custom",from:"2026-02-30",to:"2026-03-01"},{period:"custom",from:"2026-05-02",to:"2026-05-01"},{period:"month",from:"2026-05-01"},{period:"custom",from:"2000-01-01",to:"2026-01-01"},{user_id:crypto.randomUUID()}])("rechaza consulta %j",(input) => { expect(overviewQuerySchema.safeParse(input).success).toBe(false); });
 it("cero no tiene base y números grandes no se redondean para calcular diferencias",() => { expect(comparison(1n,0n)).toEqual({difference:1n,percent:null}); expect(comparison(30n,20n)).toEqual({difference:10n,percent:"+50,0%"}); expect(comparison(-10n,-20n)).toEqual({difference:10n,percent:"+50,0%"}); expect(comparison(999999999999999999n,999999999999999998n).difference).toBe(1n); expect(shareTenths(1n,3n)).toBe(333); });
});
