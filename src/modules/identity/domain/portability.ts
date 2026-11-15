import { z } from "zod";
import { calendarDate } from "@/modules/reporting/domain/overview";
import { movementSchema } from "@/modules/transactions/domain/movement";
import { decimalMoney } from "@/shared/money";
import { localDateTime } from "@/shared/time";
export const dataPurposeSchema=z.enum(["export_data","delete_account"]);
export const dataReauthSchema=z.object({password:z.string().min(1,"Escribe tu contraseña actual.").max(128),purpose:dataPurposeSchema}).strict();
export const exportSchema=z.discriminatedUnion("format",[
 z.object({format:z.literal("json")}).strict(),
 z.object({format:z.literal("csv"),currency:z.enum(["PEN","USD"]),kind:z.enum(["income","expense","transfer"]).optional(),accountId:z.uuid().optional(),categoryId:z.uuid().optional(),from:calendarDate.optional(),to:calendarDate.optional(),query:z.string().trim().max(200).default(""),status:z.enum(["all","posted","void","replaced"]).default("all")}).strict().refine(d=>!d.from||!d.to||d.from<=d.to,{path:["to"],message:"Revisa el intervalo de fechas."}),
]);
export const receiptSchema=z.object({requestId:z.uuid(),trackingToken:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const deletionSchema=receiptSchema.extend({confirmation:z.literal("ELIMINAR",{error:"Escribe ELIMINAR para confirmar."}),acknowledged:z.literal(true,{error:"Confirma que guardaste el comprobante y entiendes la eliminación."})}).strict();
export const csvSnapshotSchema=z.object({format_version:z.literal("finzi.movements/v1"),exported_at:z.string(),timezone:z.string(),currency:z.enum(["PEN","USD"]),movements:z.array(movementSchema).max(10000)});
export type CsvSnapshot=z.infer<typeof csvSnapshotSchema>;
// Quote every cell, neutralize spreadsheet formulas only in untrusted textual cells.
export function csvCell(value:string,trustedNumeric=false){const risky=/^[\s\p{Cc}\p{Cf}]*[=+\-@＝＋－＠]/u.test(value)||/^[\t\r\n]/.test(value);const text=!trustedNumeric&&risky?`'${value}`:value;return `"${text.replaceAll('"','""')}"`;}
export function* csvLines(snapshot:CsvSnapshot):Generator<string>{
 yield '\uFEFF'+['id','tipo','estado','reemplaza_id','reemplazado_por_id','cuenta_origen','cuenta_destino','categoria','descripcion','nota','importe','moneda','ocurrio_utc','fecha_local','zona_horaria','motivo_anulacion','motivo_reemplazo'].map(v=>csvCell(v)).join(',')+'\r\n';
 for(const m of snapshot.movements){const cells=[m.id,m.kind,m.replaced_by_id?'replaced':m.status,m.replaces_id??'',m.replaced_by_id??'',m.account_name,m.destination_name??'',m.parent_name?`${m.parent_name} / ${m.category_name}`:m.category_name??'',m.description,m.note,decimalMoney(BigInt(m.amount_minor)),m.currency_code,m.occurred_at,localDateTime(m.occurred_at,snapshot.timezone),snapshot.timezone,m.void_reason??'',m.replacement_reason??''];yield cells.map((v,i)=>csvCell(v,i===10)).join(',')+'\r\n';}
}
