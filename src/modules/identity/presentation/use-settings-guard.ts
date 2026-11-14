"use client";
import { useEffect } from "react";
export function useSettingsGuard(dirty:boolean,pending:boolean,setGuard:(guard:()=>boolean)=>void) {
 useEffect(()=>{setGuard(()=>pending?false:!dirty||window.confirm("Tienes cambios sin guardar. ¿Quieres descartarlos y salir?"));const unload=(e:BeforeUnloadEvent)=>{if(dirty||pending)e.preventDefault();};window.addEventListener("beforeunload",unload);return()=>{setGuard(()=>true);window.removeEventListener("beforeunload",unload);};},[dirty,pending,setGuard]);
}
