/** The sidebar list's slides (AciraSidebar useFlip), the two numbers a change made while rows still slide needs (14.1, tester 21 Nov: "the list jumps").
 *  Until 14.1 such a change stood every row in its place at once; now the slides carry on, and a row that leaves mid-slide leaves from where it was drawn. Pure. */

/** How far from its layout place a row is drawn while its slide (keyframes translateY(from) -> none) runs: `progress` is the slide's eased progress
 *  (getComputedTiming().progress). A slide that is not running, or not started, draws the row at its place. */
export const slideOffset=(slide:{from:number;playState:string;progress:number|null|undefined}|undefined):number=>
 !slide||slide.playState!=='running'||typeof slide.progress!=='number'?0:slide.from*(1-slide.progress);

/** How far the leaving rows' clip closes from the bottom: as far as the first row below them travels up (its `from`), so the clip's bottom edge and that
 *  row's top stay together on every frame (a row that was still sliding down travels more than one row's height). With nothing below moving up, the
 *  old rule: the largest slide (`slide`) up to the pictures' height, else the whole height (`span`). `leaving` are the leaving rows' layout boxes. */
export function clipTravel(leaving:readonly {top:number;height:number}[],moves:readonly {dy:number;was:number;from:number}[],slide:number,span:number):number{
 const lowest=Math.max(...leaving.map(item=>item.top+item.height));
 const follower=moves.filter(move=>move.dy>0&&move.was>=lowest-.5).sort((a,b)=>a.was-b.was)[0];
 return follower?follower.from:slide>0?Math.min(slide,span):span;
}
