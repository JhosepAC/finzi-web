import {describe,expect,it} from "vitest";
import {csvCell,deletionSchema,exportSchema,receiptSchema} from "../../src/modules/identity/domain/portability";
const receipt={requestId:crypto.randomUUID(),trackingToken:"a".repeat(64)};
describe("portabilidad privada",()=>{
 it.each(["=1+1","+1+1","-1+1","@SUM(1)"," \t=1+1","\uFEFF=1+1","＝1+1","\rtexto"])("neutraliza texto de fórmula %j",text=>expect(csvCell(text)).toBe(`"'${text}"`));
 it("escapa comillas, delimitadores y saltos sin convertir dinero en fórmulas",()=>{expect(csvCell('Nota, "propia"\r\nsegunda')).toBe('"Nota, ""propia""\r\nsegunda"');expect(csvCell("-100.00",true)).toBe('"-100.00"');});
 it("JSON completo no acepta filtros ni dueño; CSV exige moneda",()=>{expect(exportSchema.safeParse({format:"json"}).success).toBe(true);expect(exportSchema.safeParse({format:"json",currency:"PEN"}).success).toBe(false);expect(exportSchema.safeParse({format:"csv"}).success).toBe(false);expect(exportSchema.safeParse({format:"csv",currency:"PEN",user_id:crypto.randomUUID()}).success).toBe(false);});
 it("filtros validan calendario y orden",()=>{expect(exportSchema.safeParse({format:"csv",currency:"PEN",from:"2026-02-30"}).success).toBe(false);expect(exportSchema.safeParse({format:"csv",currency:"USD",from:"2026-05-02",to:"2026-05-01"}).success).toBe(false);});
 it("eliminación exige texto, aceptación y comprobante con formato exacto",()=>{expect(deletionSchema.safeParse({...receipt,confirmation:"ELIMINAR",acknowledged:true}).success).toBe(true);for(const input of [{...receipt,confirmation:"eliminar",acknowledged:true},{...receipt,confirmation:"ELIMINAR",acknowledged:false},{...receipt,confirmation:"ELIMINAR",acknowledged:true,user_id:crypto.randomUUID()}])expect(deletionSchema.safeParse(input).success).toBe(false);expect(receiptSchema.safeParse({...receipt,trackingToken:"x"}).success).toBe(false);});
});
