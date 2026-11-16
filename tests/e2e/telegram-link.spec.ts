import {test,expect} from "@playwright/test";
import {randomBytes,createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {financialSession,localOrigin} from "../helpers/financial";
const hash=(v:string)=>createHash("sha256").update(v).digest("hex");
function sql(query:string,role="supabase_admin"){return execFileSync("docker",["exec","-i","supabase_db_finzi-auth","psql","-h","127.0.0.1","-U",role,"-d","postgres","-Atq","-v","ON_ERROR_STOP=1"],{input:query,encoding:"utf8",stdio:"pipe"}).trim();}
test("Telegram: web authorization, explicit approval, revocation and responsive themes",async({page,context})=>{
 test.setTimeout(90000);
 expect((await context.request.get("/api/v1/integrations/telegram")).status()).toBe(401);
 await financialSession(page,context,false);const profile=(await (await context.request.get("/api/v1/profile")).json()).profile;
 expect(profile.user_id).toMatch(/^[a-f0-9-]{36}$/);
 expect((await context.request.post("/api/v1/integrations/telegram",{headers:{Origin:"https://invalid.example"},data:{action:"create"}})).status()).toBe(403);
 expect((await context.request.post("/api/v1/integrations/telegram",{headers:{Origin:localOrigin},data:{action:"activate",attemptId:crypto.randomUUID()}})).status()).toBe(403);
 // Only bot availability/creation is fixture-backed: no real bot exists yet.
 // Claim, approval, cookie auth, status and revocation use the actual SQL and HTTP boundaries.
 let challenge="";
 await page.route("**/api/v1/integrations/telegram",async route=>{
  if(route.request().method()==="GET"){const response=await route.fetch();const body=await response.json();await route.fulfill({response,json:{...body,username:"finzi_fixture_bot"}});return;}
  const body=route.request().postDataJSON();
  if(body.action==="create"){challenge=randomBytes(32).toString("hex");const result=JSON.parse(sql(`begin;set local role app_executor;set local request.jwt.claims='{"sub":"${profile.user_id}"}';select api.telegram_issue_link('${hash(challenge)}');commit;`));await route.fulfill({json:{ok:true,challenge,expiresAt:result.expires_at}});return;}
  await route.continue();
 });
 await page.goto("/profile");const panel=page.getByRole("region",{name:"Telegram",exact:true});
 await panel.getByRole("button",{name:"Generar enlace de Telegram",exact:true}).click();
 await expect(panel.getByRole("link",{name:"Abrir Telegram"})).toHaveAttribute("href",`https://t.me/finzi_fixture_bot?start=${challenge}`);
 const capability=randomBytes(32).toString("hex"),user="87001"+Math.floor(Math.random()*1000000);
 sql(`select telegram_private.claim_link('${challenge}','9001','${user}','${user}','${hash(capability)}');`,"finzi_telegram_gateway");
 await panel.getByRole("button",{name:"Actualizar conexión"}).click();
 await expect(panel.getByRole("button",{name:"Confirmar vinculación"})).toBeDisabled();
 await panel.getByRole("checkbox").check();await panel.getByRole("button",{name:"Confirmar vinculación"}).click();
 await expect(panel.getByRole("button",{name:"Desvincular Telegram"})).toBeVisible();
 await expect(panel).toContainText(user);
 await page.getByRole("button",{name:"Cerrar notificación"}).click();
 for(const theme of ["light","dark"]){await page.getByLabel("Tema de la interfaz").selectOption(theme);await page.setViewportSize({width:1440,height:1100});await page.mouse.move(0,0);await expect(panel).toHaveCSS("background-color",theme==="dark"?"rgb(23, 23, 23)":"rgb(255, 255, 255)");await panel.screenshot({path:`.impeccable/review/telegram-${theme}.png`});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await panel.screenshot({path:`.impeccable/review/telegram-${theme}-mobile.png`});}
 await panel.getByRole("button",{name:"Desvincular Telegram"}).click();
 await expect(panel.getByRole("button",{name:"Generar enlace de Telegram",exact:true})).toBeVisible();
 expect(sql(`select telegram_private.link_context('${capability}','9001','${user}','${user}') is null;`,"finzi_telegram_gateway")).toBe("t");
});
