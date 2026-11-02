import{useCallback,useEffect,useRef,useState}from'react';
import{runtime}from'../runtime/client';import type{PersonalArtwork}from'../runtime/connectedServices';
export function artworkError(reason:unknown,fallback='Personal images could not be loaded.'){return reason instanceof Error?reason.message.replace(/^Error invoking remote method ['"][^'"]+['"]: (?:Error: )?/,''):fallback;}
export function usePersonalArtwork(profileId:string,privateMode=false,enabled=true){
 const [assets,setAssets]=useState<PersonalArtwork[]>([]),[error,setError]=useState(''),[owner,setOwner]=useState(''),generation=useRef(0);
 const refresh=useCallback(async()=>{const current=++generation.current;if(!enabled){setAssets([]);return;}try{const result=await runtime.service({type:'artwork.list'});if(current!==generation.current)return;if(!result.artwork||result.artwork.profileId!==profileId||result.artwork.private!==privateMode)throw Error('Personal images are unavailable for this profile.');setAssets(result.artwork.assets);setOwner(profileId+':'+privateMode);setError('');}catch(reason){if(current===generation.current){setAssets([]);setOwner(profileId+':'+privateMode);setError(artworkError(reason));}}},[profileId,privateMode,enabled]);
 useEffect(()=>{void refresh();const unsubscribe=runtime.subscribeBrowser(event=>{if(event.type==='artwork-changed'&&event.profileId===profileId)void refresh();});return()=>{generation.current++;unsubscribe();};},[refresh,profileId]);
 return{pending:enabled&&owner!==profileId+':'+privateMode,assets:owner===profileId+':'+privateMode?assets:[],error:owner===profileId+':'+privateMode?error:'',refresh};
}
