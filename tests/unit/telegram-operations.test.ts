import {describe,it,expect} from "vitest";
import {recoveryOptions,recoverySql} from "../../scripts/telegram-recovery";
describe("Telegram recovery command guards",()=>{
 it("defaults to counts and requires paired explicit confirmation",()=>{expect(recoveryOptions([])).toEqual({apply:false,user:undefined});expect(recoverySql(false)).not.toMatch(/update|delete|alter role/i);expect(()=>recoveryOptions(["--apply"])).toThrow();expect(()=>recoveryOptions(["--confirm=INVALIDATE_TELEGRAM_LINKS"])).toThrow();expect(recoveryOptions(["--apply","--confirm=INVALIDATE_TELEGRAM_LINKS"]).apply).toBe(true);});
 it("rejects unknown options and unsafe user identifiers",()=>{expect(()=>recoveryOptions(["--force"])).toThrow();expect(()=>recoveryOptions(["--synthetic-user=x';delete from finance.transactions;"])).toThrow();expect(()=>recoveryOptions(["--synthetic-user="])).toThrow();});
});
