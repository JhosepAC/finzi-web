"use client";
import Link from "next/link";
import { useCallback,useRef,useState,type ReactNode } from "react";
import { ArrowLeft,Download,LayoutGrid,Menu,Settings2,ShieldCheck,X } from "lucide-react";
import { FinziMark } from "./auth-shell";
import type { AuthIdentity } from "../domain/auth";
import type { FinancialProfile } from "../domain/profile";
import { ProfileSettings } from "./profile-settings";
import { SecuritySettings } from "./security-settings";
import { DataSettings } from "./data-settings";
import "./settings.css";
export function SettingsShell({tab,user,profile,zones}:{tab:"profile"|"security"|"data";user:AuthIdentity;profile:FinancialProfile;zones:string[]}) {
 const [menuOpen,setMenuOpen]=useState(false);const menu=useRef<HTMLDialogElement>(null),guard=useRef<()=>boolean>(()=>true);
 const setGuard=useCallback((next:()=>boolean)=>{guard.current=next;},[]);
 const name=profile.display_name ?? "Mi cuenta",title=tab==="profile"?"Mi perfil":tab==="data"?"Mis datos":"Sesión y seguridad";
 const link=(href:string,children:ReactNode,current=false)=><Link href={href} aria-current={current?"page":undefined} onClick={(e)=>{if(!guard.current())e.preventDefault();else menu.current?.close();}}>{children}</Link>;
 const navigation=<nav className="home-nav" aria-label="Navegación personal">{link("/dashboard",<><LayoutGrid size={19} aria-hidden="true"/>Inicio</>)}{link("/profile",<><Settings2 size={19} aria-hidden="true"/>Mi perfil</>,tab==="profile")}{link("/security",<><ShieldCheck size={19} aria-hidden="true"/>Sesión y seguridad</>,tab==="security")}{link("/data",<><Download size={19} aria-hidden="true"/>Mis datos</>,tab==="data")}</nav>;
 return <div className="home-app settings-app"><a className="skip-link" href="#settings-main">Saltar al contenido</a><aside className="home-sidebar"><Link href="/dashboard" className="wordmark" onClick={(e)=>{if(!guard.current())e.preventDefault();}} aria-label="Finzi, inicio"><FinziMark/><span>finzi</span></Link>{navigation}</aside>
 <div className="home-body"><header className="home-topbar"><button className="home-icon-button mobile-nav-trigger" aria-label="Abrir navegación" aria-expanded={menuOpen} aria-controls="settings-navigation" onClick={()=>{menu.current?.showModal();setMenuOpen(true);}}><Menu size={21}/></button><h1 className="home-page-title">{title}</h1><span className="home-avatar" aria-hidden="true">{name.split(/\s+/).map(p=>Array.from(p)[0]??"").slice(0,2).join("").toUpperCase()}</span><span className="profile-name">{name}</span></header>
 <main className="home-main settings-main" id="settings-main"><div className="settings-back">{link("/dashboard",<><ArrowLeft size={16} aria-hidden="true"/>Volver a Inicio</>)}</div>{tab==="profile"?<ProfileSettings initial={profile} user={user} zones={zones} setGuard={setGuard}/>:tab==="data"?<DataSettings currency={profile.preferred_currency??"PEN"} setGuard={setGuard}/>:<SecuritySettings user={user} timezone={profile.timezone??"UTC"} setGuard={setGuard}/>}</main></div>
 <dialog ref={menu} id="settings-navigation" className="home-nav-dialog" aria-label="Navegación personal" onClose={()=>setMenuOpen(false)}><div className="dialog-heading"><span className="wordmark"><FinziMark/><span>finzi</span></span><button className="home-icon-button" aria-label="Cerrar navegación" onClick={()=>menu.current?.close()}><X size={21}/></button></div>{navigation}</dialog></div>;
}
