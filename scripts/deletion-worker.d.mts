export type Job={id:string;user_id:string;tracking_hash:string;lease:string;stage?:string};
export type Manifest={version:number;requestId:string;subjectId:string;trackingHash:string;recordedAt:string};
export type Store={root:string;keyFile:string;save(job:Job):string;all():Manifest[]};
export function manifestStore(root?:string,keyFile?:string):Store;
export function localQuery(statement:string):unknown;
export function processDeletion(job:Job,port:{manifest:(job:Job)=>unknown;step:(job:Job,action:string,digest?:unknown)=>unknown;purgeFiles:(id:string)=>unknown;deleteIdentity:(id:string)=>unknown}):Promise<boolean>;
export function restoreManifests(store:Store):number;
export function runBatch(options?:{store?:Store;limit?:number}):Promise<{completed:number;retries:number}>;
