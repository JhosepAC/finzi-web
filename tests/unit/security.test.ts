import {describe,expect,it} from "vitest";
import {reauthSchema,changePasswordSchema,passwordProofTime} from "../../src/modules/identity/domain/security";
describe("contratos de seguridad",()=>{
 it("contraseña actual no se recorta ni acepta dueño/correo del cliente",()=>{expect(reauthSchema.parse({password:" clave con espacios "}).password).toBe(" clave con espacios ");expect(reauthSchema.safeParse({password:"abc",email:"otro@example.test"}).success).toBe(false);});
 it.each(["", "x".repeat(129)])("rechaza contraseña actual inválida",password=>expect(reauthSchema.safeParse({password}).success).toBe(false));
 it.each([{password:"corta",confirmPassword:"corta"},{password:"una frase nueva para acceso 42",confirmPassword:"otra"},{password:"una frase nueva para acceso 42",confirmPassword:"una frase nueva para acceso 42",reauthenticated:true}])("rechaza cambio inválido %j",input=>expect(changePasswordSchema.safeParse(input).success).toBe(false));
 it("contraseña confirmada válida, AMR de presentación solo password",()=>{expect(changePasswordSchema.safeParse({password:"una frase nueva para acceso 42",confirmPassword:"una frase nueva para acceso 42"}).success).toBe(true);expect(passwordProofTime({amr:[{method:"otp",timestamp:100}]})).toBeNull();expect(passwordProofTime({amr:[{method:"password",timestamp:100},{method:"password",timestamp:200}]})).toBe(new Date(200000).toISOString());expect(passwordProofTime({amr:[]})).toBeNull();});
});
